import { describe, expect, it } from 'vitest';
import { newProject, newShot } from '../src/store';
import { parsePrecise } from '../src/engine/precise';
import type { Project } from '../src/types';

const p0 = newProject();
const p: Project = { ...p0, shots: [1, 2, 3, 4, 5].map((i) => newShot(p0, { id: `s${i}`, duration: 3 })), subtitles: [{ s: 0, e: 1, text: 'Rorchach observe', words: [] }, { s: 1, e: 2, text: 'Rorchach part', words: [] }] };

describe('chat précis (sans IA)', () => {
  it('durée, suppression, transition, mise en page, mouvement', () => {
    expect(parsePrecise('plan 3 : 4 s', p)).toEqual([{ type: 'shot.duration', shotId: 's3', seconds: 4, raison: 'demandé dans le chat' }]);
    expect(parsePrecise('supprime le plan 5', p)?.[0]).toMatchObject({ type: 'shot.delete', shotId: 's5' });
    expect(parsePrecise('transition fondu au plan 2', p)?.[0]).toMatchObject({ type: 'shot.transition', shotId: 's2', transition: 'fade' });
    expect(parsePrecise('plan 4 en écran partagé', p)?.[0]).toMatchObject({ type: 'shot.layout', layout: 'split' });
    expect(parsePrecise('zoom avant sur le plan 1', p)?.[0]).toMatchObject({ type: 'shot.motion', motion: 'zoom-in' });
    expect(parsePrecise('raccourcis les plans 2 à 4', p)?.map((x) => (x as { shotId: string }).shotId)).toEqual(['s2', 's3', 's4']);
    expect(parsePrecise('à 7 s mets 2 s', p)?.[0]).toMatchObject({ shotId: 's3', seconds: 2 });
  });
  it('sous-titres, musique, titre ; la sélection ; rien d’exact → l’assistant habituel', () => {
    expect(parsePrecise('remplace « Rorchach » par « Rorschach »', p)?.[0]).toMatchObject({ type: 'subtitle.replace', count: 2 });
    expect(parsePrecise('musique moins forte', p)?.[0]).toMatchObject({ type: 'music.volume', factor: 0.7 });
    expect(parsePrecise('sous-titres plus gros', p)?.[0]).toMatchObject({ type: 'subs.size' });
    expect(parsePrecise('ajoute le titre « LA FIN » à 12 s', p)?.[0]).toMatchObject({ type: 'title.add', at: 12, text: 'LA FIN' });
    expect(parsePrecise('allonge ce plan', p, 's2')?.[0]).toMatchObject({ shotId: 's2', seconds: 4.2 });
    expect(parsePrecise('rends la vidéo plus dynamique', p)).toBeNull();
  });
});
