/**
 * Script ↔ transcript alignment: the transcript knows WHEN each word is said,
 * the script knows WHAT is said. A global alignment (Needleman-Wunsch on
 * words, with a spelling similarity) gives every script word the timing of
 * the transcript word it corresponds to, even when the recognition got the
 * word wrong. Transcript words with no script counterpart (retakes, fillers,
 * ad-libs) are dropped; script words never spoken get times in between.
 */
import type { Word } from '../types';

const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

/** similarity 0..1 of two words (Levenshtein on the normalised spelling) */
export function wordSim(a: string, b: string): number {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const d = Array.from({ length: x.length + 1 }, (_, i) => i);
  for (let j = 1; j <= y.length; j++) {
    let prev = d[0];
    d[0] = j;
    for (let i = 1; i <= x.length; i++) {
      const tmp = d[i];
      d[i] = Math.min(d[i] + 1, d[i - 1] + 1, prev + (x[i - 1] === y[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return 1 - d[x.length] / Math.max(x.length, y.length);
}

/** script words with the timing of the transcript; `coverage` = share of script words matched with confidence */
export function alignScript(script: string, words: Word[]): { words: Word[]; coverage: number } {
  const S = script.replace(/[«»"“”]/g, ' ').split(/\s+/).filter((w) => /[\p{L}\d]/u.test(w));
  const T = words.filter((w) => norm(w.w));
  const n = S.length, m = T.length;
  if (!n || !m) return { words: [], coverage: 0 };
  const GAP = -0.6;
  const score = (i: number, j: number) => { const s = wordSim(S[i], T[j].w); return s >= 0.5 ? 2 * s : s - 0.7; };
  const H = new Float32Array((n + 1) * (m + 1));
  const at = (i: number, j: number) => i * (m + 1) + j;
  for (let i = 1; i <= n; i++) H[at(i, 0)] = i * GAP;
  for (let j = 1; j <= m; j++) H[at(0, j)] = j * GAP;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    H[at(i, j)] = Math.max(H[at(i - 1, j - 1)] + score(i - 1, j - 1), H[at(i - 1, j)] + GAP, H[at(i, j - 1)] + GAP);
  }
  // trace back: script word i ↔ transcript word j (or nothing)
  const link = new Int32Array(n).fill(-1);
  const sure = new Uint8Array(n);
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const h = H[at(i, j)];
    if (Math.abs(h - (H[at(i - 1, j - 1)] + score(i - 1, j - 1))) < 1e-4) { link[i - 1] = j - 1; sure[i - 1] = wordSim(S[i - 1], T[j - 1].w) >= 0.5 ? 1 : 0; i--; j--; }
    else if (Math.abs(h - (H[at(i - 1, j)] + GAP)) < 1e-4) i--;
    else j--;
  }
  // times: from the linked transcript word, else spread between the neighbours
  const out: Word[] = S.map((w, k) => (link[k] >= 0 ? { w, s: T[link[k]].s, e: T[link[k]].e } : { w, s: NaN, e: NaN }));
  for (let k = 0; k < n; k++) {
    if (!Number.isNaN(out[k].s)) continue;
    let a = k - 1; while (a >= 0 && Number.isNaN(out[a].s)) a--;
    let b = k + 1; while (b < n && Number.isNaN(out[b].s)) b++;
    const t0 = a >= 0 ? out[a].e : (b < n ? out[b].s - 0.3 * (b - k) : 0);
    const t1 = b < n ? out[b].s : t0 + 0.3 * (k - a);
    const steps = b - a, pos = k - a;
    out[k] = { w: S[k], s: t0 + ((t1 - t0) * (pos - 1)) / Math.max(1, steps - 1), e: t0 + ((t1 - t0) * pos) / Math.max(1, steps - 1) };
  }
  for (let k = 1; k < n; k++) if (out[k].s < out[k - 1].s) out[k].s = out[k - 1].s;
  return { words: out.map((w) => ({ ...w, e: Math.max(w.e, w.s + 0.05) })), coverage: sure.reduce((a, b) => a + b, 0) / n };
}
