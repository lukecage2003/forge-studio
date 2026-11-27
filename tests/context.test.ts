import { describe, expect, it } from 'vitest';
import { newProject, newShot } from '../src/store';
import { contextFor, requestWindow, editContext } from '../src/ai/tasks';
import type { Project } from '../src/types';

// a 60-second edit: 20 shots of 3 s, one subtitle line every 2 s, a long script
function project(): Project {
  const p = newProject();
  const shots = Array.from({ length: 20 }, (_, i) => newShot(p, { id: `s${i}`, duration: 3, transition: 'cut', caption: { text: `Plan ${i}`, ...p.defaultCaption } }));
  const subtitles = Array.from({ length: 30 }, (_, i) => ({ s: i * 2, e: i * 2 + 2, text: `Ligne ${i} du commentaire`, words: [] }));
  const script = Array.from({ length: 40 }, (_, i) => `Phrase numéro ${i} sur Galactus et le Surfeur d’argent.`).join(' ');
  return { ...p, shots, subtitles, script };
}

describe('moteur de contexte de l’assistant', () => {
  it('lit la fenêtre de temps demandée', () => {
    expect(requestWindow('raccourcis les plans entre 10 et 20 s', 60)).toEqual([10, 20]);
    expect(requestWindow('de 40 à 30 secondes, plus de rythme', 60)).toEqual([30, 40]);
    expect(requestWindow('une transition à 25 s', 60)).toEqual([17, 33]);
    expect(requestWindow('améliore l’accroche', 60)).toEqual([0, 15]);
    expect(requestWindow('soigne la fin', 60)).toEqual([45, 60]);
    expect(requestWindow('rends tout plus dynamique', 60)).toBeNull();
  });
  it('n’envoie que les plans du passage demandé, et dit ce qui est envoyé', () => {
    const p = project();
    const c = contextFor('raccourcis les plans entre 10 et 20 s', p);
    const ids = [...c.text.matchAll(/^(s\d+) \|/gm)].map((m) => m[1]);
    expect(ids).toEqual(['s3', 's4', 's5', 's6']);
    expect(c.text).not.toMatch(/Sous-titres/);
    expect(c.kept[0]).toBe('plans (4)');
    expect(c.chars).toBeLessThan(c.fullChars / 4);
  });
  it('une demande sur les sous-titres n’envoie pas les plans', () => {
    const c = contextFor('les sous-titres sont trop longs au début', project());
    expect(c.text).toMatch(/Sous-titres/);
    expect(c.text).not.toMatch(/^s\d+ \|/m);
    expect(c.text).toMatch(/Ligne 0 /);
    expect(c.text).not.toMatch(/Ligne 20 /);
  });
  it('une demande sans repère garde tout le projet, comme avant', () => {
    const p = project();
    const c = contextFor('qu’en penses-tu ?', p);
    expect(c.kept).toEqual(['plans (20)', 'sous-titres (30)', 'rush', 'script']);
    expect(c.chars).toBeGreaterThan(editContext(p).length * 0.9);
  });
});
