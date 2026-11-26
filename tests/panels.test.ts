import { describe, expect, it } from 'vitest';
import { comicOrder, cutFromDetection } from '../src/engine/panelAI';

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('ordre de lecture des cases', () => {
  it('lit une grille 2×2 ligne par ligne', () => {
    const g = [R(510, 510, 490, 490), R(0, 0, 490, 490), R(0, 510, 490, 490), R(510, 0, 490, 490)];
    expect(comicOrder(g).map((r) => [r.x, r.y])).toEqual([[0, 0], [510, 0], [0, 510], [510, 510]]);
  });
  it('lit une grande case à gauche puis la pile de droite', () => {
    const g = [R(510, 0, 490, 490), R(0, 0, 490, 1000), R(510, 510, 490, 490)];
    expect(comicOrder(g).map((r) => [r.x, r.y])).toEqual([[0, 0], [510, 0], [510, 510]]);
  });
  it('manga : de droite à gauche', () => {
    const g = [R(0, 0, 490, 490), R(510, 0, 490, 490)];
    expect(comicOrder(g, true).map((r) => r.x)).toEqual([510, 0]);
  });
  it('tolère des boîtes qui se chevauchent un peu', () => {
    const g = [R(0, 0, 520, 480), R(500, 0, 500, 480), R(0, 470, 1000, 500)];
    expect(comicOrder(g).map((r) => [r.x, r.y])).toEqual([[0, 0], [500, 0], [0, 470]]);
  });
});

describe('découpe depuis le détecteur IA', () => {
  const det = (panels: ReturnType<typeof R>[], s = 0.9) => ({ panels: panels.map((p) => ({ ...p, s })), bubbles: [], ms: 1, device: 'test' });
  it('une seule grande case = pleine page', () => {
    expect(cutFromDetection(det([R(10, 10, 980, 1480)]), 1000, 1500)?.kind).toBe('splash');
  });
  it('enlève les boîtes imbriquées et les miettes', () => {
    const c = cutFromDetection(det([R(0, 0, 1000, 700), R(100, 100, 200, 200), R(0, 750, 1000, 750), R(5, 5, 20, 20)]), 1000, 1500)!;
    expect(c.kind).toBe('panels');
    expect(c.rects.length).toBe(2);
  });
  it('refuse une détection trop maigre', () => {
    expect(cutFromDetection(det([R(0, 0, 200, 200), R(300, 300, 200, 200)]), 1000, 1500)).toBeNull();
    expect(cutFromDetection(det([R(0, 0, 1000, 700)], 0.2), 1000, 1500)).toBeNull();
  });
});
