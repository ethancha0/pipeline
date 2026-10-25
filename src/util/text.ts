/** Lowercase, strip accents, punctuation and `*`, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Compare two filled/final values: case, spacing and punctuation don't count ("714-747-0796" = "(714) 747-0796"). */
export function sameValue(a: string | null | undefined, b: string | null | undefined): boolean {
  const squash = (s: string | null | undefined) => normalizeText(s ?? '').replace(/\s+/g, '');
  return squash(a) === squash(b);
}

function bigrams(s: string): string[] {
  const t = s.replace(/\s+/g, ' ');
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice similarity of character bigrams on normalized text, 0–1. */
export function similarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (x === y) return 1;
  const xa = bigrams(x);
  const yb = bigrams(y);
  if (xa.length === 0 || yb.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const g of xa) counts.set(g, (counts.get(g) ?? 0) + 1);
  let overlap = 0;
  for (const g of yb) {
    const n = counts.get(g) ?? 0;
    if (n > 0) {
      overlap++;
      counts.set(g, n - 1);
    }
  }
  return (2 * overlap) / (xa.length + yb.length);
}

const STOPWORDS = new Set(['a', 'an', 'the', 'of', 'in', 'and', 'or', 'to', 'for', 'i', 'am']);
const stem = (w: string) => w.replace(/'s$/, '').replace(/s$/, '');
const tokens = (s: string) => normalizeText(s).split(' ').filter((w) => w && !STOPWORDS.has(w)).map(stem);

/** The EEO "decline to answer" sentinel used in profile.yaml. */
export const DECLINE = 'decline';
const DECLINE_OPTION = /decline|don ?t wish|do not wish|prefer not|not to (answer|disclose|say|self identify)|choose not/;

/**
 * The option that best matches `value`, or null. In order: exact (normalized),
 * one starts with the other at a word boundary, all words of one contained in
 * the other (fewest extra words wins), then character similarity ≥ `minSimilarity`.
 * `decline` picks the "decline / don't wish to answer" option.
 */
export function bestOption(value: string, options: readonly string[], minSimilarity = 0.8): string | null {
  const v = normalizeText(value);
  if (!v || options.length === 0) return null;
  const norm = options.map((o) => normalizeText(o));

  if (v === DECLINE) {
    const i = norm.findIndex((o) => DECLINE_OPTION.test(o));
    return i >= 0 ? options[i]! : null;
  }

  const exact = norm.indexOf(v);
  if (exact >= 0) return options[exact]!;

  const prefix = norm.findIndex((o) => o.startsWith(`${v} `) || v.startsWith(`${o} `));
  if (prefix >= 0) return options[prefix]!;

  const vt = tokens(value);
  let best: { i: number; extra: number } | null = null;
  let tie = false;
  options.forEach((o, i) => {
    const ot = tokens(o);
    if (ot.length === 0 || vt.length === 0) return;
    const contained = vt.every((t) => ot.includes(t)) || ot.every((t) => vt.includes(t));
    if (!contained) return;
    const extra = Math.abs(ot.length - vt.length);
    if (!best || extra < best.extra) {
      best = { i, extra };
      tie = false;
    } else if (extra === best.extra) {
      tie = true;
    }
  });
  if (best && !tie) return options[(best as { i: number }).i]!;

  let top = -1;
  let topScore = 0;
  options.forEach((o, i) => {
    const s = similarity(value, o);
    if (s > topScore) {
      topScore = s;
      top = i;
    }
  });
  return topScore >= minSimilarity ? options[top]! : null;
}
