/**
 * 3D scenes built only from comic panels (no generated images), with three.js
 * loaded on demand. Every frame is a pure function of time (seeded stars,
 * eased camera), drawn into the 2D frame, so the preview and the export match.
 *  - orbit  : the panels on a ring in space; the camera circles, then visits each one
 *  - cosmos : panels floating at different depths in a starfield, slow dolly forward
 *  - tiers  : power scaling, pillars rising from weakest to strongest, the camera climbs
 * Without WebGL (or before three.js has loaded) the caller draws a 2D version.
 */
import type * as THREE_NS from 'three';
import type { Diagram, Project, Rect } from '../types';
import { getImage } from './media';
import { EASE } from './motion';
import { hashSeed, rng } from './rng';

type THREE = typeof THREE_NS;
let T: THREE | null = null;
let loading: Promise<THREE | null> | null = null;

/** load three.js once (about 180 kB gzip, only when a 3D scene is used) */
export function ensure3D(): Promise<THREE | null> {
  if (T) return Promise.resolve(T);
  loading ??= import('three').then((m) => (T = m)).catch(() => null);
  return loading;
}
export const has3D = () => !!T;

interface Built { key: string; scene: THREE_NS.Scene; cam: THREE_NS.PerspectiveCamera; cards: THREE_NS.Object3D[]; stars: THREE_NS.Points; pillars: THREE_NS.Mesh[] }
let renderer: THREE_NS.WebGLRenderer | null = null;
let canvas: HTMLCanvasElement | null = null;
let built: Built | null = null;
let failed = false;
const texCache = new Map<string, THREE_NS.Texture>();

