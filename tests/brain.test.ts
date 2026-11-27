import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Shot } from '../src/types';

// localStorage stand-in (the brain keeps its memory there)
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };

const fresh = async () => { vi.resetModules(); return import('../src/engine/brain'); };
const shot = { id: 's', layout: 'full', motion: 'zoom-in', intensity: 0.6, duration: 3, auto: { duration: 3, layout: 'full', motion: 'zoom-in', style: 'dynamique' } } as unknown as Shot;

describe('mémoire par portée (Forge Brain)', () => {
  beforeEach(() => mem.clear());
  it('une correction est apprise à trois niveaux ; le projet prend la main après 5 corrections', async () => {
    const B = await fresh();
    B.setBrainScope('p1', '9:16');
    for (let i = 0; i < 4; i++) B.observeShotEdit(shot, { duration: 6 });
    expect(B.activeScope()).toBe('general'); // 4 < 5: the project level is not trusted yet
    B.observeShotEdit(shot, { duration: 6 });
    expect(B.activeScope()).toBe('project');
    expect(B.paceMult('dynamique')).toBeGreaterThan(1.3);
    // another project in the same format uses what the format learned
    B.setBrainScope('p2', '9:16');
    expect(B.activeScope()).toBe('format');
    // a 16:9 video starts from the general level, which also learned
    B.setBrainScope('p3', '16:9');
    expect(B.activeScope()).toBe('general');
    expect(B.brainAt('general').edits).toBe(5);
  });
  it('effacer un niveau ne touche pas les autres, et peut être annulé', async () => {
    const B = await fresh();
    B.setBrainScope('p1', '9:16');
    for (let i = 0; i < 6; i++) B.observeShotEdit(shot, { duration: 6 });
    B.resetBrain('project');
    expect(B.brainAt('project').edits).toBe(0);
    expect(B.brainAt('format').edits).toBe(6);
    expect(B.activeScope()).toBe('format');
    expect(B.canUndoReset()).toBe(true);
    expect(B.undoReset()).toBe(true);
    expect(B.brainAt('project').edits).toBe(6);
    expect(B.activeScope()).toBe('project');
  });
  it('la mémoire de l’ancienne version devient le niveau général', async () => {
    mem.set('forge.brain', JSON.stringify({ v: 1, edits: 12, montages: 3, pace: { dynamique: { mult: 0.7, n: 12 } } }));
    const B = await fresh();
    expect(B.brainAt('general').edits).toBe(12);
    expect(B.paceMult('dynamique')).toBe(0.7);
  });
});
