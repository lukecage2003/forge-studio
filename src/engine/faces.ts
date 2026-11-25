/**
 * Automatic face tracking on the face-cam rush (Google MediaPipe face
 * detector, local). The video is sampled every ~1 s; the largest face gives
 * a smoothed track used to frame, punch in and crop vertically.
 */
import type { FaceKey } from '../types';

const VERSION = '0.10.14';
const LIB = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

type Detector = { detect: (img: CanvasImageSource) => { detections: { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories?: { score: number }[] }[] } };
let det: Detector | null = null;

async function load() {
  if (det) return det;
  const v = await import(/* @vite-ignore */ LIB);
  const files = await v.FilesetResolver.forVisionTasks(WASM);
  const opts = (delegate: 'GPU' | 'CPU') => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'IMAGE', minDetectionConfidence: 0.45 });
  try { det = await v.FaceDetector.createFromOptions(files, opts('GPU')); }
  catch { det = await v.FaceDetector.createFromOptions(files, opts('CPU')); }
  return det!;
}

function seek(v: HTMLVideoElement, t: number) {
  return new Promise<void>((res) => {
    const done = () => { v.removeEventListener('seeked', done); res(); };
    v.addEventListener('seeked', done);
    v.currentTime = t;
    setTimeout(done, 1500);
  });
}

export async function trackFaces(url: string, duration: number, onProgress: (p: number) => void): Promise<FaceKey[]> {
  const d = await load();
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  await new Promise<void>((res, rej) => { v.onloadeddata = () => res(); v.onerror = () => rej(new Error('Vidéo illisible pour la détection du visage.')); });
  const c = document.createElement('canvas');
  const k = 384 / Math.max(v.videoWidth, v.videoHeight);
  c.width = Math.round(v.videoWidth * k);
  c.height = Math.round(v.videoHeight * k);
  const x = c.getContext('2d', { willReadFrequently: true })!;
  // 2 samples per second (at most 240), each also checked for a change of shot
  const n = Math.min(240, Math.max(6, Math.ceil(duration * 2)));
  const raw: (FaceKey | null)[] = [];
  const times: number[] = [];
  const cuts: boolean[] = [];
  const diffs: number[] = [];
  let prevThumb: Float32Array | null = null;
  for (let i = 0; i < n; i++) {
    const t = Math.min(duration - 0.05, ((i + 0.5) / n) * duration);
    await seek(v, t);
    x.drawImage(v, 0, 0, c.width, c.height);
    const thumb = lumaThumb(x, c.width, c.height);
    const diff = prevThumb ? thumbDiff(prevThumb, thumb) : 0;
    cuts.push(diff > 0.07);
    diffs.push(+diff.toFixed(3));
    prevThumb = thumb;
    times.push(t);
    const prev = raw.length ? raw[raw.length - 1] : null;
    const f = findFace(d, c, v, prev);
    raw.push(f ? { t, ...f } : null);
    onProgress((i + 1) / n);
  }
  v.removeAttribute('src');
  v.load();
  lastTrackDebug = { raw, times, diffs };
  return cameraPath(raw, times, cuts, v.videoWidth / Math.max(1, v.videoHeight));
}

/** last analysis, for diagnosis (tests) */
export let lastTrackDebug: { raw: (FaceKey | null)[]; times: number[]; diffs: number[] } | null = null;

type Box = { x: number; y: number; w: number; h: number };
let tileCanvas: HTMLCanvasElement | null = null;

/** largest face of a detection result, in the coordinates of `area` (normalised to the frame) */
function bestIn(d: Detector, img: HTMLCanvasElement, area: Box): { x: number; y: number; s: number; score: number } | null {
  const r = d.detect(img);
  const f = r.detections.filter((x) => x.boundingBox).sort((a, b) => b.boundingBox!.width * b.boundingBox!.height - a.boundingBox!.width * a.boundingBox!.height)[0];
  if (!f) return null;
  const b = f.boundingBox!;
  // eyes sit ~40 % down the face box: that's the point we frame on
  return { x: area.x + ((b.originX + b.width / 2) / img.width) * area.w, y: area.y + ((b.originY + b.height * 0.42) / img.height) * area.h, s: (b.width / img.width) * area.w, score: f.categories?.[0]?.score ?? 0.5 };
}

/**
 * The detector is made for close faces. Whole frame first; if nothing, search
 * enlarged square tiles (first around the last position), so a speaker filmed
 * from further away is still found.
 */
