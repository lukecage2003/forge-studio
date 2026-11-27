import type { Project } from '../types';
import { videoDuration } from './timeline';

/**
 * VERSION COMPARISON — what changed between two states of a project, in the
 * words of an editor: length, shots added / removed / changed (picture,
 * duration, camera, transition), subtitles, sound, storyboard, look.
 */
export interface DiffLine { kind: 'add' | 'del' | 'mod' | 'same'; text: string }

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function compareProjects(before: Project, after: Project): DiffLine[] {
  const out: DiffLine[] = [];
  const d0 = videoDuration(before), d1 = videoDuration(after);
  if (Math.abs(d1 - d0) > 0.05) out.push({ kind: 'mod', text: `Durée : ${fmt(d0)} → ${fmt(d1)} (${d1 > d0 ? '+' : ''}${(d1 - d0).toFixed(1)} s)` });
  const a = new Map(before.shots.map((s) => [s.id, s])), b = new Map(after.shots.map((s) => [s.id, s]));
  const added = after.shots.filter((s) => !a.has(s.id)), removed = before.shots.filter((s) => !b.has(s.id));
  if (added.length) out.push({ kind: 'add', text: `${added.length} plan${added.length > 1 ? 's' : ''} ajouté${added.length > 1 ? 's' : ''}` });
  if (removed.length) out.push({ kind: 'del', text: `${removed.length} plan${removed.length > 1 ? 's' : ''} retiré${removed.length > 1 ? 's' : ''}` });
  let pic = 0, dur = 0, cam = 0, tr = 0, txt = 0;
  for (const s of after.shots) {
    const o = a.get(s.id);
    if (!o) continue;
    if (o.pageId !== s.pageId || JSON.stringify(o.rect) !== JSON.stringify(s.rect)) pic++;
    if (Math.abs(o.duration - s.duration) > 0.05) dur++;
    if (o.motion !== s.motion || JSON.stringify(o.path ?? null) !== JSON.stringify(s.path ?? null)) cam++;
    if (o.transition !== s.transition) tr++;
    if (o.caption.text !== s.caption.text) txt++;
  }
  const mod = (n: number, what: string) => n && out.push({ kind: 'mod', text: `${n} plan${n > 1 ? 's' : ''} : ${what}` });
  mod(pic, 'autre image ou autre cadrage'); mod(dur, 'durée changée'); mod(cam, 'mouvement de caméra changé'); mod(tr, 'transition changée'); mod(txt, 'texte à l’écran changé');
  const order = (p: Project) => p.shots.map((s) => s.id).filter((id) => a.has(id) && b.has(id)).join(',');
  if (!added.length && !removed.length && order(before) !== order(after)) out.push({ kind: 'mod', text: 'Ordre des plans changé' });
  const subs = (p: Project) => p.subtitles.map((x) => x.text).join('|');
  if (subs(before) !== subs(after)) out.push({ kind: 'mod', text: `Sous-titres : ${before.subtitles.length} → ${after.subtitles.length} blocs${before.subtitles.length === after.subtitles.length ? ' (textes modifiés)' : ''}` });
  const audio = (p: Project) => p.audio.map((x) => `${x.name}@${x.start.toFixed(1)}/${x.volume}`).join('|');
  if (audio(before) !== audio(after)) out.push({ kind: 'mod', text: `Son : ${before.audio.length} → ${after.audio.length} piste${after.audio.length > 1 ? 's' : ''} (ou réglages changés)` });
  if (JSON.stringify(before.mix) !== JSON.stringify(after.mix)) out.push({ kind: 'mod', text: 'Réglages du mixage changés' });
  if ((before.aroll?.cuts.filter((c) => c.on).length ?? 0) !== (after.aroll?.cuts.filter((c) => c.on).length ?? 0)) out.push({ kind: 'mod', text: `Coupes du rush : ${before.aroll?.cuts.filter((c) => c.on).length ?? 0} → ${after.aroll?.cuts.filter((c) => c.on).length ?? 0}` });
  const toned = after.pages.filter((pg) => JSON.stringify(pg.tone ?? null) !== JSON.stringify(before.pages.find((x) => x.id === pg.id)?.tone ?? null)).length;
  if (toned) out.push({ kind: 'mod', text: `Couleurs harmonisées ou modifiées sur ${toned} planche${toned > 1 ? 's' : ''}` });
  if (before.pages.length !== after.pages.length) out.push({ kind: after.pages.length > before.pages.length ? 'add' : 'del', text: `Planches : ${before.pages.length} → ${after.pages.length}` });
  const sb = (p: Project) => JSON.stringify(p.storyboard?.rows.map((r) => [r.shotId, r.mode, r.camera, r.sound]) ?? null);
  if (sb(before) !== sb(after)) out.push({ kind: 'mod', text: 'Storyboard modifié' });
  if (JSON.stringify([before.look, before.art, before.titleStyle, before.subtitleStyle]) !== JSON.stringify([after.look, after.art, after.titleStyle, after.subtitleStyle])) out.push({ kind: 'mod', text: 'Style changé (look, direction artistique, titres ou sous-titres)' });
  if (before.format !== after.format) out.push({ kind: 'mod', text: `Format : ${before.format} → ${after.format}` });
  if (!out.length) out.push({ kind: 'same', text: 'Aucune différence' });
  return out;
}
