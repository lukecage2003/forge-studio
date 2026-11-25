/**
 * Visual regression scene: synthetic comic pages (no copyrighted art) and a
 * project that exercises every transition, camera move and look option.
 * Loaded in the browser by run.cjs through the Vite dev server.
 */
import { importImage } from '../../src/engine/media';
import { createRenderer, loadFonts } from '../../src/engine/render';
import { newProject, newShot } from '../../src/store';
import { layoutShots } from '../../src/engine/timeline';
import type { Project, Shot, Transition, Motion } from '../../src/types';

function page(seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 800; c.height = 1200;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, 800, 1200);
  const hues = [12, 48, 200, 280, 140, 330];
  const boxes = [[30, 30, 740, 360], [30, 420, 360, 360], [410, 420, 360, 360], [30, 810, 740, 360]];
  boxes.forEach(([bx, by, bw, bh], i) => {
    const h = hues[(i + seed) % hues.length];
    const g = x.createLinearGradient(bx, by, bx + bw, by + bh);
    g.addColorStop(0, `hsl(${h} 70% 55%)`); g.addColorStop(1, `hsl(${(h + 40) % 360} 60% 25%)`);
    x.fillStyle = g; x.fillRect(bx, by, bw, bh);
    x.fillStyle = 'rgba(255,255,255,.85)';
    for (let k = 0; k < 6; k++) { x.beginPath(); x.arc(bx + ((k * 97 + seed * 31) % bw), by + ((k * 61 + seed * 17) % bh), 14 + k * 6, 0, Math.PI * 2); x.fill(); }
    x.strokeStyle = '#111'; x.lineWidth = 8; x.strokeRect(bx, by, bw, bh);
    x.fillStyle = '#111'; x.font = 'bold 54px sans-serif'; x.fillText(`P${seed}·${i + 1}`, bx + 24, by + 70);
  });
  return c;
}

const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));

export async function buildScene(extra: Partial<Project['look']> = {}, transitions?: Transition[]): Promise<Project> {
  await loadFonts();
  const p = newProject();
  p.format = '16:9';
  p.look = { ...p.look, parallax: false, balloonPop: false, handheld: 0.3, ...extra };
  for (let i = 0; i < 3; i++) {
    const { id } = await importImage(await toBlob(page(i)));
    p.pages.push({ id: 'pg' + i, name: 'page' + i, mediaId: id, width: 800, height: 1200 } as Project['pages'][number]);
  }
  const rects = [{ x: 30, y: 30, w: 740, h: 360 }, { x: 30, y: 420, w: 360, h: 360 }, { x: 410, y: 420, w: 360, h: 360 }, { x: 30, y: 810, w: 740, h: 360 }];
  const tr: Transition[] = transitions ?? ['cut', 'glide', 'fade', 'slide', 'zoom', 'whip', 'flash', 'slash', 'iris', 'glitch', 'dip', 'blur', 'burn'];
  const motions: Motion[] = ['auto', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'static'];
  const shots: Shot[] = [];
  tr.forEach((t, i) => {
    const s = newShot(p, {
      id: 's' + i, pageId: 'pg' + (i % 3), rect: rects[i % 4], duration: 2, transition: t, transitionDur: 0.6,
      motion: motions[i % motions.length], shake: i % 5 === 3 ? 0.7 : 0,
      layout: i === 4 ? 'page' : 'full',
    });
    s.caption.text = i % 2 ? `Plan ${i} — ${t}` : '';
    shots.push(s);
  });
  p.shots = shots;
  return p;
}

/** frames sampled mid-transition and mid-shot, as PNG data URLs */
export async function renderScene(p: Project, W = 640, H = 360): Promise<Record<string, string>> {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const rd = createRenderer(W, H);
  const out: Record<string, string> = {};
  for (const ts of layoutShots(p)) {
    const s = ts.shot;
    for (const [tag, t] of [['trans', ts.start + Math.min(s.transitionDur, s.duration) * 0.45], ['mid', ts.start + s.duration * 0.7]] as const) {
      rd.draw(ctx, p, t);
      out[`${s.id}-${s.transition}-${tag}`] = c.toDataURL('image/png');
    }
  }
  return out;
}

/** the GPU transitions (gl-transitions), sampled at 30 % and 60 % */
export async function renderGl(): Promise<Record<string, string>> {
  const ids: Transition[] = ['cut', 'crosszoom', 'warp', 'defocus', 'halftone', 'inkbleed', 'warpspeed', 'gravitylens', 'glitchdisplace', 'wipe'];
  const p = await buildScene({}, ids);
  p.shots = p.shots.map((s) => ({ ...s, transitionDur: 0.8, motion: 'static', shake: 0 }));
  const W = 640, H = 360;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const rd = createRenderer(W, H);
  const out: Record<string, string> = {};
  for (const ts of layoutShots(p).slice(1)) {
    for (const f of [0.3, 0.6]) {
      rd.draw(ctx, p, ts.start + ts.shot.transitionDur * f);
      out[`gl-${ts.shot.transition}-${Math.round(f * 100)}`] = c.toDataURL('image/png');
    }
  }
  return out;
}

/** manim-style chart and 3D scenes; first in 2D (no three.js yet: the fallback), then in 3D */
export async function renderScenes(): Promise<Record<string, string>> {
  const S3 = await import('../../src/engine/scene3d');
  const p = await buildScene({}, ['cut']);
  const rects = [{ x: 30, y: 30, w: 740, h: 360 }, { x: 30, y: 420, w: 360, h: 360 }, { x: 410, y: 420, w: 360, h: 360 }, { x: 30, y: 810, w: 740, h: 360 }];
  const items = rects.map((r, i) => ({ id: 'it' + i, label: ['Batman', 'Flash', 'Superman', 'Galactus'][i], sub: ['10', '1 000', '100 000', '1000000000'][i], pageId: 'pg' + (i % 3), rect: r }));
  const kinds = ['scale', 'orbit', 'cosmos', 'tiers'] as const;
  const W = 640, H = 360;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const out: Record<string, string> = {};
  const shoot = (tag: string) => {
    for (const k of kinds) {
      const proj = { ...p, shots: [{ ...p.shots[0], id: 'd', pageId: null, duration: 8, transition: 'cut' as const, transitionDur: 0, diagram: { kind: k, title: 'Échelle', items, links: [] } }] };
      const rd = createRenderer(W, H);
      for (const f of [0.15, 0.5, 0.9]) { rd.draw(ctx, proj, 8 * f); out[`${tag}-${k}-${Math.round(f * 100)}`] = c.toDataURL('image/png'); }
    }
  };
  if (!S3.has3D()) shoot('fallback2d');
  await S3.ensure3D();
  shoot('scene');
  // portrait (TikTok / Shorts)
  c.width = 360; c.height = 640;
  const p0 = p;
  for (const k of ['orbit', 'cosmos', 'tiers'] as const) {
    const proj = { ...p0, format: '9:16' as const, shots: [{ ...p0.shots[0], id: 'v', pageId: null, duration: 8, transition: 'cut' as const, transitionDur: 0, diagram: { kind: k, title: 'Échelle', items, links: [] } }] };
    const rd = createRenderer(360, 640);
    for (const f of [0.2, 0.9]) { rd.draw(ctx, proj, 8 * f); out[`portrait-${k}-${Math.round(f * 100)}`] = c.toDataURL('image/png'); }
  }
  return out;
}
