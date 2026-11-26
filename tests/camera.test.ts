import { describe, expect, it } from 'vitest';
import { evalPath, jerk, keepInside, timePath } from '../src/engine/camerapath';
import { comicOrder } from '../src/engine/panelAI';
import { executeCamera, overlapsOthers, panelNavigation, pageGlide, reveal, type PageInfo } from '../src/engine/comicCamera';
import type { Shot } from '../src/types';

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
const page = (panels = [R(40, 40, 920, 600), R(40, 680, 440, 760), R(520, 680, 440, 760)]): PageInfo => ({ w: 1000, h: 1500, panels, balloons: [R(100, 80, 200, 120), R(600, 900, 200, 120)] });
const shot = (extra: Partial<Shot>): Shot => ({ id: 's', pageId: 'p', rect: R(0, 0, 1000, 1500), duration: 5, motion: 'zoom-in', intensity: 0.5, shake: 0, transition: 'cut', transitionDur: 0, layout: 'full', caption: { text: '' }, auto: { duration: 5, layout: 'full', motion: 'zoom-in', style: 'x' }, ...extra } as Shot);

describe('moteur de trajectoire', () => {
  it('passe par ses points clés et ne saute jamais', () => {
    const keys = timePath([{ cx: 100, cy: 100, vw: 300 }, { cx: 900, cy: 1300, vw: 500 }, { cx: 500, cy: 750, vw: 1000 }], 1800);
    expect(evalPath(keys, 0).cx).toBeCloseTo(100, 3);
    expect(evalPath(keys, 1).cx).toBeCloseTo(500, 3);
    // a smooth path: velocity changes stay small; a straight cut between keys would be huge
    expect(jerk(keys, 6, 1800)).toBeLessThan(2);
    const cut = [{ t: 0, cx: 100, cy: 100, vw: 300 }, { t: 0.001, cx: 900, cy: 1300, vw: 300 }];
    expect(jerk(cut, 6, 1800)).toBeGreaterThan(20);
  });
  it('plus le trajet est long, plus il prend de temps', () => {
    const k = timePath([{ cx: 0, cy: 0, vw: 300 }, { cx: 50, cy: 0, vw: 300 }, { cx: 1000, cy: 1400, vw: 300 }], 1800, { lead: 0, tail: 0 });
    expect(k[2].t - (k[1].t + (k[1].hold ?? 0))).toBeGreaterThan(k[1].t - (k[0].t + (k[0].hold ?? 0)));
  });
  it('ne montre jamais hors de la page', () => {
    const k = keepInside([{ t: 0, cx: -500, cy: 3000, vw: 200 }], R(0, 0, 1000, 1500), 9 / 16);
    expect(k[0].cx - k[0].vw / 2).toBeGreaterThanOrEqual(0);
  });
});

describe('modes de caméra BD', () => {
  const A = 9 / 16;
  it('case à case : suit l’ordre de lecture', () => {
    const k = panelNavigation(page(), A);
    // the wide top panel is read in two stops (left, right), then the two panels below
    expect(k.length).toBe(4);
    expect(k[0].cx).toBeLessThan(k[1].cx);
    expect(k[1].cy).toBeLessThan(k[2].cy);
    expect(k[2].cx).toBeLessThan(k[3].cx);
  });
  it('révélation : part serré, finit sur toute la page', () => {
    const k = reveal(page(), R(100, 80, 200, 120), A);
    expect(k[0].vw).toBeLessThan(k[k.length - 1].vw);
  });
  it('travelling : large au début et à la fin', () => {
    const k = pageGlide(page(), A);
    expect(k[0].vw).toBeCloseTo(k[k.length - 1].vw, 3);
    expect(Math.min(...k.map((x) => x.vw))).toBeLessThan(k[0].vw);
  });
  it('pleine page : plan tenu, révélation ou travelling selon l’intention', () => {
    expect(executeCamera(shot({}), page(), 'hold', A, null)?.motion).toBe('static');
    expect(executeCamera(shot({ zone: 'splash' }), page(), 'push', A, null)?.motion).toBe('reveal');
    expect(executeCamera(shot({ duration: 6 }), page(), 'push', A, null)?.motion).toBe('panel-nav');
  });
  it('cases qui se chevauchent : filmées dans la page, pas découpées', () => {
    const p = page([R(40, 40, 600, 700), R(400, 500, 560, 900)]);
    expect(overlapsOthers(p.panels[0], p.panels)).toBe(true);
    const c = executeCamera(shot({ rect: p.panels[0], duration: 4 }), p, 'push', A, null);
    expect(c?.shared).toBe(true);
  });
  it('une page verrouillée n’est jamais touchée', () => {
    expect(executeCamera(shot({}), { ...page(), locked: true }, 'push', A, null)).toBeNull();
  });
});

describe('ordre de lecture ambigu', () => {
  it('le signale au lieu d’inventer une certitude', () => {
    const info: { doubt?: string } = {};
    // a big panel overlapping two stacked ones on both axes: no clean row or column split
    comicOrder([R(0, 0, 700, 900), R(500, 300, 500, 500), R(100, 700, 600, 700)], false, info);
    expect(info.doubt).toBeTruthy();
    const clean: { doubt?: string } = {};
    comicOrder([R(0, 0, 490, 490), R(510, 0, 490, 490), R(0, 510, 1000, 490)], false, clean);
    expect(clean.doubt).toBeUndefined();
  });
});

describe('bandes horizontales en vidéo verticale', () => {
  it('la caméra parcourt chaque bande au lieu de rester sur la page entière', () => {
    const p: PageInfo = { w: 1000, h: 1500, panels: [R(20, 20, 960, 260), R(20, 300, 960, 260), R(20, 580, 960, 260)], balloons: [] };
    const k = panelNavigation(p, 9 / 16);
    expect(k.length).toBe(6);
    expect(new Set(k.map((x) => Math.round(x.cy))).size).toBeGreaterThan(1);
    expect(k[0].cx).toBeLessThan(k[1].cx);
  });
});
