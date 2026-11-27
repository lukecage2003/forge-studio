import type { Page, Project } from '../types';

/**
 * COLOUR CONSISTENCY — scans of one comic rarely match: a page darker, one
 * greyer, one yellowed. Each story page is measured (paper white, contrast,
 * saturation, colour cast) against the median of the story pages of the same
 * file; a page whose paper is darker or lighter gets a proposed exposure
 * correction, shown by the quality review and applied only when the user asks.
 * Contrast and colour are the drawing's own: measured, never corrected.
 * Covers, ads, full pages and title pages keep their intended look.
 * The drawing is never changed: the correction is a filter at render time.
 */

export interface PageTone { brightness: number; contrast: number; saturate: number }
export interface ToneStats { paper: number; std: number; sat: number; cast: number }

/** statistics of RGBA pixels (a small thumbnail is enough) */
/** `w`: width of the thumbnail; when given, the paper is measured in the outer margin only (the edge of a printed page is paper; inside, greys belong to the drawing) */
export function toneStats(px: Uint8ClampedArray, w?: number): ToneStats {
  const n = px.length / 4;
  const lum: number[] = [], grey: number[] = [];
  let sum = 0, sat = 0, castN = 0, cast = 0;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    lum.push(l); sum += l;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const s = mx > 0 ? (mx - mn) / mx : 0;
    sat += s;
    // paper candidates: unsaturated, not ink, and (when the size is known) in the outer margin of the page
    let edge = true;
    if (w) { const k = i / 4, x = k % w, y = Math.floor(k / w), h = n / w, m = Math.max(1, Math.round(Math.min(w, h) * 0.035)); edge = x < m || y < m || x >= w - m || y >= h - m; }
    if (edge && s < 0.18 && l > 0.25) grey.push(l);
    // cast of the paper: warm (yellow) when red+green exceed blue on bright pixels
    if (l > 0.7) { cast += (r + g) / 2 - b; castN++; }
  }
  lum.sort((a, c) => a - c);
  const mean = sum / n;
  const std = Math.sqrt(lum.reduce((a, l) => a + (l - mean) ** 2, 0) / n);
  // paper white: the 85th percentile of the unsaturated pixels; a page with almost no paper showing
  // (one painted panel edge to edge) can't be judged: NaN
  grey.sort((a, c) => a - c);
  const paper = grey.length >= (w ? 0.4 * (2 * (w + n / w) * Math.max(1, Math.round(Math.min(w, n / w) * 0.035))) : n * 0.05) ? grey[Math.floor(grey.length * 0.85)] : NaN;
  return { paper, std, sat: sat / n, cast: castN ? cast / castN : 0 };
}

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const STORY: Page['kind'][] = ['story', 'spread', undefined];

/** proposed corrections for the pages that stand out (pure, tested) */
export function harmonize(pages: { id: string; source?: string; kind?: Page['kind']; stats: ToneStats }[]): { id: string; tone: PageTone; why: string }[] {
  const out: { id: string; tone: PageTone; why: string }[] = [];
  const groups = new Map<string, typeof pages>();
  for (const p of pages) if (STORY.includes(p.kind) && Number.isFinite(p.stats.paper)) groups.set(p.source ?? '', [...(groups.get(p.source ?? '') ?? []), p]);
  for (const g of groups.values()) {
    if (g.length < 4) continue; // not enough pages to know what « normal » is
    const mPaper = median(g.map((x) => x.stats.paper)), mCast = median(g.map((x) => x.stats.cast));
    const madPaper = median(g.map((x) => Math.abs(x.stats.paper - mPaper)));
    // margins that are not near white (tan, grey, black) are part of the colour design, not paper: no judgement
    if (mPaper < 0.85) continue;
    // margins that vary a lot from page to page (backup story, designed sequences): design and scan can't be told apart
    if (madPaper > 0.03) continue;
    const found: typeof out = [];
    for (const p of g) {
      // only the paper says how the page was scanned; contrast and colour belong to the drawing
      // (a night scene is darker, an explosion more saturated): those are never "corrected"
      const brightness = clamp(mPaper / Math.max(0.05, p.stats.paper), 0.85, 1.2);
      // a page stands out when it is far from the median AND far beyond the comic's own spread
      const off = Math.abs(p.stats.paper - mPaper);
      if (off <= Math.max(0.08 * mPaper, 3 * madPaper)) continue;
      const why: string[] = [brightness > 1 ? 'scan plus sombre' : 'scan plus clair'];
      if (p.stats.cast - mCast > 0.06) why.push('papier jauni (non corrigé)');
      found.push({ id: p.id, tone: { brightness: +brightness.toFixed(3), contrast: 1, saturate: 1 }, why: why.join(', ') });
    }
    // a bad scan is a few pages; when many pages « stand out », that is how this comic looks
    if (found.length <= Math.max(1, Math.floor(g.length * 0.25))) out.push(...found);
  }
  return out;
}

/** CSS filter of a page correction ('' when none) */
export const toneFilter = (t?: PageTone | null) => (t ? `brightness(${t.brightness}) contrast(${t.contrast}) saturate(${t.saturate})` : '');

/* ---------------------------------------------------------------- browser: measure the decoded pages */
const cache = new Map<string, ToneStats>();
export function measurePage(mediaId: string, img: CanvasImageSource, w: number, h: number): ToneStats {
  const hit = cache.get(mediaId);
  if (hit) return hit;
  const c = document.createElement('canvas');
  const k = 96 / Math.max(w, h);
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, c.width, c.height);
  const s = toneStats(x.getImageData(0, 0, c.width, c.height).data, c.width);
  cache.set(mediaId, s);
  return s;
}
export type { Project };
