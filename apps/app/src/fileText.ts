/**
 * Client-side text extraction for Content Studio file uploads (TCH-1).
 *
 * The content pipeline is text-based end to end (POST /content takes
 * {title, fileType, text} — scan, classify, chunk and ground all operate on
 * text), so a real file upload means extracting the file's text IN THE
 * BROWSER and submitting that through the existing endpoint — the whole
 * governance pipeline then applies unchanged. Nothing binary ever leaves the
 * teacher's machine.
 *
 *  - .txt / .md          read directly
 *  - .pdf                pdfjs-dist (bundled locally by Vite — no CDN)
 *  - .docx               unzip (DecompressionStream) + strip word/document.xml
 *  - anything else       honest refusal naming what IS supported — never a
 *                        silent empty upload
 */

export interface ExtractedFile {
  /** File name without extension — a sensible default title. */
  title: string;
  /** The pipeline's fileType label, from the real extension. */
  fileType: string;
  text: string;
}

export async function extractTextFromFile(file: File): Promise<ExtractedFile> {
  const name = file.name;
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  const title = dot >= 0 ? name.slice(0, dot) : name;

  if (ext === "txt" || ext === "md") {
    return { title, fileType: ext, text: await file.text() };
  }
  if (ext === "pdf") {
    return { title, fileType: "pdf", text: await extractPdfText(file) };
  }
  if (ext === "docx") {
    return { title, fileType: "docx", text: await extractDocxText(file) };
  }
  throw new Error(
    `Can't extract text from ".${ext}" files yet — supported: .pdf, .docx, .txt, .md. ` +
    "For other formats, paste the text into the content box instead.",
  );
}

/** PDF → text via pdfjs, page by page, headings inferred from blank-line gaps. */
async function extractPdfText(file: File): Promise<string> {
  // Dynamic import keeps pdfjs out of the main bundle until a PDF is chosen.
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const line: string[] = [];
    for (const item of content.items) {
      if ("str" in item) {
        line.push(item.str);
        if (item.hasEOL) line.push("\n");
      }
    }
    pages.push(line.join(" ").replace(/ *\n */g, "\n"));
  }
  const text = pages.join("\n\n").replace(/[ \t]+/g, " ").trim();
  if (!text) {
    throw new Error(
      "This PDF contains no extractable text (it may be a scanned image). " +
      "Paste the text into the content box instead.",
    );
  }
  return text;
}

/**
 * DOCX → text: a .docx is a ZIP; the document body is word/document.xml.
 * Paragraphs (<w:p>) become lines; heading-styled paragraphs get a leading
 * "#" so they become groundable sections like a pasted document's would.
 */
async function extractDocxText(file: File): Promise<string> {
  const xml = await readZipEntry(new Uint8Array(await file.arrayBuffer()), "word/document.xml");
  if (!xml) throw new Error("This .docx has no readable document body — paste the text instead.");

  const paragraphs = xml.split(/<w:p[ >]/).slice(1).map((p) => {
    const heading = /<w:pStyle[^>]*w:val="Heading\d*"/.test(p);
    const runs = [...p.matchAll(/<w:t(?:[^>]*)>([^<]*)<\/w:t>/g)].map((m) => decodeXml(m[1] ?? ""));
    const line = runs.join("").trim();
    return line ? (heading ? `# ${line}` : line) : null;
  }).filter((l): l is string => l !== null);

  const text = paragraphs.join("\n").trim();
  if (!text) throw new Error("No text found in this .docx — paste the text instead.");
  return text;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

/**
 * Minimal ZIP reader: walk the end-of-central-directory → central directory →
 * local header for one entry, inflating with the browser's built-in
 * DecompressionStream. Handles stored (0) and deflated (8) entries — which is
 * every real-world .docx.
 */
async function readZipEntry(bytes: Uint8Array, wantedName: string): Promise<string | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // Find EOCD (signature 0x06054b50), scanning back past any zip comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== 0x02014b50) return null; // central-dir signature
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));

    if (name === wantedName) {
      // Local header: sizes of its own name/extra fields differ from the central dir's.
      const localNameLen = view.getUint16(localOffset + 26, true);
      const localExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const data = bytes.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return new TextDecoder().decode(data);
      if (method === 8) {
        const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return await new Response(stream).text();
      }
      return null; // an exotic compression method — not a real-world docx
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}
