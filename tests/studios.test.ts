import { describe, expect, it } from 'vitest';
import { newProject } from '../src/store';
import { STUDIOS, studioChecks, studioReady, nextStudio } from '../src/lib/studios';
import { commands } from '../src/lib/commands';
import type { Project } from '../src/types';

const base = (over: Partial<Project> = {}): Project => ({ ...newProject(), ...over });
const script = 'Galactus arrive sur Terre. '.repeat(10);

describe('studios', () => {
  it('huit studios, chacun avec un état lu dans le projet', () => {
    expect(STUDIOS.map((s) => s.id)).toEqual(['production', 'script', 'visual', 'editing', 'audio', 'motion', 'finishing', 'publishing']);
    for (const s of STUDIOS) expect(studioChecks(base(), s.id).length).toBeGreaterThan(0);
  });
  it('un projet vide commence par le script', () => {
    expect(nextStudio(base())).toBe('script');
    expect(studioChecks(base(), 'script').find((c) => c.label === 'Script')?.state).toBe('todo');
  });
  it('le script écrit et la voix importée rendent le studio Script prêt, puis le Visuel devient la prochaine étape', () => {
    const p = base({ script, audio: [{ id: 'a', kind: 'voice', name: 'voix.wav', mediaId: 'm', start: 0, offset: 0, duration: 30, sourceDuration: 30 } as never] });
    expect(studioReady(p, 'script')).toBe(true);
    expect(nextStudio(p)).toBe('visual');
  });
  it('un ordre de lecture douteux est signalé, jamais caché', () => {
    const p = base({ pages: [{ id: 'pg', name: 'p1', mediaId: 'x', width: 10, height: 10, cut: 'panels', orderDoubt: 'cases superposées' } as never] });
    const c = studioChecks(p, 'visual').find((x) => /Ordre de lecture/.test(x.label));
    expect(c?.state).toBe('warn');
    expect(studioReady(p, 'visual')).toBe(false);
  });
  it('chaque action proposée par un studio existe vraiment dans la liste des commandes', () => {
    const ids = new Set(commands().map((c) => c.id));
    const full = base({ script, aroll: { mediaId: 'r', name: 'r', duration: 10, width: 1, height: 1, focus: { x: 0.5, y: 0.5 }, cuts: [], words: [] } });
    for (const s of STUDIOS) for (const p of [base(), full]) for (const c of studioChecks(p, s.id)) if (c.cmd) expect(ids.has(c.cmd), `${s.id} → ${c.cmd}`).toBe(true);
    // and every studio has at least one command of its own
    for (const s of STUDIOS) expect(commands().some((c) => c.studios?.includes(s.id)), s.id).toBe(true);
  });
});

describe('studios : pas de faux « prêt »', () => {
  it('un projet vide n’a aucun studio prêt', () => {
    for (const s of STUDIOS) if (s.id !== 'production') expect(studioReady(base(), s.id), s.id).toBe(false);
  });
});
