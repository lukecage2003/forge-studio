import type { PageKind, Project } from '../types';
import type { Workspace } from './workspace';
import { translations } from '../engine/bridge-fr-en';

/**
 * MEDIA LIBRARY — every picture, sound and rush of every project of the
 * workspace, in one place: where it comes from (file, page number, series and
 * issue read from the file name, never guessed further), which projects use
 * it, what its balloons say, which characters they name, and its duplicates.
 * Media are referenced, never copied: adding a page to another project points
 * to the same file of the workspace.
 */

export interface LibEntry {
  id: string;
  kind: 'image' | 'audio' | 'video';
  name: string;
  source?: string;
  srcIndex?: number; srcCount?: number;
  /** read from the file name only (marked as such in the interface) */
  series?: string; issue?: string; year?: string;
  pageKind?: PageKind;
  width?: number; height?: number;
  projects: { id: string; name: string; updatedAt: string }[];
  /** shots of the edits that show it */
  shots: number;
  /** what the balloons of its panels say (OCR or the user's text) */
  text: string;
  chars: string[];
  size?: number; addedAt?: string;
  hash?: string;
}
export interface LibIndex { v: 1; items: Record<string, { hash?: string; clip?: string }> }

/** « The Ultimates (2015) 001.pdf » → The Ultimates · n°1 · 2015 */
export function issueOf(source?: string): { series?: string; issue?: string; year?: string } {
  if (!source) return {};
  const base = source.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_]+/g, ' ');
  const year = base.match(/\b(19[3-9]\d|20[0-4]\d)\b/)?.[1];
  const issue = base.replace(/\b(19|20)\d{2}\b/g, ' ').match(/(?:#|n°|no\.?|issue\s*|\s)0*(\d{1,4})\b(?!.*\d)/i)?.[1];
  const series = base.replace(/\(?\b(19|20)\d{2}\b\)?/g, ' ').replace(/(?:#|n°|no\.?|issue\s*)?\s*0*\d{1,4}\b.*$/i, ' ').replace(/\s+/g, ' ').trim();
  return { series: series.length >= 2 ? series : undefined, issue, year };
}

/** gather the media of every project (no media bytes are read) */
export function entriesFrom(projects: { project: Project; savedAt: string }[]): LibEntry[] {
  const map = new Map<string, LibEntry>();
  const get = (id: string, kind: LibEntry['kind'], name: string) => {
    let e = map.get(id);
    if (!e) { e = { id, kind, name, projects: [], shots: 0, text: '', chars: [] }; map.set(id, e); }
    return e;
  };
  for (const { project: p, savedAt } of projects) {
    const ref = { id: p.id, name: p.name || 'Sans titre', updatedAt: savedAt };
    const seen = new Set<string>();
    const use = (e: LibEntry) => { if (!seen.has(e.id)) { e.projects.push(ref); seen.add(e.id); } };
    for (const pg of p.pages ?? []) {
      const e = get(pg.mediaId, 'image', pg.name);
      use(e);
      Object.assign(e, { source: e.source ?? pg.source, srcIndex: e.srcIndex ?? pg.srcIndex, srcCount: e.srcCount ?? pg.srcCount, pageKind: e.pageKind ?? pg.kind, width: pg.width, height: pg.height, hash: e.hash ?? pg.hash });
      Object.assign(e, { ...issueOf(e.source), ...{ series: e.series ?? issueOf(e.source).series } });
      const shots = (p.shots ?? []).filter((s) => s.pageId === pg.id);
      e.shots += shots.length;
      const t = shots.map((s) => s.text ?? '').join(' ').trim();
      if (t && !e.text.includes(t)) e.text = `${e.text} ${t}`.trim();
      e.chars = [...new Set([...e.chars, ...shots.flatMap((s) => s.chars ?? [])])];
    }
    for (const a of p.audio ?? []) use(get(a.mediaId, 'audio', a.name));
    if (p.aroll) use(get(p.aroll.mediaId, 'video', p.aroll.name));
  }
  return [...map.values()];
}

const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const toks = (s: string) => s.split(/[\s,.;:!?'’()«»"-]+/).map(norm).filter((w) => w.length >= 2);

/** search by words: names, balloon text, file, series, page kind; French words also find their English twin */
export function searchText(entries: LibEntry[], q: string): { e: LibEntry; score: number }[] {
  const qs = toks(q);
  if (!qs.length) return entries.map((e) => ({ e, score: 0 }));
  return entries.map((e) => {
    const hay = new Set(toks(`${e.name} ${e.source ?? ''} ${e.series ?? ''} ${e.text} ${e.chars.join(' ')} ${e.pageKind ?? ''} ${e.projects.map((p) => p.name).join(' ')}`));
    let score = 0, all = true;
    // every word of the search must be found (exactly, through its English twin, or as the start of a word)
    for (const w of qs) {
      if (hay.has(w)) score += 2;
      else if (translations(w).some((t) => hay.has(t))) score += 1.5;
      else if ([...hay].some((h) => h.startsWith(w) && (w.length >= 3 || /^\d+$/.test(w)))) score += 1;
      else all = false;
    }
    return { e, score: all ? score / qs.length : 0 };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
}

/** words of pictures the comics glossary doesn't cover: colours, actions, kinds of page */
const VIS: Record<string, string> = {
  rouge: 'red', bleu: 'blue', bleue: 'blue', vert: 'green', verte: 'green', jaune: 'yellow', violet: 'purple', violette: 'purple', rose: 'pink', orange: 'orange', noir: 'black', noire: 'black', blanc: 'white', blanche: 'white', gris: 'grey', dore: 'golden',
  mange: 'eating', manger: 'eating', mangeant: 'eating', vole: 'flying', volant: 'flying', court: 'running', tombe: 'falling', crie: 'screaming', parle: 'talking', parlent: 'talking', pleure: 'crying', combattent: 'fighting', bagarre: 'fight', baiser: 'kiss',
  publicite: 'advertisement', pub: 'advertisement', couverture: 'cover', titre: 'title', auteurs: 'credits', credits: 'credits', planete: 'planet', ciel: 'sky', nuit: 'night', espace: 'outer space', foule: 'crowd', visage: 'face', gros: 'close', plan: 'shot',
  homme: 'man', femme: 'woman', enfant: 'child', robot: 'robot', monstre: 'monster', armure: 'armor', cape: 'cape', masque: 'mask', epee: 'sword', bouclier: 'shield', ville: 'city', immeuble: 'building', bureau: 'office', vaisseau: 'spaceship',
};
const FR_STOP = new Set('le la les un une des de du d l au aux et ou qui que quoi dont en dans sur sous avec pour par sans ce cet cette ces son sa ses leur leurs il elle ils elles on se ne pas plus tres est sont a ont'.split(' '));

/** French description → words CLIP understands: function words dropped, French bridged to English, names kept */
export function clipQuery(q: string): string {
  const out: string[] = [];
  for (const w of q.split(/[\s,.;:!?'’]+/).filter(Boolean)) {
    const n = norm(w);
    if (FR_STOP.has(n)) continue;
    const t = VIS[n] ?? translations(n)[0];
    out.push(t ?? w);
  }
  return out.join(' ');
}

/** fingerprint distance (bits that differ; the fingerprint is a string of 0 and 1) */
const hamming = (a: string, b: string) => { let d = 0; for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++; return d + Math.abs(a.length - b.length); };
/** a nearly flat picture gives a fingerprint of (almost) only zeros or ones: it can't tell two pages apart */
export const informative = (h: string) => { const ones = [...h].filter((c) => c === '1').length; return ones >= 6 && ones <= h.length - 6; };
/** pictures that are the same page (fingerprint within 4 bits), imported more than once */
export function duplicates(entries: LibEntry[]): LibEntry[][] {
  const imgs = entries.filter((e) => e.kind === 'image' && e.hash && informative(e.hash));
  const groups: LibEntry[][] = [];
  const done = new Set<string>();
  for (const a of imgs) {
    if (done.has(a.id)) continue;
    const g = imgs.filter((b) => !done.has(b.id) && hamming(a.hash!, b.hash!) <= 4 && Math.abs((a.width ?? 1) / (a.height ?? 1) - (b.width ?? 1) / (b.height ?? 1)) < 0.02);
    if (g.length > 1) { g.forEach((x) => done.add(x.id)); groups.push(g); }
  }
  return groups;
}

/* ---------------------------------------------------------------- workspace side */

export async function scanLibrary(ws: Workspace): Promise<{ entries: LibEntry[]; index: LibIndex }> {
  const metas = await ws.listProjects();
  const projects = (await Promise.all(metas.map((m) => ws.readProject(m.id)))).filter((x): x is { project: Project; savedAt: string } => !!x);
  const entries = entriesFrom(projects);
  const index = await readIndex(ws);
  for (const e of entries) {
    const it = index.items[e.id];
    if (it?.hash && !e.hash) e.hash = it.hash;
    const info = await ws.mediaInfo(e.id);
    if (info) { e.size = info.size; e.addedAt = info.addedAt; }
  }
  return { entries, index };
}
export async function readIndex(ws: Workspace): Promise<LibIndex> {
  try { const t = await ws.readData('index.json'); const d = t ? JSON.parse(t) : null; return d?.v === 1 ? d : { v: 1, items: {} }; } catch { return { v: 1, items: {} }; }
}
export const writeIndex = (ws: Workspace, ix: LibIndex) => ws.writeData('index.json', JSON.stringify(ix));
