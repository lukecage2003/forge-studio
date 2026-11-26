import { describe, expect, it } from 'vitest';
import { directSequences, seqTypeOf, variety } from '../src/engine/director';
import type { Shot } from '../src/types';

const mk = (i: number, text: string, extra: Partial<Shot> = {}): Shot => ({
  id: 's' + i, pageId: 'p', rect: { x: 0, y: 0, w: 1000, h: 1000 }, duration: 3, transition: 'cut', transitionDur: 0, layout: 'full',
  motion: 'zoom-in', intensity: 0.6, shake: 0, framing: 'fill', caption: { text } as Shot['caption'],
  auto: { duration: 3, layout: 'full', motion: 'zoom-in', style: 'explainer' }, ...extra,
} as Shot);

const script = [
  'Qui est vraiment Dr Manhattan ?',
  'En 1959, Jon Osterman travaille dans un laboratoire militaire.',
  'Son père était horloger, en 1945.',
  'Il s’appelle Jon Osterman, et il deviendra un dieu.',
  'Parce que l’accident a dispersé ses atomes, il voit le temps autrement.',
  'Ce qui explique pourquoi il ne ressent plus rien.',
  'Mais la vérité est terrible : il savait déjà tout.',
  'Face à Ozymandias, il affronte un combat qu’il ne peut pas gagner.',
  'Au final, il quitte la Terre.',
];

describe('directeur créatif', () => {
  it('reconnaît les types de séquences', () => {
    expect(seqTypeOf(script[0], 0, 9)).toBe('introduction');
    expect(seqTypeOf(script[1], 1, 9)).toBe('contexte');
    expect(seqTypeOf(script[7], 7, 9)).toBe('confrontation');
    expect(seqTypeOf(script[8], 8, 9)).toBe('conclusion');
  });

  it('pense en séquences, chacune avec un traitement, deux séquences voisines jamais pareilles', () => {
    const shots = script.map((t, i) => mk(i, t));
    const { report } = directSequences(shots, 9 / 16);
    expect(report.sequences.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < report.sequences.length; i++) expect(report.sequences[i].treatment).not.toBe(report.sequences[i - 1].treatment);
  });

  it('casse la monotonie de caméra et les transitions répétées', () => {
    const shots = Array.from({ length: 10 }, (_, i) => mk(i, 'Il marche dans la ville.', { transition: i % 2 ? 'whip' : 'cut', transitionDur: i % 2 ? 0.3 : 0 }));
    const before = variety(shots);
    const { shots: out } = directSequences(shots, 9 / 16);
    const after = variety(out);
    expect(before.maxMotionRun).toBe(10);
    expect(after.maxMotionRun).toBeLessThanOrEqual(2);
    expect(after.closeRepeats).toBe(0);
  });

  it('ne touche jamais un plan modifié à la main', () => {
    const shots = script.map((t, i) => mk(i, t));
    shots[3] = { ...shots[3], motion: 'pan-left', transition: 'iris', transitionDur: 0.5 }; // user changed it
    const { shots: out } = directSequences(shots, 9 / 16);
    expect(out[3].motion).toBe('pan-left');
  });

  it('respecte les réglages : décisions automatiques désactivées', () => {
    const shots = Array.from({ length: 6 }, (_, i) => mk(i, 'Il marche.'));
    const { shots: out } = directSequences(shots, 9 / 16, { transitions: false, camera: false, sequences: false });
    expect(out.map((s) => s.motion)).toEqual(shots.map((s) => s.motion));
  });

  it('est déterministe', () => {
    const a = directSequences(script.map((t, i) => mk(i, t)), 9 / 16), b = directSequences(script.map((t, i) => mk(i, t)), 9 / 16);
    expect(a.shots).toEqual(b.shots);
  });
});

describe('durée d’affichage intelligente', async () => {
  const { holdFor, important } = await import('../src/engine/hold');
  const B = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i * 10, y: 0, w: 5, h: 5 }));
  it('une case bavarde reste plus longtemps qu’une image simple, une révélation plus encore', () => {
    const simple = holdFor(mk(0, ''));
    const talky = holdFor(mk(1, '', { balloons: B(4), text: 'I AM TRAPPED INSIDE THE INTRINSIC FIELD CHAMBER. NOBODY CAN HEAR ME. IT IS AUGUST 20, 1959.' }));
    const reveal = holdFor(mk(2, '', { zone: 'splash' }));
    expect(talky.min).toBeGreaterThan(simple.min);
    expect(reveal.kind).toBe('reveal');
    expect(important(reveal)).toBe(true);
    expect(important(simple)).toBe(false);
    expect(talky.why).toMatch(/bulles/);
  });
  it('les plages réglables changent le résultat', () => {
    expect(holdFor(mk(0, ''), { ranges: { simple: [5, 7] } }).min).toBeGreaterThanOrEqual(5);
  });
});

