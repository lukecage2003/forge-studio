import { describe, expect, it } from 'vitest';
import { harmonize, toneStats, toneFilter } from '../src/engine/color';
import { checkSource } from '../src/engine/audioCheck';
import { compareProjects } from '../src/engine/versionDiff';
import { newProject, newShot } from '../src/store';

const page = (r: number, g: number, b: number, n = 400) => { const px = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { const dark = i % 4 === 0; px.set(dark ? [10, 10, 10, 255] : [r, g, b, 255], i * 4); } return px; };

describe('cohérence des couleurs', () => {
  it('propose de corriger la page plus sombre d’un numéro, jamais les couvertures', () => {
    const ok = toneStats(page(240, 236, 228)), dark = toneStats(page(190, 186, 180));
    const pages = ['a', 'b', 'c', 'd'].map((id) => ({ id, source: 'x.pdf', kind: 'story' as const, stats: ok }));
    pages.push({ id: 'sombre', source: 'x.pdf', kind: 'story', stats: dark });
    pages.push({ id: 'couv', source: 'x.pdf', kind: 'cover' as never, stats: dark });
    const fix = harmonize(pages);
    expect(fix.map((f) => f.id)).toEqual(['sombre']);
    expect(fix[0].tone.brightness).toBeGreaterThan(1.15);
    expect(fix[0].why).toMatch(/sombre/);
    expect(toneFilter(fix[0].tone)).toMatch(/^brightness\(/);
  });
  it('une page sans papier visible (une seule case peinte) n’est pas jugée', () => {
    const painted = new Uint8ClampedArray(400 * 4); for (let i = 0; i < 400; i++) painted.set([200, 40, 30, 255], i * 4);
    expect(Number.isNaN(toneStats(painted).paper)).toBe(true);
    const ok = toneStats(page(240, 236, 228));
    const pages = ['a', 'b', 'c', 'd'].map((id) => ({ id, kind: 'story' as const, stats: ok }));
    expect(harmonize([...pages, { id: 'peinte', kind: 'story', stats: toneStats(painted) }])).toEqual([]);
  });
  it('marges colorées par la mise en couleur (pas du papier blanc) : rien n’est jugé', () => {
    const tan = toneStats(page(170, 140, 100)), tan2 = toneStats(page(120, 100, 70));
    const pages = ['a', 'b', 'c', 'd'].map((id) => ({ id, kind: 'story' as const, stats: tan }));
    expect(harmonize([...pages, { id: 'e', kind: 'story', stats: tan2 }])).toEqual([]);
  });
  it('moins de 4 planches : pas assez pour juger', () => {
    expect(harmonize([{ id: 'a', kind: 'story', stats: toneStats(page(250, 250, 250)) }, { id: 'b', kind: 'story', stats: toneStats(page(100, 100, 100)) }])).toEqual([]);
  });
});

describe('contrôle du son enregistré', () => {
  it('voit la saturation, le bruit de fond et la voix trop basse', () => {
    const sr = 8000;
    const voice = Float32Array.from({ length: sr * 4 }, (_, i) => (i < sr * 2 ? 0.3 * Math.sin(i / 3) : 0.0005 * Math.sin(i)));
    expect(checkSource([voice], sr)).toMatchObject({ clippedRuns: 0, lowLevel: false, noisy: false });
    const hot = Float32Array.from(voice, (v, i) => (i > 100 && i < 140 ? 1 : v));
    expect(checkSource([hot], sr).clippedRuns).toBe(1);
    const noisy = Float32Array.from(voice, (v, i) => v + 0.05 * Math.sin(i * 1.7));
    expect(checkSource([noisy], sr).noisy).toBe(true);
    expect(checkSource([Float32Array.from(voice, (v) => v * 0.02)], sr).lowLevel).toBe(true);
  });
});

describe('comparaison de versions', () => {
  it('dit ce qui a changé, en mots de monteur', () => {
    const p = newProject();
    const s1 = newShot(p, { duration: 2 }), s2 = newShot(p, { duration: 3 });
    const v1 = { ...p, shots: [s1, s2] };
    const v2 = { ...p, shots: [{ ...s1, duration: 4, motion: 'tour' as const }, newShot(p, { duration: 2 })] };
    const t = compareProjects(v1, v2).map((l) => l.text).join(' | ');
    expect(t).toMatch(/Durée/); expect(t).toMatch(/1 plan ajouté/); expect(t).toMatch(/1 plan retiré/); expect(t).toMatch(/durée changée/); expect(t).toMatch(/caméra/);
    expect(compareProjects(v1, v1)).toEqual([{ kind: 'same', text: 'Aucune différence' }]);
  });
});
