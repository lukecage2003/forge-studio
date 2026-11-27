import { describe, expect, it } from 'vitest';
import { newProject } from '../src/store';
import { placeBox, activeOverlays, overlayAlpha, overlaySourceTime } from '../src/engine/overlays';
import { freeTrack } from '../src/actions';
import { mediaRefs } from '../src/lib/projectFile';
import { upgrade } from '../src/lib/schema';
import type { Overlay, Project } from '../src/types';

const ov = (o: Partial<Overlay>): Overlay => ({ id: 'o', track: 1, start: 0, duration: 2, source: { kind: 'image', mediaId: 'img' }, place: 'full', zoom: 0, fade: 0, ...o });

describe('pistes de superposition', () => {
  it('placement dans l’image : plein écran, moitiés, incrustation dans le cadre', () => {
    expect(placeBox('full', 1080, 1920)).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
    expect(placeBox('bottom', 1080, 1920)).toEqual({ x: 0, y: 960, w: 1080, h: 960 });
    const pip = placeBox('pip', 1080, 1920);
    expect(pip.x + pip.w).toBeLessThan(1080);
    expect(pip.y + pip.h).toBeLessThan(1920);
  });
  it('visibles au bon moment, piste basse dessinée d’abord (la haute passe devant)', () => {
    const p: Project = { ...newProject(), overlays: [ov({ id: 'haut', track: 3, start: 1 }), ov({ id: 'bas', track: 1, start: 0.5 }), ov({ id: 'fini', start: 5 })] };
    expect(activeOverlays(p, 1.2).map((o) => o.id)).toEqual(['bas', 'haut']);
    expect(activeOverlays(p, 0.2)).toEqual([]);
  });
  it('fondu à l’entrée et à la sortie, temps source d’une vidéo', () => {
    const o = ov({ start: 10, duration: 2, fade: 0.5 });
    expect(overlayAlpha(o, 10)).toBe(0);
    expect(overlayAlpha(o, 10.25)).toBeCloseTo(0.5);
    expect(overlayAlpha(o, 11)).toBe(1);
    expect(overlayAlpha(o, 12)).toBe(0);
    const v = ov({ start: 10, source: { kind: 'video', mediaId: 'v', offset: 3, sourceDuration: 20, width: 1920, height: 1080 } });
    expect(overlaySourceTime(v, 11.5)).toBe(4.5);
  });
  it('une nouvelle superposition prend la première piste libre', () => {
    const p: Project = { ...newProject(), overlays: [ov({ track: 1, start: 0, duration: 4 }), ov({ id: 'b', track: 2, start: 2, duration: 4 })] };
    expect(freeTrack(p, 0.5, 1)).toBe(2);
    expect(freeTrack(p, 1, 2)).toBe(3);
    expect(freeTrack(p, 3, 1)).toBe(3);
    expect(freeTrack(p, 7, 1)).toBe(1);
  });
  it('leurs médias comptent comme utilisés (sauvegarde, .forge, nettoyage)', () => {
    const p: Project = { ...newProject(), overlays: [ov({}), ov({ id: 'v', source: { kind: 'video', mediaId: 'vid', offset: 0, sourceDuration: 5, width: 2, height: 2 } }), ov({ id: 'c', source: { kind: 'panel', pageId: 'pg', rect: { x: 0, y: 0, w: 50, h: 50 } } })] };
    expect(mediaRefs(p)).toEqual([{ id: 'img', kind: 'image' }, { id: 'vid', kind: 'video' }]);
  });
  it('un projet d’avant les superpositions reçoit des pistes vides', () => {
    const old = { ...newProject(), schemaVersion: 2 } as Project;
    delete old.overlays;
    expect(upgrade(old).project.overlays).toEqual([]);
  });
});

describe('calques : la case entière quand le cadrage la couperait trop', () => {
  it('perte de cadrage : nulle si même forme, forte pour une case haute dans une moitié large', async () => {
    const { fitLoss } = await import('../src/engine/overlays');
    expect(fitLoss(100, 200, 50, 100)).toBeCloseTo(0);
    expect(fitLoss(400, 1200, 1080, 960)).toBeGreaterThan(0.25); // tall text panel in the bottom half: shown whole
    expect(fitLoss(1000, 900, 1080, 960)).toBeLessThan(0.25); // nearly the same shape: fills the box
  });
});
