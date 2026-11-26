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

/* ------------------------------------------------- what the page SAYS */

/** credit roles in the languages comics are printed in (EN, FR, ES, IT, DE) */
const CREDIT_ROLES: [string, RegExp][] = [
  ['script', /\b(script|scripts?|writer|written|story|scénario|scenario|guion|sceneggiatura|szenario|texte?s?)\b/i],
  ['art', /\b(art|artist|artiste|pencil(?:s|ler|er)?|penciled|dessins?|dibujos?|disegni|zeichnungen?)\b/i],
  ['inks', /\b(inks?|inker|inked|encrage|encreur|tintas?|chine)\b/i],
  ['colors', /\b(colou?rs?|colou?rist|couleurs?|coloriste|color(?:es)?|colori)\b/i],
  ['letters', /\b(letter(?:s|er|ing)|lettrage|rotulación|lettering)\b/i],
  ['editor', /\b(editor|edits|edited|éditeur|editeur|direction éditoriale|redactor|redazione)\b/i],
  ['cover', /\b(cover|variant|couverture|portada|copertina)\b/i],
  ['created', /\b(created by|créé par|cree par|based on|d'après|creado por)\b/i],
  ['translation', /\b(translat(?:ion|ed|or)|traduction|traducteur|traducción)\b/i],
];
const AD_WORDS = /\b(subscribe|available|on sale|in stores|order now|pre-?order|buy|shop|download|www\.|\.com|abonnez|disponible|en vente|chez votre libraire|commandez|offre|prix|€|\$\d|app store|google play)\b/i;
const LEGAL = /(©|®|™|all rights reserved|tous droits réservés|printed in|imprimé en|published by|publié par)/i;

export interface PageText { roles: string[]; ad: number; legal: boolean; words: number; /** where the credits are printed (page px), when known */ creditsBox?: { x: number; y: number; w: number; h: number } }

/** read the OCR text of a page: which credit roles, how much advertising, how much prose */
export function readPageText(text: string, boxes?: { t: string; x: number; y: number; w: number; h: number }[]): PageText {
  const t = text.replace(/\s+/g, ' ');
  const roles = CREDIT_ROLES.filter(([, re]) => re.test(t)).map(([k]) => k);
  const ad = (t.match(new RegExp(AD_WORDS.source, 'gi')) ?? []).length;
  const words = t.split(' ').filter((w) => /\p{L}{2,}/u.test(w)).length;
  let creditsBox: PageText['creditsBox'];
  if (boxes?.length && roles.length) {
    // the credits block: the lines holding role words, plus the big title right above them
    const hits = boxes.filter((b) => CREDIT_ROLES.some(([k, re]) => k !== 'cover' && k !== 'script' && re.test(b.t)) || /^(script|scénario|scenario|writer)$/i.test(b.t));
    if (hits.length >= 2) {
      const lh = hits.reduce((a, b) => a + b.h, 0) / hits.length;
      let y0 = Math.min(...hits.map((b) => b.y)), y1 = Math.max(...hits.map((b) => b.y + b.h));
      // the chapter title: real capital words, much taller than the credit lines, just above them
      const title = boxes.filter((b) => b.y + b.h <= y0 && b.y + b.h > y0 - lh * 8 && b.h > lh * 1.8 && /^[\p{Lu}][\p{Lu}'’-]{2,}[.!?]?$/u.test(b.t));
      if (title.length) y0 = Math.min(y0, ...title.map((b) => b.y));
      const inBlock = boxes.filter((b) => b.y >= y0 - lh && b.y + b.h <= y1 + lh);
      const x0 = Math.min(...inBlock.map((b) => b.x)), x1 = Math.max(...inBlock.map((b) => b.x + b.w));
      y1 = Math.max(y1, ...inBlock.map((b) => b.y + b.h));
      creditsBox = { x: x0 - lh, y: y0 - lh * 0.5, w: x1 - x0 + lh * 2, h: y1 - y0 + lh * 1.5 };
    }
  }
  return { roles, ad, legal: LEGAL.test(t), words, creditsBox };
}

/**
 * The text decides when it is unambiguous: a page that names its script
 * writer, artist, colourist… is a title/credits page, whatever its picture;
 * a page that sells something is an ad; a page of prose is a text page.
 * Returns null when the text says nothing decisive (the picture decides).
 */
export function kindFromText(pt: PageText, bubbles: number, biggest: number, panels = 0): { kind: PageKind; why: string; dropCredits?: boolean } | null {
  const credits = pt.roles.filter((r) => r !== 'cover').length;
  if (credits >= 2 || (credits >= 1 && pt.legal)) {
    const what = pt.roles.slice(0, 4).join(', ');
    // story panels AND a credits block on the same page (a chapter opening):
    // still a story page, the credits block itself is never shown
    // (Marvel openings are often one big image full of balloons, with the credits printed on it)
    if ((panels >= 2 && bubbles >= 1) || bubbles >= 3) return { kind: 'story', why: `planche d’ouverture : récit + bloc titre/crédits (${what}), crédits non montrés`, dropCredits: true };
    return biggest > 0.35 || bubbles <= 0
      ? { kind: 'title', why: `page de titre et crédits (${what})` }
      : { kind: 'text', why: `crédits (${what})` };
  }
  if (pt.ad >= 2 && bubbles <= 1) return { kind: 'ad', why: 'texte publicitaire' };
  // prose (letters page, recap, afterword): lots of words and no panel structure
  if (pt.words >= 140 && bubbles <= 2 && panels <= 1) return { kind: 'text', why: `${pt.words} mots de texte suivi, sans cases` };
  return null;
}

/**
 * Raise the bottom of a panel box to where the art really ends: rows that are
 * mostly bare page paper (margin, a printed title or credits on the paper)
 * are not part of the panel. The paper colour is read from the page border.
 */
export function trimBottomToArt(img: CanvasImageSource, width: number, height: number, r: { x: number; y: number; w: number; h: number }) {
  const S = Math.min(1, 500 / Math.max(width, height));
  const w = Math.max(8, Math.round(width * S)), h = Math.max(8, Math.round(height * S));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  // paper = median colour of the page's left and right borders
  const border: number[][] = [];
  for (let yy = 0; yy < h; yy += 2) for (const xx of [1, w - 2]) { const i = (yy * w + xx) * 4; border.push([d[i], d[i + 1], d[i + 2]]); }
  const med = [0, 1, 2].map((k) => border.map((p) => p[k]).sort((a, b) => a - b)[border.length >> 1]);
  const paper = (i: number) => Math.abs(d[i] - med[0]) + Math.abs(d[i + 1] - med[1]) + Math.abs(d[i + 2] - med[2]) < 60;
  const x0 = Math.max(0, Math.floor(r.x * S)), x1 = Math.min(w, Math.ceil((r.x + r.w) * S));
  const yTop = Math.max(0, Math.floor(r.y * S));
  let yb = Math.min(h - 1, Math.ceil((r.y + r.h) * S) - 1);
  let art = 0;
  for (; yb > yTop + (yb - yTop) * 0.3; yb--) {
    let p = 0;
    for (let xx = x0; xx < x1; xx++) if (paper((yb * w + xx) * 4)) p++;
    // three art rows in a row: this is the panel
    if (p / Math.max(1, x1 - x0) < 0.45) { if (++art >= 3) { yb += 2; break; } } else art = 0;
  }
  const bottom = Math.min(r.y + r.h, Math.round((yb + 1) / S));
  return { ...r, h: Math.max(8, bottom - r.y) };
}