describe('raccords de mouvement', async () => {
  const { motionClash } = await import('../src/engine/director');
  it('refuse un whip entre deux panoramiques opposés et un effet fort entre deux plans calmes', () => {
    expect(motionClash(mk(0, '', { motion: 'pan-right' }), mk(1, '', { motion: 'pan-left' }), 'whip')).toMatch(/contraire/);
    expect(motionClash(mk(0, '', { motion: 'zoom-in', intensity: 0.2 }), mk(1, '', { motion: 'zoom-in', intensity: 0.3 }), 'impact')).toMatch(/calmes/);
    expect(motionClash(mk(0, '', { motion: 'zoom-in', intensity: 0.2 }), mk(1, '', { motion: 'zoom-in', intensity: 0.3 }), 'impact', 'confrontation')).toBeNull();
    expect(motionClash(mk(0, '', { motion: 'pan-right' }), mk(1, '', { motion: 'pan-right' }), 'whip')).toBeNull();
  });
});

describe('caméra « Explorer »', async () => {
  const { cameraAt } = await import('../src/engine/render');
  it('plan général, détail, retour au plan général', () => {
    const s = mk(0, '', { motion: 'tour', rect: { x: 0, y: 0, w: 1000, h: 1500 }, balloons: [{ x: 50, y: 50, w: 200, h: 120 }, { x: 700, y: 1200, w: 200, h: 120 }] });
    const a = cameraAt(s, 0, 9 / 16, false), mid = cameraAt(s, 0.42, 9 / 16, false), end = cameraAt(s, 1, 9 / 16, false);
    expect(mid.vw).toBeLessThan(a.vw);
    expect(end.vw).toBeCloseTo(a.vw, 3);
    expect(cameraAt(s, 0.72, 9 / 16, false).cy).toBeGreaterThan(mid.cy);
  });
});

describe('bibliothèque de directions artistiques', async () => {
  const { STYLES, resolveArt, applyArt, COMPONENTS } = await import('../src/engine/styles');
  it('8 directions complètes, chacune avec ses 9 composantes', () => {
    expect(STYLES.length).toBe(8);
    for (const s of STYLES) for (const k of COMPONENTS) expect(s[k]).toBeTruthy();
    // a direction is not a colour: titles, transitions and composition differ
    expect(new Set(STYLES.map((s) => s.titles)).size).toBeGreaterThanOrEqual(7);
    expect(new Set(STYLES.map((s) => s.transitions.accent.join())).size).toBeGreaterThanOrEqual(6);
  });
  it('mélange : la typographie d’une direction, les transitions d’une autre', () => {
    const a = resolveArt({ base: 'comic', from: { transitions: 'news', titles: 'cosmic' } });
    expect(a.typography.caption).toBe('comic');
    expect(a.transitions.accent).toEqual(resolveArt({ base: 'news' }).transitions.accent);
    expect(a.titles).toBe('cosmic');
    expect(a.label).toMatch(/\+/);
  });
  it('appliquer une direction règle le projet entier', () => {
    const p = applyArt({ accent: '#000', look: {}, defaultCaption: { preset: 'tiktok' }, subtitleStyle: { preset: 'tiktok' } } as never, { base: 'historical' });
    expect(p.titleStyle).toBe('archive');
    expect(p.background).toBe('paper');
    expect(p.look.grade).toBe('warm');
  });
});

describe('favoris créatifs', async () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const F = await import('../src/engine/favorites');
  it('enregistre, réapplique, exporte et réimporte, sans toucher au Brain', async () => {
    const s = mk(0, '', { transition: 'inkframe', transitionDur: 0.7 });
    F.saveFavorite('transition', 'Ma case encrée', F.capture.transition(s));
    expect(F.favorites('transition').length).toBe(1);
    const applied = F.applyToShot(mk(1, ''), F.favorites('transition')[0]);
    expect(applied.transition).toBe('inkframe');
    expect(applied.auto).toBeUndefined(); // the director leaves the user's choice alone
    const blob = F.exportFavorites();
    F.removeFavorite(F.favorites()[0].id);
    expect(F.favorites().length).toBe(0);
    expect(await F.importFavorites(blob)).toBe(1);
    expect(store.has('forge-brain')).toBe(false);
  });
});
