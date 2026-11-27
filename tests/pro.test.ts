import { describe, expect, it } from 'vitest';
import { newProject, newShot } from '../src/store';
import { chapterCards, coverPicks, firstSecondIssues, moodOf, musicCurve, onomatopoeias, untouched, withFramingVariety, withProFinish } from '../src/engine/pro';
import { compact } from '../src/ai/orchestrator';
import type { Motion, Project } from '../src/types';

const page = (id: string, kind = 'story') => ({ id, mediaId: id, name: id, width: 1000, height: 1500, kind }) as never;
const auto = (motion: Motion = 'zoom-in') => ({ duration: 2, layout: 'full' as const, motion, style: 'x' });
function proj(over: Partial<Project> = {}): Project {
  const p = newProject();
  const shots = [
    newShot(p, { id: 'a', pageId: 'p1', rect: { x: 0, y: 0, w: 300, h: 200 }, duration: 2, motion: 'zoom-in', transition: 'cut', auto: auto() }),
    newShot(p, { id: 'b', pageId: 'p1', rect: { x: 0, y: 300, w: 600, h: 500 }, duration: 2, motion: 'zoom-in', text: 'KRAKOOM! BOOM!', chars: ['Hulk'], auto: auto() }),
    newShot(p, { id: 'c', pageId: 'p2', rect: { x: 0, y: 0, w: 1000, h: 1500 }, duration: 2, motion: 'zoom-in', chars: ['Hulk', 'Thor'], auto: auto() }),
    newShot(p, { id: 'd', pageId: 'p1', rect: { x: 0, y: 900, w: 300, h: 200 }, duration: 2, motion: 'zoom-in', balloons: [{ x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 1, h: 1 }] }),
  ];
  return { ...p, format: '9:16', pages: [page('p1'), page('p2', 'splash')], shots, ...over };
}

describe('finition pro', () => {
  it('onomatopée : la case secoue, zoome, prend un impact, et dit pourquoi', () => {
    const p = proj();
    expect(onomatopoeias(p).map((h) => [h.shotId, h.word])).toEqual([['b', 'BOOM']]);
    const b = withProFinish(p).shots.find((s) => s.id === 'b')!;
    expect(b.shake).toBeGreaterThanOrEqual(0.6);
    expect(b.sfx).toBe('impact');
    expect(b.why).toContain('BOOM');
  });
  it('un plan modifié à la main n’est jamais touché', () => {
    const p = proj();
    const hand = { ...p, shots: p.shots.map((s) => (s.id === 'b' ? { ...s, motion: 'static' as const } : s)) };
    expect(untouched(hand.shots[1])).toBe(false);
    expect(withProFinish(hand).shots[1]).toBe(hand.shots[1]);
  });
  it('humeur : action ou émotion d’après les mots', () => {
    expect(moodOf('Hulk frappe Thor et tout explose')).toBe('action');
    expect(moodOf('Il meurt seul, en silence')).toBe('emotion');
    expect(moodOf('Il habite New York')).toBeNull();
  });
  it('variété : pas trois fois le même mouvement d’affilée', () => {
    const v = withFramingVariety(proj());
    expect(v.shots[2].motion).not.toBe('zoom-in');
    expect(v.shots[2].auto?.motion).toBe(v.shots[2].motion);
  });
  it('chapitres et musique suivent les séquences du directeur', () => {
    const p = proj({ direction: { profile: 'x', sequences: [
      { type: 'introduction', treatment: '', label: 'Intro', from: 0, to: 0, start: 0 },
      { type: 'explication', treatment: '', label: 'Le contexte', from: 1, to: 1, start: 2 },
      { type: 'revelation', treatment: '', label: 'La révélation', from: 2, to: 3, start: 4 },
    ] } });
    expect(chapterCards(p).map((f) => f.text)).toEqual(['2. COMMENT ÇA MARCHE', '3. LA RÉVÉLATION']);
    const c = musicCurve(p);
    expect(c.find(([t]) => t === 4)?.[1]).toBeGreaterThan(c.find(([t]) => t === 2)![1]);
    const f = withProFinish(p);
    expect(f.loopEnd).toBe(true);
    expect(withProFinish(f).fx.filter((x) => x.kind === 'chapter')).toHaveLength(2); // re-run: no duplicate
  });
  it('couverture TikTok : la pleine page avec deux personnages d’abord, deux cases différentes', () => {
    expect(coverPicks(proj()).map((s) => s.id)).toEqual(['c', 'b']);
  });
  it('première seconde : transition au départ et image fixe signalées, avec correction', () => {
    const p = proj();
    const bad = { ...p, shots: p.shots.map((s, i) => (i === 0 ? { ...s, transition: 'fade' as const, motion: 'static' as const } : s)) };
    const iss = firstSecondIssues(bad);
    expect(iss.length).toBe(2);
    const fixed = iss.reduce((x, i) => i.fix!.apply(x), bad);
    expect(firstSecondIssues(fixed)).toHaveLength(0);
  });
  it('requêtes IA plus courtes : espaces et lignes vides en trop retirés', () => {
    expect(compact('a  b \n\n\n\nc   ')).toBe('a b\n\nc');
  });
});
describe('cases larges en vertical', () => {
  it('une case en bandeau est filmée en panoramique sur environ la moitié de sa largeur', () => {
    const p = proj();
    const wide = { ...p, shots: [{ ...p.shots[0], rect: { x: 0, y: 0, w: 2000, h: 450 } }] };
    const s = withProFinish(wide).shots[0];
    expect(s.path).toHaveLength(2);
    expect(s.path![0].vw).toBeGreaterThanOrEqual(1000);
    expect(s.path![0].cx).toBeLessThan(s.path![1].cx);
    expect(withProFinish({ ...wide, format: '16:9' }).shots[0].path).toBeUndefined();
  });
});
