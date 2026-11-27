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

describe('calques : placement conseillé, mouvement, entrées', () => {
  it('incrustation lisible quelle que soit la forme : bandeau, carré, colonne ; jamais une miette', async () => {
    const { bestPlace, pipBox } = await import('../src/engine/overlays');
    const W = 1080, H = 1920;
    expect(bestPlace(1600, 700, W, H)).toBe('pip');
    const banner = pipBox(1600 / 700, W, H);          // very wide panel → across the frame
    expect(banner.w).toBeGreaterThan(W * 0.9);
    expect(banner.h).toBeGreaterThan(H * 0.2);
    const square = pipBox(1, W, H);                     // square → about 60 % of the width
    expect(square.w / W).toBeGreaterThan(0.55);
    const column = pipBox(500 / 1100, W, H);            // tall → a column on the side
    expect(column.h).toBeGreaterThan(H * 0.35);
    // usual shapes keep a readable fifth of the frame; extreme strips take the whole width or height they can
    for (const a of [0.45, 0.7, 1, 1.5, 2.3]) { const b = pipBox(a, W, H); expect(b.w * b.h).toBeGreaterThan(W * H * 0.15); }
    for (const a of [0.2, 0.3, 4, 7]) { const b = pipBox(a, W, H); expect(b.w > W * 0.9 || b.h > H * 0.43).toBe(true); expect(b.x + b.w).toBeLessThanOrEqual(W); expect(b.y + b.h).toBeLessThanOrEqual(H); }
    // a small panel is never stretched past 3× its own pixels (it would blur)
    expect(pipBox(1, W, H, 'tr', 1, 120).w).toBeLessThanOrEqual(360);
    // landscape video (16:9) too
    const land = pipBox(1, 1920, 1080); expect(land.h).toBeGreaterThan(1080 * 0.4);
  });
  it('un calque libre va de sa position de départ à sa position de fin', async () => {
    const { overlayBox } = await import('../src/engine/overlays');
    const o = ov({ place: 'free', start: 0, duration: 2, box: { x: 0, y: 0, w: 0.5, h: 0.5 }, boxEnd: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } });
    expect(overlayBox(o, 0, 1000, 1000)).toEqual({ x: 0, y: 0, w: 500, h: 500 });
    expect(overlayBox(o, 1, 1000, 1000).x).toBeCloseTo(250);
    expect(overlayBox(o, 2, 1000, 1000).x).toBeCloseTo(500);
  });
  it('glissé, pop, volet : opaques pendant l’entrée (seul le fondu joue sur l’opacité)', async () => {
    const { overlayAlpha, overlayIn } = await import('../src/engine/overlays');
    const o = ov({ start: 0, duration: 2, fade: 0.5, enter: 'pop' });
    expect(overlayIn(o, 0.25)).toBeCloseTo(0.5);
    expect(overlayAlpha(o, 0.25)).toBe(1);
    expect(overlayAlpha({ ...o, enter: 'fade' }, 0.25)).toBeCloseTo(0.5);
  });
});

describe('calques proposés d’après le script', () => {
  it('comparaison → deux cases côte à côte ; « pendant ce temps » → incrustation ; rien sur un calque déjà posé', async () => {
    const { suggestOverlays } = await import('../src/engine/overlaySuggest');
    const { newShot } = await import('../src/store');
    const base = newProject();
    const pages = [{ id: 'pa', mediaId: 'a', name: 'a', width: 1000, height: 1500 }, { id: 'pb', mediaId: 'b', name: 'b', width: 1000, height: 1500 }] as never;
    const shots = [0, 1, 2, 3].map((i) => newShot(base, { id: `s${i}`, pageId: i < 2 ? 'pa' : 'pb', rect: { x: 0, y: i * 300, w: 1000, h: 300 }, duration: 4 }));
    const script = 'Galactus arrive sur Terre. Le Surfeur est fort, alors que Galactus est immense. Pendant ce temps, les Quatre Fantastiques préparent une arme. Tout se joue maintenant.';
    const p: Project = { ...base, pages, shots, script };
    const r = suggestOverlays(p);
    expect(r.map((x) => x.place)).toEqual(['bottom', 'pip']);
    expect(r[0].pageId).toBe('pb'); // a panel of the other page
    expect(r[0].raison).toMatch(/comparaison/);
    expect(suggestOverlays({ ...p, overlays: [ov({ start: 0, duration: 60 })] })).toEqual([]);
  });
});

describe('écran partagé et coin de l’incrustation', () => {
  it('une moitié envoie la piste principale dans l’autre moitié ; « écran partagé » décoché la laisse dessous', async () => {
    const { splitAt, otherHalf } = await import('../src/engine/overlays');
    const p: Project = { ...newProject(), overlays: [ov({ id: 'b', place: 'bottom', start: 0, duration: 3 }), ov({ id: 'pip', place: 'pip', start: 0, duration: 3, track: 2 })] };
    expect(splitAt(p, 1)?.id).toBe('b');
    expect(otherHalf('bottom', 1080, 1920)).toEqual({ x: 0, y: 0, w: 1080, h: 960 });
    expect(otherHalf('left', 1080, 1920)).toEqual({ x: 540, y: 0, w: 540, h: 1920 });
    expect(splitAt({ ...p, overlays: [{ ...p.overlays![0], split: false }] }, 1)).toBeNull();
    expect(splitAt(p, 5)).toBeNull();
  });
  it('le coin choisi est celui qui cache le moins de dessin ; en bas, les sous-titres comptent', async () => {
    const { chooseCorner, placeBox } = await import('../src/engine/overlays');
    const W = 1080, H = 1920;
    // drawing everywhere except the bottom-left corner
    const busyBut = (quiet: string) => (b: { x: number; y: number; w: number; h: number }) => { const c = `${b.y + b.h / 2 > H * 0.35 ? 'b' : 't'}${b.x + b.w / 2 < W / 2 ? 'l' : 'r'}`; return c === quiet ? 1 : 10; };
    expect(['bl', 'ml']).toContain(chooseCorner(W, H, busyBut('bl'), false));
    expect(chooseCorner(W, H, busyBut('tl'), true)).toBe('tl');
    // equal everywhere: the top corners win when subtitles are on
    expect(['tl', 'tr']).toContain(chooseCorner(W, H, () => 5, true));
    const br = placeBox('pip', W, H, 'br');
    expect(br.y + br.h).toBeLessThanOrEqual(H * 0.64 + 1); // above the subtitles
  });
});
