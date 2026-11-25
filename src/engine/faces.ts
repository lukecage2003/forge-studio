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
  const n = Math.min(90, Math.max(6, Math.ceil(duration / 1)));
  const raw: FaceKey[] = [];
  for (let i = 0; i < n; i++) {
    const t = Math.min(duration - 0.05, ((i + 0.5) / n) * duration);
    await seek(v, t);
    x.drawImage(v, 0, 0, c.width, c.height);
    const r = d.detect(c);
    const best = r.detections
      .filter((f) => f.boundingBox)
      .sort((a, b) => b.boundingBox!.width * b.boundingBox!.height - a.boundingBox!.width * a.boundingBox!.height)[0];
    if (best) {
      const b = best.boundingBox!;
      // eyes sit ~40 % down the face box: that's the point we frame on
      raw.push({ t, x: (b.originX + b.width / 2) / c.width, y: (b.originY + b.height * 0.42) / c.height, s: b.width / c.width });
    }
    onProgress((i + 1) / n);
  }
  v.removeAttribute('src');
  v.load();
  return smooth(raw);
}

/** median of 5 then light moving average: no jitter, still follows moves */
function smooth(k: FaceKey[]): FaceKey[] {
  if (k.length < 3) return k;
  const med = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];
  const m = k.map((p, i) => {
    const w = k.slice(Math.max(0, i - 2), i + 3);
    return { t: p.t, x: med(w.map((q) => q.x)), y: med(w.map((q) => q.y)), s: med(w.map((q) => q.s)) };
  });
  return m.map((p, i) => {
    const w = m.slice(Math.max(0, i - 1), i + 2);
    return { t: p.t, x: w.reduce((a, q) => a + q.x, 0) / w.length, y: w.reduce((a, q) => a + q.y, 0) / w.length, s: w.reduce((a, q) => a + q.s, 0) / w.length };
  });
}

/** face position at a source time (interpolated) */
export function faceAt(track: FaceKey[] | undefined, t: number): FaceKey | null {
  if (!track?.length) return null;
  if (t <= track[0].t) return track[0];
  for (let i = 1; i < track.length; i++) {
    if (t <= track[i].t) {
      const a = track[i - 1], b = track[i], u = (t - a.t) / Math.max(1e-6, b.t - a.t);
      // smoothstep: the camera eases between samples
      const e = u * u * (3 - 2 * u);
      return { t, x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, s: a.s + (b.s - a.s) * e };
    }
  }
  return track[track.length - 1];
}
