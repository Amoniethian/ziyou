/**
 * Text + randomness helpers shared across learning, review and the aquarium.
 * Ported verbatim (behaviour-wise) from the legacy single-file build.
 */

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/** Whitespace-separated chunks; punctuation stays attached to its word. */
export function tokenize(en: string): string[] {
  return en.split(/\s+/).filter(Boolean);
}

/** Strip punctuation + case so "Dawn." compares equal to "dawn". */
export function normToken(t: string): string {
  return t.replace(/[^a-zA-Z']/g, "").toLowerCase();
}

export function escapeRegex(w: string): string {
  return w.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

/** Find the surface form of `word` (incl. inflection) as it appears in `en`. */
export function matchSurface(en: string, word: string): string {
  const re = new RegExp("\\b" + escapeRegex(word) + "\\w*\\b", "i");
  const m = en.match(re);
  return m ? m[0] : word;
}
