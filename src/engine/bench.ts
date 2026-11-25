/**
 * Performance check of this computer, run from the settings: the real
 * renderer, the GPU transitions, a 3D scene and a real 2-second MP4 export,
 * on synthetic pages (nothing is saved in the project). Gives the numbers and
 * what they mean for editing: smooth preview or not, how long an export takes.
 */
import type { Project, Shot, Transition } from '../types';
import { newProject, newShot } from '../store';
import { registerTempImage } from './media';
import { createRenderer, loadFonts } from './render';
import { layoutShots } from './timeline';

export interface BenchResult {
  date: string;
  cores: number; memoryGb: number | null; webgpu: boolean; webgl: boolean;
  frame1080: number; frame4k: number; frameGl: number | null; frame3d: number | null;
  /** seconds of export per second of video (1 = real time) */
  exportFactor: number | null;
  h264: boolean; h264_4k: boolean; aac: boolean;
  previewFps: number;
  verdict: string[];
}

function page(seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 1800;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fff'; x.fillRect(0, 0, 1200, 1800);
  [[40, 40, 1120, 540], [40, 620, 540, 540], [620, 620, 540, 540], [40, 1220, 1120, 540]].forEach(([bx, by, bw, bh], i) => {
    const g = x.createLinearGradient(bx, by, bx + bw, by + bh);
    g.addColorStop(0, `hsl(${(seed * 70 + i * 50) % 360} 70% 55%)`); g.addColorStop(1, `hsl(${(seed * 70 + i * 50 + 60) % 360} 60% 22%)`);
    x.fillStyle = g; x.fillRect(bx, by, bw, bh);
    for (let k = 0; k < 40; k++) { x.fillStyle = `rgba(255,255,255,${0.2 + (k % 5) * 0.12})`; x.beginPath(); x.arc(bx + ((k * 137) % bw), by + ((k * 89) % bh), 6 + (k % 7) * 5, 0, 7); x.fill(); }
    x.strokeStyle = '#111'; x.lineWidth = 10; x.strokeRect(bx, by, bw, bh);
  });
  return c;
}
const blobOf = (c: HTMLCanvasElement) => new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));

async function benchProject(transitions: Transition[], format: Project['format'] = '16:9'): Promise<Project> {
  const p = newProject();
  p.format = format;
  p.look = { ...p.look, parallax: false, grain: 0.3, vignette: 0.3 };
  for (let i = 0; i < 3; i++) {
    const id = `bench_${i}`;
    await registerTempImage(id, await blobOf(page(i)));
    p.pages.push({ id: 'bp' + i, name: 'bench', mediaId: id, width: 1200, height: 1800 } as Project['pages'][number]);
  }
  const rects = [{ x: 40, y: 40, w: 1120, h: 540 }, { x: 40, y: 620, w: 540, h: 540 }, { x: 620, y: 620, w: 540, h: 540 }, { x: 40, y: 1220, w: 1120, h: 540 }];
  p.shots = transitions.map((t, i): Shot => {
    const s = newShot(p, { id: 'bs' + i, pageId: 'bp' + (i % 3), rect: rects[i % 4], duration: 1.5, transition: t, transitionDur: 0.6, shake: i % 4 === 3 ? 0.6 : 0 });
    s.caption.text = 'Forge mesure cet ordinateur';
    return s;
  });
  return p;
}

/** 84 → « 1 h 24 », 12 → « 12 min » */
export const fmtMin = (m: number) => { const r = Math.max(1, Math.round(m)); return r < 60 ? `${r} min` : `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')}`; };

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] ?? 0; };

async function frameTime(p: Project, W: number, H: number, n: number, pick?: (t: number) => boolean): Promise<number> {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { alpha: false })!;
  const rd = createRenderer(W, H);
  const timed = layoutShots(p);
  const end = timed[timed.length - 1].end;
  const times = Array.from({ length: n * 4 }, (_, i) => (i / (n * 4)) * end).filter((t) => !pick || pick(t)).slice(0, n);
  rd.draw(ctx, p, times[0]); // warm-up: textures, shaders
  const ms: number[] = [];
  for (const t of times) {
    const t0 = performance.now();
    rd.draw(ctx, p, t);
    ctx.getImageData(0, 0, 1, 1); // wait for the GPU
    ms.push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 0));
  }
  return median(ms);
}

async function encoderOk(codec: string, width: number, height: number) {
  try { return !!(await VideoEncoder.isConfigSupported({ codec, width, height, bitrate: 8e6, framerate: 30 })).supported; } catch { return false; }
}

