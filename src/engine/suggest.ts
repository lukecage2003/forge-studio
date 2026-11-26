/**
 * Turns a script suggestion (engine/scriptIntel) into an element of the edit,
 * as a pure function: used by the "Accepter" button and by the production
 * models of the auto edit. Images come only from the user's own panels; when
 * none fits, the element is created without image for the user to fill.
 */
import type { DiagramKind, FxItem, Project, Rect, Shot } from '../types';
import { newShot } from '../store';
import { uid } from '../lib/util';
import type { Suggestion } from './scriptIntel';
import { layoutShots } from './timeline';

/** a panel that shows `name`: tagged characters, name tag, the sentence it illustrates, then its balloon text */
export function panelShowing(p: Project, name: string, passage?: string): { pageId?: string; rect?: Rect } {
  const k = name.toLowerCase().trim();
  if (!k) return {};
  const shots = p.shots.filter((s) => s.pageId);
  const hit = shots.find((s) => s.chars?.some((c) => c.toLowerCase() === k))
    ?? shots.find((s) => s.nameTag?.toLowerCase() === k)
    ?? (passage ? shots.find((s) => s.match?.sentence && passage.includes(s.match.sentence.slice(0, 30))) : undefined)
    ?? shots.find((s) => (s.text ?? '').toLowerCase().includes(k));
  return hit ? { pageId: hit.pageId!, rect: hit.rect } : {};
}

const DK: Record<string, DiagramKind> = { chronologie: 'timeline', reseau: 'network', versus: 'versus', echelle: 'scale', citation: 'quote', carte: 'map' };

export function suggestionElement(p: Project, sg: Suggestion, passageText = ''): { shot?: Shot; fx?: Partial<FxItem> } {
  const overlay = !!p.aroll;
  if (sg.kind === 'titre' && overlay) return { fx: { start: sg.at, duration: 1.4, text: sg.title.toUpperCase() } };
  const lookup = (it: Suggestion['items'][number]) =>
    sg.kind === 'echelle' || sg.kind === 'carte' ? {} : panelShowing(p, sg.kind === 'chronologie' || sg.kind === 'citation' ? (it.sub ?? '') : it.label, passageText);
  const diagram = sg.kind === 'titre' ? undefined : {
    kind: DK[sg.kind], title: sg.kind === 'citation' ? '' : sg.title, links: [],
    items: sg.items.map((it) => ({ id: uid('di_'), label: it.label, sub: it.sub ?? '', ...lookup(it) })),
  };
  const dur = sg.kind === 'titre' ? 1.8 : sg.kind === 'citation' ? Math.min(9, 3 + (sg.items[0]?.label.split(' ').length ?? 8) * 0.3)
    : sg.kind === 'chronologie' || sg.kind === 'reseau' || sg.kind === 'carte' ? 7 : 5;
  const shot = newShot(p, {
    pageId: null, duration: dur, transition: 'fade', transitionDur: 0.4, layout: 'full',
    start: overlay ? sg.at : undefined,
    caption: { ...p.defaultCaption, text: sg.kind === 'titre' ? sg.title.toUpperCase() : '', ...(sg.kind === 'titre' ? { preset: 'impact' as const, anim: 'pop' as const } : {}) },
    ...(sg.kind === 'titre' ? { titleBg: '#0E0E11' } : { diagram }),
  });
  shot.id = 'sg_' + uid();
  return { shot };
}

/** insert a shot where the narration reaches `at` (face-cam projects keep absolute starts) */
export function insertAtTime(p: Project, shot: Shot, at: number): Shot[] {
  if (p.aroll) return [...p.shots, shot];
  let t = 0, i = p.shots.length;
  for (let k = 0; k < p.shots.length; k++) { if (t >= at - 0.05) { i = k; break; } t += p.shots[k].duration; }
  return [...p.shots.slice(0, i), shot, ...p.shots.slice(i)];
}

/** after inserting visuals: never the same visible transition twice in a row (the second becomes a cut) */
export function fixRepeats(p: Project): Shot[] {
  const timed = layoutShots(p);
  const quiet = (t: string) => t === 'cut' || t === 'glide';
  const toCut = new Set<string>();
  for (let i = 1; i < timed.length; i++) {
    const a = timed[i - 1].shot, b = timed[i].shot;
    if (!quiet(b.transition) && b.transition === (toCut.has(a.id) ? 'cut' : a.transition)) toCut.add(b.id);
  }
  return toCut.size ? p.shots.map((s) => (toCut.has(s.id) ? { ...s, transition: 'cut' as const, transitionDur: 0, tp: undefined } : s)) : p.shots;
}
