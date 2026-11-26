/** `v` held between `lo` and `hi` (`hi` wins if they cross: the sim's long-standing order, kept for determinism). */
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