function panelTexture(project: Project, pageId: string, r: Rect): THREE_NS.Texture | null {
  const pg = project.pages.find((p) => p.id === pageId);
  const a = pg && getImage(pg.mediaId);
  if (!a || !T) return null;
  const key = `${pageId}:${r.x},${r.y},${r.w},${r.h}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const k = Math.min(1, 1024 / Math.max(r.w, r.h));
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.round(r.w * k)); c.height = Math.max(2, Math.round(r.h * k));
  c.getContext('2d')!.drawImage(a.img, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
  const t = new T.CanvasTexture(c);
  t.colorSpace = T.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(key, t);
  if (texCache.size > 64) { const first = texCache.keys().next().value!; texCache.get(first)?.dispose(); texCache.delete(first); }
  return t;
}

function labelTexture(label: string, sub: string | undefined, accent: string): THREE_NS.Texture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const x = c.getContext('2d')!;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = '700 92px "Space Grotesk Variable", "Space Grotesk", system-ui, sans-serif';
  x.fillStyle = '#fff';
  x.shadowColor = 'rgba(0,0,0,.8)'; x.shadowBlur = 18;
  x.fillText(label.toUpperCase(), 512, sub ? 90 : 128, 980);
  if (sub) { x.font = '600 62px "Inter Variable", Inter, system-ui, sans-serif'; x.fillStyle = accent; x.fillText(sub, 512, 190, 980); }
  const t = new T!.CanvasTexture(c);
  t.colorSpace = T!.SRGBColorSpace;
  return t;
}

/** the value of an item for a scale: its number if it has one, else its rank */
export function itemValues(d: Diagram): number[] {
  const nums = d.items.map((it) => parseFloat(String(it.sub ?? '').replace(/\s/g, '').replace(',', '.')));
  if (nums.length && nums.every((n) => Number.isFinite(n) && n > 0)) return nums;
  return d.items.map((_, i) => i + 1);
}

function build(project: Project, d: Diagram, aspect: number): Built {
  const t = T!;
  const scene = new t.Scene();
  scene.background = new t.Color('#05060b');
  scene.fog = new t.FogExp2('#05060b', d.kind === 'cosmos' ? 0.035 : 0.02);
  const cam = new t.PerspectiveCamera(40, aspect, 0.1, 400);
  scene.add(new t.AmbientLight('#ffffff', 1.6));
  const key = new t.DirectionalLight(project.accent, 1.2);
  key.position.set(4, 6, 8);
  scene.add(key);

  // seeded starfield: same stars on every render
  const r = rng(hashSeed('stars' + d.kind));
  const N = 2600, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const tint = new t.Color(project.accent);
  for (let i = 0; i < N; i++) {
    const rad = 30 + r() * 120, th = r() * Math.PI * 2, ph = Math.acos(2 * r() - 1);
    pos[i * 3] = rad * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = rad * Math.cos(ph); pos[i * 3 + 2] = rad * Math.sin(ph) * Math.sin(th);
    const c = r() < 0.12 ? tint : new t.Color(0.75 + r() * 0.25, 0.8 + r() * 0.2, 1);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const g = new t.BufferGeometry();
  g.setAttribute('position', new t.BufferAttribute(pos, 3));
  g.setAttribute('color', new t.BufferAttribute(col, 3));
  const stars = new t.Points(g, new t.PointsMaterial({ size: 0.35, vertexColors: true, sizeAttenuation: true, fog: false }));
  scene.add(stars);

  const cards: THREE_NS.Object3D[] = [];
  const pillars: THREE_NS.Mesh[] = [];
  const n = Math.max(1, d.items.length);
  const vals = itemValues(d);
  const vmax = Math.max(...vals, 1);
  d.items.forEach((it, i) => {
    const grp = new t.Group();
    const tex = it.pageId && it.rect ? panelTexture(project, it.pageId, it.rect) : null;
    const ar = it.rect ? it.rect.w / it.rect.h : 0.75;
    const h = 2.4, w = Math.min(4.2, h * ar);
    const frame = new t.Mesh(new t.PlaneGeometry(w + 0.12, h + 0.12), new t.MeshBasicMaterial({ color: project.accent }));
    frame.position.z = -0.01;
    grp.add(frame);
    const face = new t.Mesh(new t.PlaneGeometry(w, h), tex ? new t.MeshBasicMaterial({ map: tex }) : new t.MeshBasicMaterial({ color: '#22232b' }));
    grp.add(face);
    if (it.label || it.sub) {
      const lab = new t.Mesh(new t.PlaneGeometry(3.6, 0.9), new t.MeshBasicMaterial({ map: labelTexture(it.label, it.sub, project.accent), transparent: true, depthWrite: false }));
      lab.position.set(0, -h / 2 - 0.62, 0.02);
      grp.add(lab);
    }
    if (d.kind === 'orbit') {
      const a = (i / n) * Math.PI * 2, R = Math.max(4.5, n * 1.25);
      grp.position.set(Math.sin(a) * R, 0, Math.cos(a) * R);
      grp.lookAt(0, 0, 0); grp.rotateY(Math.PI);
    } else if (d.kind === 'cosmos') {
      const rr = rng(hashSeed('cosmos' + i));
      // portrait: smaller panels, closer to the axis, further apart in depth
      const pt = aspect < 1;
      grp.scale.setScalar(pt ? 0.62 : 1);
      grp.position.set((i % 2 ? 1 : -1) * (pt ? 0.9 + rr() * 0.5 : 2.8 + rr() * 1.6), (rr() - 0.5) * (pt ? 3.6 : 2.6), -i * (pt ? 9 : 5.5));
      grp.rotation.set((rr() - 0.5) * 0.25, (i % 2 ? -1 : 1) * (0.15 + rr() * 0.2), (rr() - 0.5) * 0.12);
    } else {
      // tiers: pillar height follows the value (log scale keeps huge gaps readable)
      const hgt = 0.6 + 7 * (Math.log1p(vals[i]) / Math.log1p(vmax));
      const x = (i - (n - 1) / 2) * 4.6;
      const pil = new t.Mesh(new t.BoxGeometry(2.6, 1, 2.6), new t.MeshStandardMaterial({ color: '#1a1b24', emissive: project.accent, emissiveIntensity: 0.12 + 0.5 * (i / Math.max(1, n - 1)), roughness: 0.6 }));
      pil.position.set(x, 0, 0);
      pil.userData = { h: hgt };
      scene.add(pil);
      pillars.push(pil);
      grp.position.set(x, hgt + h / 2 + 0.4, 0);
      grp.userData = { h: hgt };
    }
    scene.add(grp);
    cards.push(grp);
  });
  if (d.kind === 'tiers') {
    const floor = new t.GridHelper(80, 40, project.accent, '#262833');
    (floor.material as THREE_NS.Material).transparent = true;
    (floor.material as THREE_NS.Material).opacity = 0.35;
    scene.add(floor);
  }
  return { key: '', scene, cam, cards, stars, pillars };
}

function sceneKey(d: Diagram, W: number, H: number, accent: string) {
  return JSON.stringify([d.kind, d.items.map((i) => [i.pageId, i.rect, i.label, i.sub]), W, H, accent]);
}

/** place the camera and the animated objects at time `local` of a `dur`-second shot */
function animate(b: Built, d: Diagram, local: number, dur: number) {
  const t = T!;
  const p = Math.min(1, Math.max(0, local / dur));
  const n = Math.max(1, b.cards.length);
  const cam = b.cam;
  /** portrait frames see less width: step back */
  const far = cam.aspect < 1 ? 1.7 : 1;
  b.stars.rotation.y = local * 0.01;
  if (d.kind === 'orbit') {
    const R = Math.max(4.5, n * 1.25);
    // first 35 %: wide orbit, then visit each panel in turn
    if (p < 0.35) {
      const e = EASE.cinematic(p / 0.35);
      const a = -0.6 + e * 1.2;
      cam.position.set(Math.sin(a) * (R + 9 * far), 3.5 - e * 2.5, Math.cos(a) * (R + 9 * far));
      cam.lookAt(0, 0, 0);
    } else {
      const q = ((p - 0.35) / 0.65) * n;
      const i = Math.min(n - 1, Math.floor(q));
      const f = EASE.cinematic(Math.min(1, (q - i) * 1.6));
      const from = i === 0 ? new t.Vector3(Math.sin(0.6) * (R + 9 * far), 1, Math.cos(0.6) * (R + 9 * far)) : b.cards[i - 1].position.clone().multiplyScalar((R + 8 * far) / R);
      const to = b.cards[i].position.clone().multiplyScalar((R + 8 * far) / R);
      cam.position.lerpVectors(from, to, f);
      cam.position.y = 0.6;
      const look = (i === 0 ? new t.Vector3() : b.cards[i - 1].position.clone()).lerp(b.cards[i].position, f);
      look.y = -0.3;
      cam.lookAt(look);
    }
    // the panels always face the camera, so the far side of the ring stays readable
    b.cards.forEach((c, i) => { c.position.y = Math.sin(local * 0.9 + i) * 0.12; c.quaternion.copy(cam.quaternion); });
  } else if (d.kind === 'cosmos') {
    const lastC = b.cards[n - 1].position;
    const e = EASE.cinematic(p);
    const endZ = lastC.z + 7.5;
    const k = EASE.standard(Math.min(1, Math.max(0, (p - 0.55) / 0.45)));
    const x = Math.sin(local * 0.25) * 0.6 * (1 - k) + lastC.x * 0.85 * k;
    const y = Math.cos(local * 0.2) * 0.3 * (1 - k) + (lastC.y - 0.3) * k;
    cam.position.set(x, y, 9 + (endZ - 9) * e);
    cam.lookAt(x * (1 - k) * 0.3 + lastC.x * k, y * (1 - k) + (lastC.y - 0.4) * k, cam.position.z - 10);
    b.cards.forEach((c, i) => { c.rotation.z = Math.sin(local * 0.3 + i * 1.7) * 0.05; });
  } else {
    // tiers: pillars rise one after another, then the camera climbs to the top
    b.pillars.forEach((pl, i) => {
      const rise = EASE.enter(Math.min(1, Math.max(0, (local - 0.3 - i * 0.35) / 0.9)));
      const h = Math.max(0.001, pl.userData.h * rise);
      pl.scale.y = h; pl.position.y = h / 2;
      const card = b.cards[i];
      card.position.y = h + 2.7;
      card.visible = rise > 0.02;
      card.scale.setScalar(0.6 + 0.4 * rise);
    });
    const last = b.cards[n - 1]?.position ?? new t.Vector3();
    const e = EASE.cinematic(p);
    const first = b.cards[0]?.position ?? new t.Vector3();
    const top = (b.pillars[n - 1]?.userData.h ?? 4) + 2.7;
    // start low on the weakest, end wide enough to see the whole climb up to the strongest
    // landscape ends wide on the whole climb; portrait tracks up to the strongest
    const portrait = cam.aspect < 1;
    const lx = first.x * (1 - e) + last.x * (portrait ? 1 : 0.55) * e;
    const y0 = Math.max(2.2, first.y - 0.4);
    cam.position.set(lx - 1.5 * (1 - e), y0 + e * (top + 0.5 - y0), (13 + e * (portrait ? 4 : n * 2.4)) * (portrait ? 1.3 : 1));
    cam.lookAt(lx, y0 - 0.6 + e * (top * 0.72 - y0 + 0.6), 0);
  }
  cam.updateProjectionMatrix();
}

/** draw a 3D diagram; false when three.js or WebGL is not available */
export function draw3D(ctx: CanvasRenderingContext2D, project: Project, d: Diagram, W: number, H: number, local: number, dur: number): boolean {
  if (!T || failed) return false;
  try {
    if (!renderer) {
      canvas = document.createElement('canvas');
      renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      renderer.outputColorSpace = T.SRGBColorSpace;
    }
    if (canvas!.width !== W || canvas!.height !== H) renderer.setSize(W, H, false);
    const key = sceneKey(d, W, H, project.accent);
    if (!built || built.key !== key) {
      built?.scene.traverse((o) => { const m = o as THREE_NS.Mesh; m.geometry?.dispose?.(); });
      built = build(project, d, W / H);
      built.key = key;
    }
    animate(built, d, local, dur);
    renderer.render(built.scene, built.cam);
    ctx.drawImage(canvas!, 0, 0, W, H);
    return true;
  } catch (e) {
    console.warn('[forge] scène 3D indisponible', e);
    failed = true;
    return false;
  }
}
