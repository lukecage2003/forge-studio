import type { Layout, Motion, Project, Transition } from '../types';
import { layoutShots } from './timeline';

/**
 * PRECISE CHANGES — the assistant's chat reads exact requests on its own, without
 * any AI (free, always the same answer): « plan 3 : 4 s », « supprime le plan 5 »,
 * « transition fondu au plan 2 », « zoom avant sur le plan 4 », « plan 6 en écran
 * partagé », « remplace « Rorchach » par « Rorschach » », « musique moins forte »,
 * « sous-titres plus gros », « titre « LA FIN » à 40 s ». Every change is a
 * proposal the user applies (AssistantModal), one undo step each.
 */
export type PreciseProposal =
  | { type: 'shot.duration'; shotId: string; seconds: number; raison?: string }
  | { type: 'shot.transition'; shotId: string; transition: string; raison?: string }
  | { type: 'shot.delete'; shotId: string; raison?: string }
  | { type: 'shot.layout'; shotId: string; layout: Layout; raison?: string }
  | { type: 'shot.motion'; shotId: string; motion: Motion; raison?: string }
  | { type: 'subtitle.replace'; from: string; to: string; count: number; raison?: string }
  | { type: 'music.volume'; factor: number; raison?: string }
  | { type: 'subs.size'; factor: number; raison?: string }
  | { type: 'title.add'; at: number; text: string; raison?: string };

const TRANS: [RegExp, Transition][] = [[/fondu|fade/, 'fade'], [/coupe|cut|sans transition/, 'cut'], [/gliss|slide/, 'slide'], [/zoom/, 'zoom'], [/flash|blanc/, 'flash'], [/fouet|whip/, 'whip'], [/encre|ink/, 'inkbleed'], [/trame|halftone/, 'halftone'], [/iris/, 'iris']];
const LAYOUTS: [RegExp, Layout][] = [[/plein écran|plein ecran/, 'full'], [/écran partagé|ecran partage|split/, 'split'], [/bulle visage|incrust|pip/, 'pip'], [/multi-?cases|grille/, 'grid'], [/page entière|page entiere|planche entière/, 'page']];
const MOTIONS: [RegExp, Motion][] = [[/zoom avant|rapproche|zoom in/, 'zoom-in'], [/zoom arrière|zoom arriere|recule|zoom out/, 'zoom-out'], [/vers la gauche|panoramique gauche/, 'pan-left'], [/vers la droite|panoramique droite|panoramique/, 'pan-right'], [/vers le haut/, 'pan-up'], [/vers le bas/, 'pan-down'], [/fixe|immobile|sans mouvement/, 'static'], [/lis les bulles|lecture/, 'read'], [/explor/, 'tour']];
const num = (s: string) => parseFloat(s.replace(',', '.'));

/** the shots a request names: « plan 3 », « plans 2 et 4 », « à 12 s », « ce plan » (the selection) */
function targets(c: string, p: Project, selected?: string | null): string[] {
  const timed = layoutShots(p);
  const ids: string[] = [];
  for (const m of c.matchAll(/(?:plans?|cases?)\s+((?:\d+(?:\s*(?:,|et|à|-)\s*)?)+)/g)) {
    const nums = m[1].match(/\d+/g)!.map(Number);
    const range = /à|-/.test(m[1]) && nums.length === 2 ? Array.from({ length: nums[1] - nums[0] + 1 }, (_, i) => nums[0] + i) : nums;
    for (const n of range) if (timed[n - 1]) ids.push(timed[n - 1].shot.id);
  }
  const at = c.match(/(?:à|a|vers)\s+(\d+(?:[.,]\d+)?)\s*(?:s\b|sec)/);
  if (!ids.length && at && !/titre/.test(c)) { const t = num(at[1]); const ts = timed.find((x) => t >= x.start && t < x.end); if (ts) ids.push(ts.shot.id); }
  if (!ids.length && /(ce|cet|le) plan|sélection|selection|celui-ci|celle-ci/.test(c) && selected) ids.push(selected);
  return [...new Set(ids)];
}

