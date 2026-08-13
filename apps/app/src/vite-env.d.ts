/// <reference types="vite/client" />

// Vite's `?url` import suffix (used to hand pdfjs its worker script as a
// locally-bundled asset URL — no CDN; see fileText.ts).
declare module "pdfjs-dist/build/pdf.worker.min.mjs?url" {
  const url: string;
  export default url;
}
