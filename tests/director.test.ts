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