export async function runBench(onStep: (label: string, p: number) => void): Promise<BenchResult> {
  await loadFonts();
  const nav = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
  const webgl = !!document.createElement('canvas').getContext('webgl');
  onStep('Rendu 1080p…', 0.05);
  const p2d = await benchProject(['cut', 'glide', 'whip', 'fade', 'slash', 'zoom', 'burn']);
  const frame1080 = await frameTime(p2d, 1920, 1080, 30);
  onStep('Rendu 4K…', 0.25);
  const frame4k = await frameTime(p2d, 3840, 2160, 10);
  onStep('Transitions GPU…', 0.4);
  let frameGl: number | null = null;
  if (webgl) {
    const pgl = await benchProject(['cut', 'crosszoom', 'inkbleed', 'warpspeed', 'halftone']);
    const inTr = (t: number) => (t % 1.5) < 0.6 && t > 1.5;
    frameGl = await frameTime(pgl, 1920, 1080, 16, inTr);
  }
  onStep('Scène 3D…', 0.55);
  let frame3d: number | null = null;
  try {
    const { ensure3D } = await import('./scene3d');
    if (webgl && (await ensure3D())) {
      const p3 = await benchProject(['cut']);
      p3.shots = [{ ...p3.shots[0], pageId: null, duration: 6, diagram: { kind: 'orbit', title: 'Mesure', links: [], items: p2d.shots.slice(0, 4).map((s, i) => ({ id: 'b' + i, label: 'Case ' + (i + 1), pageId: s.pageId!, rect: s.rect })) } }];
      frame3d = await frameTime(p3, 1920, 1080, 16);
    }
  } catch { frame3d = null; }
  onStep('Encodeurs…', 0.65);
  const h264 = typeof VideoEncoder !== 'undefined' && await encoderOk('avc1.640028', 1920, 1080);
  const h264_4k = typeof VideoEncoder !== 'undefined' && await encoderOk('avc1.640033', 3840, 2160);
  let aac = false;
  try { aac = typeof AudioEncoder !== 'undefined' && !!(await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported; } catch { aac = false; }
  onStep('Export MP4 de 3 s…', 0.7);
  let exportFactor: number | null = null;
  try {
    const { exportMp4 } = await import('./export');
    const pe = await benchProject(['cut', 'whip']);
    const t0 = performance.now();
    await exportMp4(pe, { quality: 'high', fps: 30, signal: new AbortController().signal, onProgress: (x) => onStep('Export MP4 de 3 s…', 0.7 + 0.28 * x) });
    exportFactor = (performance.now() - t0) / 1000 / 3;
  } catch { exportFactor = null; }
  const previewFps = Math.min(60, 1000 / Math.max(1, frame1080));
  const verdict: string[] = [];
  verdict.push(previewFps >= 24 ? `Aperçu fluide (${Math.round(previewFps)} images/s en 1080p).` : `Aperçu un peu saccadé (${Math.round(previewFps)} images/s en 1080p) : la vidéo exportée, elle, sera parfaite.`);
  if (exportFactor != null) {
    const tenMin = (exportFactor * 600) / 60;
    verdict.push(`Export 1080p : environ ${exportFactor < 1 ? 'plus rapide que la vidéo' : `${exportFactor.toFixed(1).replace('.', ',')} fois sa durée`}, soit ~${fmtMin(tenMin)} pour une vidéo de 10 min.`);
    verdict.push(`Export 4K : compte environ ${fmtMin(tenMin * Math.max(2.5, frame4k / Math.max(1, frame1080)))} pour 10 min${h264_4k ? '' : ' (encodeur 4K non disponible ici : reste en 1080p)'}.`);
  } else verdict.push('Export impossible dans ce navigateur : utilise Chrome ou Edge à jour.');
  if (frameGl == null) verdict.push('WebGL indisponible : les transitions GPU et la 3D sont remplacées par des fondus et des schémas 2D.');
  if (!aac) verdict.push('Son exporté en Opus (pas d’encodeur AAC ici) : YouTube et TikTok l’acceptent.');
  onStep('Terminé', 1);
  const r: BenchResult = {
    date: new Date().toISOString(), cores: navigator.hardwareConcurrency || 0, memoryGb: nav.deviceMemory ?? null, webgpu: !!nav.gpu, webgl,
    frame1080, frame4k, frameGl, frame3d, exportFactor, h264, h264_4k, aac, previewFps, verdict,
  };
  try { localStorage.setItem('forge.bench', JSON.stringify(r)); } catch { /* storage off */ }
  return r;
}

export function lastBench(): BenchResult | null {
  try { const v = localStorage.getItem('forge.bench'); return v ? (JSON.parse(v) as BenchResult) : null; } catch { return null; }
}
