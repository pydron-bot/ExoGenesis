/** Escape text for HTML: element content and attribute values, double- or single-quoted. */
export const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESC[c]!);
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** document.getElementById, typed. */
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
