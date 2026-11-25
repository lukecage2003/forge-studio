/**
 * Person cut-out with Google MediaPipe (selfie segmenter), running locally in
 * the browser. Lets Forge put words or comic panels *behind* the speaker and
 * replace or blur the room. Loaded on first use (~0.3 MB model + wasm).
 */
const VERSION = '0.10.14';
const LIB = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

type Segmenter = { segment: (img: CanvasImageSource) => { confidenceMasks?: { width: number; height: number; getAsFloat32Array: () => Float32Array }[]; close: () => void } };

let seg: Segmenter | null = null;
let loading: Promise<boolean> | null = null;
let failed = false;
const IN = 256;
const input = document.createElement('canvas');
const mask = document.createElement('canvas');
let last: { key: unknown; ok: boolean } = { key: null, ok: false };

export const segmenterReady = () => !!seg;
export const segmenterFailed = () => failed;

export function loadSegmenter(): Promise<boolean> {
  if (seg) return Promise.resolve(true);
  if (loading) return loading;
  loading = (async () => {
    try {
      const v = await import(/* @vite-ignore */ LIB);
      const files = await v.FilesetResolver.forVisionTasks(WASM);
      const opts = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true,
      });
      try { seg = await v.ImageSegmenter.createFromOptions(files, opts('GPU')); }
      catch { seg = await v.ImageSegmenter.createFromOptions(files, opts('CPU')); }
      return true;
    } catch {
      failed = true;
      return false;
    }
  })();
  return loading;
}

/**
 * Alpha mask of the person in `img` (same framing as img, lower resolution).
 * Synchronous once the model is loaded; returns null otherwise.
 */
export function personMask(img: CanvasImageSource, key?: unknown): HTMLCanvasElement | null {
  if (!seg) return null;
  if (key !== undefined && key === last.key) return last.ok ? mask : null;
  const iw = (img as HTMLVideoElement).videoWidth || (img as HTMLCanvasElement).width;
  const ih = (img as HTMLVideoElement).videoHeight || (img as HTMLCanvasElement).height;
  if (!iw || !ih) return null;
  const k = IN / Math.max(iw, ih);
  input.width = Math.round(iw * k);
  input.height = Math.round(ih * k);
  input.getContext('2d')!.drawImage(img, 0, 0, input.width, input.height);
  let ok = false;
  try {
    const r = seg.segment(input);
    const m = r.confidenceMasks?.[0];
    if (m) {
      const data = m.getAsFloat32Array();
      mask.width = m.width;
      mask.height = m.height;
      const mc = mask.getContext('2d')!;
      const im = mc.createImageData(m.width, m.height);
      for (let i = 0; i < data.length; i++) {
        // soften the edge a little: 0.35..0.75 confidence → 0..255
        const a = Math.min(1, Math.max(0, (data[i] - 0.35) / 0.4));
        im.data[i * 4 + 3] = a * 255;
      }
      mc.putImageData(im, 0, 0);
      ok = true;
    }
    r.close();
  } catch {
    ok = false;
  }
  last = { key, ok };
  return ok ? mask : null;
}
