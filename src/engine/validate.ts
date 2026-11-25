import type { Project, Rect, Shot } from '../types';
import { arollDuration } from './timeline';
import { TRANSITION } from './effects';

/**
 * Last line of defence: repairs anything that would make a frame fail or look
 * broken (missing pages, NaN timings, panels outside their page, overlaps,
 * audio past its source). Runs after every auto edit and before every export.
 */
const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function validateProject(p: Project): { project: Project; fixes: string[] } {
  const fixes: string[] = [];
  const pages = new Map(p.pages.map((pg) => [pg.id, pg]));
  const clampRect = (r: Rect, pageId: string): Rect | null => {
    const pg = pages.get(pageId);
    if (!pg || !r || ![r.x, r.y, r.w, r.h].every(ok)) return null;
    const x = Math.max(0, Math.min(pg.width - 8, r.x)), y = Math.max(0, Math.min(pg.height - 8, r.y));
    const w = Math.max(8, Math.min(pg.width - x, r.w)), h = Math.max(8, Math.min(pg.height - y, r.h));
    return { x, y, w, h };
  };

  let shots: Shot[] = [];
  for (const s of p.shots) {
    let shot = { ...s };
    if (shot.pageId != null) {
      const r = clampRect(shot.rect, shot.pageId);
      if (!r) { fixes.push('plan sans page retiré'); continue; }
      shot.rect = r;
      if (shot.group?.length) {
        const g = shot.group.map((it) => ({ ...it, rect: clampRect(it.rect, it.pageId) })).filter((it): it is { pageId: string; rect: Rect } => !!it.rect);
        if (g.length !== shot.group.length) fixes.push('case de groupe invalide retirée');
        shot.group = g;
        if (!g.length && shot.layout === 'grid') shot.layout = 'full';
      }
    }
    if (!ok(shot.duration) || shot.duration < 0.3) { shot.duration = Math.max(0.3, ok(shot.duration) ? shot.duration : 2); fixes.push('durée corrigée'); }
    if (!TRANSITION[shot.transition]) { shot.transition = 'fade'; shot.tp = undefined; fixes.push('transition inconnue remplacée par un fondu'); }
    if (shot.tp) {
      const def = TRANSITION[shot.transition];
      const clean: Record<string, number> = {};
      for (const pa of def.params) { const v = shot.tp[pa.key]; if (ok(v)) clean[pa.key] = Math.min(pa.max, Math.max(pa.min, v)); }
      shot.tp = Object.keys(clean).length ? clean : undefined;
    }
    if (!ok(shot.transitionDur) || shot.transitionDur < 0) shot.transitionDur = 0;
    shot.transitionDur = Math.min(shot.transitionDur, shot.duration * 0.45);
    if (!ok(shot.intensity)) shot.intensity = 0.5;
    if (!ok(shot.shake)) shot.shake = 0;
    if (p.aroll && (!ok(shot.start) || shot.start! < 0)) { shot.start = 0; fixes.push('début corrigé'); }
    if (shot.diagram) {
      shot.diagram = { ...shot.diagram, items: shot.diagram.items.filter((it) => !it.pageId || pages.has(it.pageId)).map((it) => (it.pageId && it.rect ? { ...it, rect: clampRect(it.rect, it.pageId) ?? undefined } : it)) };
    }
    shots.push(shot);
  }

  // overlay mode: nothing after the end of the video, no hidden overlaps
  if (p.aroll) {
    const end = arollDuration(p);
    shots = shots.filter((s) => (s.start ?? 0) < end - 0.2 || s.pageId == null);
    shots.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      if ((s.start ?? 0) + s.duration > end) s.duration = Math.max(0.3, end - (s.start ?? 0));
      const n = shots[i + 1];
      if (n && (s.start ?? 0) + s.duration > (n.start ?? 0) + 0.01) {
        const d = (n.start ?? 0) - (s.start ?? 0);
        if (d >= 0.3) { s.duration = d; fixes.push('chevauchement corrigé'); }
        else { n.start = (s.start ?? 0) + s.duration; fixes.push('chevauchement corrigé'); }
      }
      s.transitionDur = Math.min(s.transitionDur, s.duration * 0.45);
    }
  }

  const audio = p.audio
    .filter((c) => ok(c.start) && ok(c.duration) && ok(c.sourceDuration))
    .map((c) => {
      const offset = Math.max(0, Math.min(c.offset || 0, c.sourceDuration - 0.1));
      return { ...c, start: Math.max(0, c.start), offset, duration: Math.max(0.1, Math.min(c.duration, c.sourceDuration - offset)), volume: ok(c.volume) ? c.volume : 1 };
    });
  if (audio.length !== p.audio.length) fixes.push('clip audio invalide retiré');

  const subtitles = p.subtitles
    .filter((s) => ok(s.s) && ok(s.e) && s.e > s.s && s.text.trim())
    .sort((a, b) => a.s - b.s);

  const aroll = p.aroll
    ? { ...p.aroll, cuts: p.aroll.cuts.filter((c) => ok(c.s) && ok(c.e) && c.e > c.s).map((c) => ({ ...c, s: Math.max(0, c.s), e: Math.min(p.aroll!.duration, c.e) })) }
    : null;

  return { project: { ...p, shots, audio, subtitles, aroll }, fixes: [...new Set(fixes)] };
}