function findFace(d: Detector, frame: HTMLCanvasElement, v: HTMLVideoElement, prev: FaceKey | null): { x: number; y: number; s: number } | null {
  const whole = bestIn(d, frame, { x: 0, y: 0, w: 1, h: 1 });
  if (whole) return whole;
  const W = v.videoWidth, H = v.videoHeight, side = Math.min(W, H) / 2;
  if (!tileCanvas) { tileCanvas = document.createElement('canvas'); tileCanvas.width = tileCanvas.height = 256; }
  const tile = tileCanvas;
  const tx = tile.getContext('2d', { willReadFrequently: true })!;
  const tiles: Box[] = [];
  if (prev) tiles.push({ x: prev.x * W - side / 2, y: prev.y * H - side / 2, w: side, h: side });
  const step = side * 0.66;
  for (let y = 0; y <= H - side + 1; y += step) for (let x = 0; x <= W - side + 1; x += step) tiles.push({ x, y, w: side, h: side });
  let best: { x: number; y: number; s: number; score: number } | null = null;
  for (const t of tiles) {
    const bx = Math.max(0, Math.min(W - side, t.x)), by = Math.max(0, Math.min(H - side, t.y));
    tx.drawImage(v, bx, by, side, side, 0, 0, 256, 256);
    const f = bestIn(d, tile, { x: bx / W, y: by / H, w: side / W, h: side / H });
    if (f && (!best || f.score * f.s > best.score * best.s)) best = f;
    if (best && t === tiles[0] && prev) break; // found again where it was: done
  }
  return best;
}

/** 32×18 colour thumbnail, to notice a change of shot (colour too: two sets can have the same brightness) */
function lumaThumb(x: CanvasRenderingContext2D, w: number, h: number): Float32Array {
  const d = x.getImageData(0, 0, w, h).data, out = new Float32Array(32 * 18 * 3);
  for (let j = 0; j < 18; j++) for (let i = 0; i < 32; i++) {
    const px = Math.floor(((i + 0.5) / 32) * w), py = Math.floor(((j + 0.5) / 18) * h), k = (py * w + px) * 4, o = (j * 32 + i) * 3;
    out[o] = d[k] / 255; out[o + 1] = d[k + 1] / 255; out[o + 2] = d[k + 2] / 255;
  }
  return out;
}
const thumbDiff = (a: Float32Array, b: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

/**
 * A camera operator for vertical reframing (after vertical_video_convertor, MIT):
 *  - holds still while the face stays inside a tolerance band (no chasing small sways)
 *  - moves at most `speed` of the frame width per second (never a whip pan)
 *  - jumps at once on a change of shot instead of sliding across it
 *  - keeps its aim through short detection losses (head turned, hand in front)
 * Input: face per sample (null = not found), sample times, shot changes, video aspect.
 */
export function cameraPath(raw: (FaceKey | null)[], times: number[], cuts: boolean[], aspect = 16 / 9): FaceKey[] {
  if (!raw.some(Boolean)) return [];
  const crop = Math.min(1, (9 / 16) / aspect); // width of a 9:16 crop, as a share of the frame
  const band = crop * 0.18, speed = crop * 0.9;
  const out: FaceKey[] = [];
  // median of 3 on the detections to drop single-frame glitches
  const med = (i: number, k: 'x' | 'y' | 's') => {
    const w = [raw[i - 1], raw[i], raw[i + 1]].filter((f): f is FaceKey => !!f).map((f) => f[k]).sort((a, b) => a - b);
    return w[w.length >> 1];
  };
  let aim: FaceKey | null = null;
  let lastSeen = -1;
  for (let i = 0; i < raw.length; i++) {
    const t = times[i], f = raw[i];
    const cut = cuts[i];
    if (f) lastSeen = i;
    const target = f ? { x: med(i, 'x'), y: med(i, 'y'), s: med(i, 's') } : null;
    if (!aim) {
      const first = target ?? raw.find(Boolean)!;
      aim = { t, x: first.x, y: first.y, s: first.s };
    } else if (target && cut) {
      aim = { t, ...target, cut: true };
    } else if (target) {
      const dt = Math.max(1e-3, t - out[out.length - 1].t);
      const cur: FaceKey = aim;
      const dx: number = target.x - cur.x, dy: number = target.y - cur.y;
      const far: boolean = Math.abs(dx) > band || Math.abs(dy) > band * 1.4;
      // recentre only when the face leaves the band, then glide towards it at a capped speed
      const mx: number = far ? Math.sign(dx) * Math.min(Math.abs(dx), speed * dt) : 0;
      const my: number = far ? Math.sign(dy) * Math.min(Math.abs(dy), speed * dt * 0.6) : 0;
      aim = { t, x: cur.x + mx, y: cur.y + my, s: cur.s + (target.s - cur.s) * 0.3 };
    } else {
      // face lost: hold for up to 2 s, then keep the last aim anyway (never jump to the centre)
      const held: FaceKey = aim;
      aim = { t, x: held.x, y: held.y, s: held.s, cut: cut && i - lastSeen > 4 ? true : undefined };
    }
    out.push(aim);
  }
  return out;
}

/** face position at a source time (interpolated) */
export function faceAt(track: FaceKey[] | undefined, t: number): FaceKey | null {
  if (!track?.length) return null;
  if (t <= track[0].t) return track[0];
  for (let i = 1; i < track.length; i++) {
    if (t <= track[i].t) {
      const a = track[i - 1], b = track[i], u = (t - a.t) / Math.max(1e-6, b.t - a.t);
      // a change of shot: the camera jumps with the cut instead of sliding across it
      if (b.cut) return u < 1 - 1e-6 ? a : b;
      // smoothstep: the camera eases between samples
      const e = u * u * (3 - 2 * u);
      return { t, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, s: a.s + (b.s - a.s) * e };
    }
  }
  return track[track.length - 1];
}
