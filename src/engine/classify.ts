import type { PageKind } from '../types';
import type { PageCut } from './detect';

/**
 * What is this page? Story page, cover, variant cover, splash, double page,
 * text (credits, recap, letters), ad or blank — the way comic servers
 * (Komga, Kavita, ComicRack's ComicInfo.xml) categorise pages.
 */
export interface PageCtx {
  srcIndex: number;
  srcCount: number;
  /** median width/height of the pages of the same file */
  medianAspect: number;
  /** ComicInfo.xml page type, when the archive has one */
  hint?: string;
  /** kind of the previous page of the same file (covers come in a row) */
  prevKind?: PageKind;
  /** speech balloons + captions found by the AI detector (-1 or undefined = unknown) */
  bubbles?: number;
}

const HINTS: Record<string, PageKind> = {
  FrontCover: 'cover', InnerCover: 'variant', BackCover: 'variant', Story: 'story',
  Advertisement: 'ad', Editorial: 'text', Letters: 'text', Roundup: 'text', Preview: 'ad', Other: 'text', Deleted: 'ad',
};

export interface PageStats { blank: boolean; text: boolean; sat: number; flat: number; edges: number; transitions: number; blankRows: number }

export function pageStats(img: CanvasImageSource, width: number, height: number): PageStats {
  const w = 160, h = Math.max(8, Math.round((160 * height) / width));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const n = w * h;
  const L = new Float32Array(n);
  let sat = 0, mean = 0, flat = 0;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat += mx ? (mx - mn) / mx : 0;
    L[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    mean += L[i];
    if (L[i] > 228 || L[i] < 22) flat++;
  }
  mean /= n;
  let v = 0, edges = 0;
  for (let i = 0; i < n; i++) v += (L[i] - mean) ** 2;
  for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
    const i = y * w + xx;
    if (Math.abs(L[i + 1] - L[i - 1]) + Math.abs(L[i + w] - L[i - w]) > 90) edges++;
  }
  const std = Math.sqrt(v / n);
  // text lines: ink rows alternate with blank rows (line spacing), many times down the page
  const bgL = mean > 128 ? 255 : 0;
  let transitions = 0, blankRows = 0, prevBlank = true;
  for (let y = 0; y < h; y++) {
    let ink = 0;
    for (let xx = 0; xx < w; xx++) if (Math.abs(L[y * w + xx] - bgL) > 90) ink++;
    const blank = ink < w * 0.02;
    if (blank) blankRows++;
    if (blank !== prevBlank) transitions++;
    prevBlank = blank;
  }
  const lineLike = transitions >= 24 && blankRows / h > 0.3 && blankRows / h < 0.75;
  const s = sat / n, f = flat / n, e = edges / n;
  return {
    sat: s, flat: f, edges: e, transitions, blankRows: blankRows / h,
    blank: std < 7,
    // lots of paper, lots of small sharp marks, little colour: prose, credits, letters page
    text: f > 0.5 && e > 0.05 && s < 0.25 && lineLike,
  };
}

export function classifyPage(img: CanvasImageSource, width: number, height: number, cut: PageCut, ctx: PageCtx): { kind: PageKind; why: string } {
  if (ctx.hint && HINTS[ctx.hint]) return { kind: HINTS[ctx.hint], why: 'ComicInfo.xml' };
  const st = pageStats(img, width, height);
  if (st.blank) return { kind: 'blank', why: 'page unie' };
  const aspect = width / height;
  if (aspect > 1.2) {
    // a real double page is about twice a single page of the same issue
    const expected = 2 * ctx.medianAspect;
    const tol = ctx.srcIndex === ctx.srcCount - 1 ? 0.04 : 0.08;
    if (ctx.srcCount < 5 || Math.abs(aspect - expected) / expected < tol) return { kind: 'spread', why: 'format double page' };
    return { kind: 'ad', why: 'format paysage différent du numéro' };
  }
  // scanner credits, ads inserted in a scan: a different page format than the issue
  if (ctx.srcCount >= 5 && Math.abs(aspect - ctx.medianAspect) / ctx.medianAspect > 0.1) {
    return { kind: 'ad', why: 'format différent du reste du numéro' };
  }
  if (st.text && cut.kind !== 'panels') return { kind: 'text', why: 'surtout du texte' };
  const n = cut.kind === 'panels' ? cut.rects.length : (cut.diag?.n ?? cut.rects.length);
  const biggest = cut.diag?.biggest ?? 0;
  const b = ctx.bubbles ?? -1;
  const last = ctx.srcCount >= 8 && ctx.srcIndex >= ctx.srcCount - 3;
  if (b >= 0) {
    // Balloons are the surest sign of a story page: covers, title pages, pin-ups
    // and ads have none (a caption or two at most).
    if (b >= 3) return { kind: n <= 1 ? 'splash' : 'story', why: `${b} bulles${n > 1 ? `, ${n} cases` : ''}` };
    const silent = b === 0;
    if (ctx.srcIndex === 0 && silent && n <= 3) return { kind: 'cover', why: 'première page, sans bulles' };
    if ((ctx.prevKind === 'cover' || ctx.prevKind === 'variant') && silent && n <= 3) return { kind: 'variant', why: 'suit la couverture, sans bulles' };
    if (last && silent) return biggest > 0.6 || n <= 1
      ? { kind: 'variant', why: 'fin du numéro, une image sans bulles' }
      : { kind: 'ad', why: 'fin du numéro, sans bulles ni récit' };
    // lots of paper around one picture and the credits: the chapter title page
    if (silent && ctx.srcIndex <= 6 && st.flat > 0.3 && n <= 2) return { kind: 'title', why: 'page de titre (image + crédits)' };
    if (n <= 1 || biggest > 0.8) return { kind: 'splash', why: silent ? 'une seule image' : 'pleine page' };
    return { kind: 'story', why: `${n} cases` };
  }
  // no AI reading: geometry only
  const coverLike = n <= 3 && (biggest > 0.45 || cut.kind !== 'panels');
  if (ctx.srcIndex === 0 && coverLike) return { kind: 'cover', why: 'première page du fichier' };
  if ((ctx.prevKind === 'cover' || ctx.prevKind === 'variant') && coverLike) return { kind: 'variant', why: 'suit la couverture' };
  if (last && coverLike && biggest > 0.6) return { kind: 'variant', why: 'fin du numéro, une seule image' };
  const single = cut.kind === 'splash' || (n <= 1) || biggest > 0.8;
  if (single) return { kind: 'splash', why: 'une seule image' };
  return { kind: 'story', why: cut.kind === 'panels' ? 'cases détectées' : 'planche (bandes)' };
}

/**
 * 64-bit difference hash: two scans of the same page (or the same cover
 * printed twice) differ by a few bits only.
 */
export function pageHash(img: CanvasImageSource, width: number, height: number): string {
  const c = document.createElement('canvas');
  c.width = 9; c.height = 8;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, width, height, 0, 0, 9, 8);
  const d = x.getImageData(0, 0, 9, 8).data;
  const L = (i: number) => d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  let bits = '';
  for (let y = 0; y < 8; y++) for (let xx = 0; xx < 8; xx++) bits += L(y * 9 + xx) > L(y * 9 + xx + 1) ? '1' : '0';
  return bits;
}
export const hashDistance = (a: string, b: string) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };

export function medianAspect(list: { width: number; height: number }[]) {
  const a = list.map((p) => p.width / p.height).filter((x) => x < 1.2).sort((x, y) => x - y);
  return a.length ? a[a.length >> 1] : 0.65;
}
