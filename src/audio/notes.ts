/** Note names ("C#4", "Eb3", "A5") ↔ MIDI numbers (60 = C4, middle C). No DOM: content checks use it too. */
const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** One note name → MIDI number, or null if it isn't one. */
export function noteMidi(name: string): number | null {
  const m = name.trim().match(/^([A-Ga-g])([#b♯♭]?)(-?\d)$/);
  if (!m) return null;
  const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + PC[m[1].toUpperCase()] + acc;
}

/** "D3 A3 C#4" → MIDI numbers; `bad` lists the words that aren't notes. */
export function parseNotes(s: string | undefined): { notes: number[]; bad: string[] } {
  const notes: number[] = [], bad: string[] = [];
  for (const w of (s ?? '').split(/[\s,]+/).filter(Boolean)) {
    const n = noteMidi(w);
    if (n === null) bad.push(w);
    else notes.push(n);
  }
  return { notes, bad };
}

export const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
