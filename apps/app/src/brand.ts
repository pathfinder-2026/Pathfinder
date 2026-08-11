/**
 * Apply a brand colour to the running app by setting ONLY the brand token
 * (--pf-brand) + a derived tint. Governance tokens (--gov-*) are never touched,
 * so status signals stay fixed regardless of branding (FR-WL-004). The server
 * has already clamped the colour to the WCAG-AA floor, so white-on-brand text is
 * guaranteed legible.
 */
export function applyBrand(hexColor: string): void {
  const root = document.documentElement;
  root.style.setProperty("--pf-brand", hexColor);
  root.style.setProperty("--pf-brand-tint", mixWithWhite(hexColor, 0.86));
}

/** Mix a hex colour with white by `amount` (0..1 = how much white). */
function mixWithWhite(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#dceeea";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
