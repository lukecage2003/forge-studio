import { describe, expect, it } from 'vitest';
import { newProject, newShot } from '../src/store';
import { applyNameFixes, hookCandidate, nameFixes, openWith, repeatedPanels, shortRanges, balloonTimes } from '../src/engine/polish';
import { sliderX } from '../src/engine/overlays';
import type { Project } from '../src/types';

const page = (id: string, kind = 'story') => ({ id, mediaId: id, name: id, width: 1000, height: 1500, kind }) as never;
function proj(over: Partial<Project> = {}): Project {
  const p = newProject();
  const shots = [
    newShot(p, { id: 'a', pageId: 'p1', rect: { x: 0, y: 0, w: 300, h: 200 }, duration: 2, auto: { duration: 2, layout: 'full', motion: 'auto', style: 'x' } }),
    newShot(p, { id: 'b', pageId: 'p2', rect: { x: 0, y: 0, w: 1000, h: 1500 }, duration: 2, auto: { duration: 2, layout: 'full', motion: 'auto', style: 'x' } }),
    newShot(p, { id: 'c', pageId: 'p1', rect: { x: 0, y: 300, w: 300, h: 200 }, duration: 2 }),
    newShot(p, { id: 'd', pageId: 'p1', rect: { x: 0, y: 600, w: 300, h: 200 }, duration: 2 }),
  ];
  return { ...p, pages: [page('p1'), page('p2', 'splash')], shots, ...over };
}

describe('finitions du montage', () => {
  it('accroche : la pleine page passe en premier, sans toucher au reste', () => {
    const p = proj();
    expect(hookCandidate(p)?.id).toBe('b');
    expect(openWith(p, 'b').shots.map((s) => s.id)).toEqual(['b', 'a', 'c', 'd']);
  });
  it('une case montrée deux fois de suite ou plus de deux fois est signalée', () => {
    const p = proj();
    const dup = { ...p, shots: [...p.shots, { ...p.shots[3], id: 'e' }] };
    expect(repeatedPanels(dup)).toHaveLength(1);
    expect(repeatedPanels(p)).toHaveLength(0);
  });
  it('noms mal écrits dans les sous-titres corrigés d’après le script', () => {
    const p = proj({ script: 'Galactus arrive. Le Surfeur d’argent le guide. Galactus a faim.', subtitles: [{ s: 0, e: 1, text: 'Galactos arrive', words: [{ w: 'Galactos', s: 0, e: 0.5 }, { w: 'arrive', s: 0.5, e: 1 }] }] });
    const f = nameFixes(p);
    expect(f[0]).toMatchObject({ from: 'Galactos', to: 'Galactus' });
    const fixed = applyNameFixes(p.subtitles, f);
    expect(fixed[0].text).toBe('Galactus arrive');
    expect(fixed[0].words[0].w).toBe('Galactus');
  });
  it('bulles sur les mots dits pendant le plan ; sans voix, null (rythme fixe)', () => {
    const p = proj({ subtitles: [] });
    expect(balloonTimes(p, 'a', 0, 2, 2)).toBeNull();
  });
  it('version courte : rien sans voix ; le curseur de comparaison balaie de droite à gauche', () => {
    expect(shortRanges(proj())).toEqual([]);
    const o = { id: 'o', track: 1, start: 0, duration: 4, source: { kind: 'image', mediaId: 'x' }, place: 'slider', zoom: 0, fade: 0 } as never;
    expect(sliderX(o, 0, 1000)).toBeCloseTo(920);
    expect(sliderX(o, 2, 1000)).toBeCloseTo(500);
    expect(sliderX(o, 4, 1000)).toBeCloseTo(80);
  });
});

describe('zoom sur le personnage nommé (décision)', () => {
  it('9 fenêtres qui se chevauchent dans la case ; on ne zoome que si une fenêtre ressort nettement', async () => {
    const { windowsOf, pickWindow, focusPath } = await import('../src/engine/nameFocus');
    const w = windowsOf({ x: 0, y: 0, w: 400, h: 200 });
    expect(w).toHaveLength(9);
    expect(w[8]).toEqual({ x: 200, y: 100, w: 200, h: 100 });
    expect(pickWindow([0.01, 0.012, 0.011, 0.05, 0.01, 0.012, 0.011, 0.013, 0.01])).toBe(3);
    expect(pickWindow([0.01, 0.012, 0.011, 0.015, 0.01, 0.012, 0.011, 0.013, 0.01])).toBeNull();
    const path = focusPath({ rect: { x: 0, y: 0, w: 400, h: 200 } } as never, w[8]);
    expect(path![1]).toMatchObject({ cx: 300, cy: 150 });
  });
});