export function parsePrecise(command: string, p: Project, selected?: string | null): PreciseProposal[] | null {
  const c = command.toLowerCase().replace(/[’']/g, "'");
  const out: PreciseProposal[] = [];
  const quoted = [...command.matchAll(/[«"“]\s*([^»"”]+?)\s*[»"”]/g)].map((m) => m[1]);
  // subtitles: replace a word or an expression
  if (/remplace|corrige/.test(c) && quoted.length >= 2) {
    const [from, to] = quoted;
    const count = p.subtitles.reduce((a, s) => a + (s.text.split(from).length - 1), 0);
    out.push({ type: 'subtitle.replace', from, to, count, raison: count ? `${count} fois dans les sous-titres` : 'introuvable dans les sous-titres' });
    return out;
  }
  if (/titre/.test(c) && quoted.length) {
    const at = c.match(/(\d+(?:[.,]\d+)?)\s*(?:s\b|sec)/);
    out.push({ type: 'title.add', at: at ? num(at[1]) : 0, text: quoted[0].slice(0, 40), raison: 'demandé dans le chat' });
    return out;
  }
  if (/musique/.test(c) && /(plus|moins)\s+(fort|bas|haut)|baisse|monte/.test(c)) {
    const up = /plus fort|plus haut|monte/.test(c);
    out.push({ type: 'music.volume', factor: up ? 1.3 : 0.7, raison: up ? 'musique +30 %' : 'musique −30 %' });
    return out;
  }
  if (/sous-?titres?/.test(c) && /(plus|moins)\s+(gros|grand|petit)|agrandi|rédui/.test(c)) {
    const up = /plus gros|plus grand|agrandi/.test(c);
    out.push({ type: 'subs.size', factor: up ? 1.2 : 0.83, raison: up ? 'sous-titres +20 %' : 'sous-titres −17 %' });
    return out;
  }
  const ids = targets(c, p, selected);
  if (!ids.length) return null;
  const why = 'demandé dans le chat';
  for (const id of ids) {
    if (/supprim|enlève|enleve|retire/.test(c)) { out.push({ type: 'shot.delete', shotId: id, raison: why }); continue; }
    // the duration asked, once « à 12 s » (where the shot is) is set aside
    const dur = c.replace(/(?:à|a|vers)\s+\d+(?:[.,]\d+)?\s*(?:s\b|sec\w*)/g, ' ').match(/(\d+(?:[.,]\d+)?)\s*(?:s\b|sec)/g)?.map((x) => num(x)).find((v) => v >= 0.5 && v <= 30);
    const shot = p.shots.find((s) => s.id === id)!;
    if (dur && !/transition/.test(c) && (/:|durée|duree|dure|raccourci|allonge|mets|met /.test(c))) out.push({ type: 'shot.duration', shotId: id, seconds: dur, raison: why });
    else if (/raccourci|plus court/.test(c)) out.push({ type: 'shot.duration', shotId: id, seconds: Math.max(0.8, +(shot.duration * 0.7).toFixed(1)), raison: 'plus court de 30 %' });
    else if (/allonge|plus long/.test(c)) out.push({ type: 'shot.duration', shotId: id, seconds: Math.min(30, +(shot.duration * 1.4).toFixed(1)), raison: 'plus long de 40 %' });
    const tr = /transition/.test(c) && TRANS.find(([re]) => re.test(c));
    if (tr) out.push({ type: 'shot.transition', shotId: id, transition: tr[1], raison: why });
    const lay = LAYOUTS.find(([re]) => re.test(c));
    if (lay) out.push({ type: 'shot.layout', shotId: id, layout: lay[1], raison: why });
    const mo = !tr && MOTIONS.find(([re]) => re.test(c));
    if (mo) out.push({ type: 'shot.motion', shotId: id, motion: mo[1], raison: why });
  }
  return out.length ? out : null;
}
