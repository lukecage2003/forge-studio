import { DIAGRAM_3D } from '../types';
import {
  ALL_FORMATS, AudioBufferSource, BufferSource, type WrappedCanvas, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output,
  Quality, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
} from 'mediabunny';
import type { Project } from '../types';
import { FORMATS } from '../types';
import { masterMix, type MixInfo } from './audio';
import { createRenderer, loadFonts } from './render';
import { layoutShots, segmentsOf, videoDuration } from './timeline';
import { ensureMedia, ensureVideo, mediaBlob } from './media';
import { toSource } from './speech';
import { validateProject } from './validate';
import { sfxEvents } from './sfx';
import { loadSegmenter } from './segment';

export interface ExportOpts {
  quality: 'high' | 'max';
  fps: number;
  onProgress: (p: number, label: string) => void;
  signal: AbortSignal;
  /** 2 = 4K (2160p) */
  scale?: 1 | 2;
  /** false = subtitles not drawn in the picture (deliver them as .srt / .ass) */
  burnSubtitles?: boolean;
  /** sync check of the finished file: track lengths and the gap between picture and sound */
  onCheck?: (c: SyncCheck) => void;
  /** what the encoder really uses (codec, bitrate, graphics card or not, audio codec) */
  onEncoder?: (e: { codec: string; mbps: number; hardware: boolean; audio: string | null }) => void;
  /** loudness of the exported mix, once measured */
  onMix?: (info: MixInfo) => void;
  /** awaited between frames: pause point and a turn for the interface (production orchestrator) */
  step?: () => Promise<void>;
}

export interface SyncCheck { video: number; audio: number | null; expected: number; startGap: number; ok: boolean }

/** read the exported MP4 back and compare its tracks (the check a delivery department does) */
export async function checkSync(buf: ArrayBuffer, expected: number): Promise<SyncCheck> {
  const input = new Input({ source: new BufferSource(buf), formats: ALL_FORMATS });
  const vt = await input.getPrimaryVideoTrack();
  const at = await input.getPrimaryAudioTrack();
  const video = vt ? await vt.computeDuration() : 0;
  const audio = at ? await at.computeDuration() : null;
  const startGap = vt && at ? Math.abs((await vt.getFirstTimestamp()) - (await at.getFirstTimestamp())) : 0;
  const ok = Math.abs(video - expected) < 0.1 && (audio == null || (Math.abs(audio - video) < 0.1 && startGap < 0.05));
  (input as unknown as { dispose?: () => void }).dispose?.();
  return { video, audio, expected, startGap, ok };
}

/** video bitrate (Mb/s): « high » 16 at 1080p30, « max » 30 (visually lossless); scaled by pixels and frame rate */
export function videoBitrate(W: number, H: number, fps: number, q: 'high' | 'max'): number {
  const base = q === 'max' ? 30 : 16;
  const px = (W * H) / (1920 * 1080);
  return Math.round(base * Math.pow(px, 0.85) * (fps > 30 ? 1.5 : fps < 30 ? 0.85 : 1));
}

const CODEC_STR: Record<string, string> = { avc: 'avc1.640033', hevc: 'hvc1.1.6.L150.B0', vp9: 'vp09.00.51.08', av1: 'av01.0.12M.08' };
async function canEncode(codec: string, W: number, H: number, fps: number, mbps: number, hardwareAcceleration: 'prefer-hardware') {
  try { return !!(await VideoEncoder.isConfigSupported({ codec: CODEC_STR[codec] ?? codec, width: W, height: H, framerate: fps, bitrate: mbps * 1e6, hardwareAcceleration })).supported; } catch { return false; }
}

/** pixel size of an export: the format at 1080p, or doubled for 4K */
export function exportSize(format: Project['format'], scale: 1 | 2 = 1) {
  const { w, h } = FORMATS[format];
  return { W: w * scale, H: h * scale };
}

export async function exportMp4(input0: Project, o: ExportOpts): Promise<Blob> {
  const v = validateProject(input0).project;
  const project = o.burnSubtitles === false ? { ...v, subtitleStyle: { ...v.subtitleStyle, on: false } } : v;
  if (project.aroll && project.look?.cutout !== false && project.fx?.some((f) => f.kind !== 'callout')) {
    o.onProgress(0, 'Chargement du détourage…');
    await loadSegmenter();
  }
  if (typeof VideoEncoder === 'undefined') {
    throw new Error("Ton navigateur ne supporte pas l'encodage vidéo (WebCodecs). Utilise Chrome, Edge ou Firefox récent.");
  }
  const { W, H } = exportSize(project.format, o.scale ?? 1);
  const duration = videoDuration(project);
  if (duration <= 0) throw new Error('Le projet est vide : ajoute des cases ou un rush avant d’exporter.');

  o.onProgress(0, 'Préparation des médias…');
  await loadFonts();
  await Promise.all([
    ...project.pages.map((p) => ensureMedia(p.mediaId, 'image')),
    ...project.audio.map((a) => ensureMedia(a.mediaId, 'audio')),
    ...(project.aroll ? [ensureVideo(project.aroll.mediaId)] : []),
  ]);

  if (project.look?.parallax !== false) {
    const { ensureLayers } = await import('./layers');
    const full = project.shots.filter((s) => s.pageId && !s.zone && s.layout === 'full');
    for (let i = 0; i < full.length; i++) {
      o.onProgress(0, `Relief 2.5D ${i + 1}/${full.length}…`);
      await ensureLayers(project, full[i]);
    }
  }
  if (project.shots.some((s) => s.diagram && DIAGRAM_3D.includes(s.diagram.kind))) {
    o.onProgress(0, 'Chargement des scènes 3D…');
    const { ensure3D } = await import('./scene3d');
    await ensure3D();
  }
  // explicit bitrates (TikTok / YouTube re-encode anyway: give them a clean master)
  const mbps = videoBitrate(W, H, o.fps, o.quality);
  const quality = new Quality({ bitrate: mbps * 1e6 });
  const aquality = new Quality({ bitrate: 256_000 });
  const vcodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: W, height: H, quality, frameRate: o.fps });
  if (!vcodec) throw new Error(o.scale === 2 ? 'Ton navigateur ne peut pas encoder en 4K sur cet ordinateur : exporte en 1080p.' : 'Aucun encodeur vidéo disponible dans ce navigateur.');
  const hasAudio = project.audio.length > 0 || !!project.aroll || sfxEvents(project).length > 0;
  const acodec = hasAudio ? await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000, quality: aquality }) : null;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const renderer = createRenderer(W, H);
  const sub = document.createElement('canvas');
  sub.width = W;
  sub.height = H;
  const subCtx = sub.getContext('2d', { alpha: false })!;

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  // the graphics card's encoder when it has one (much faster), the software one otherwise
  const hw = await canEncode(vcodec, W, H, o.fps, mbps, 'prefer-hardware');
  const video = new CanvasSource(canvas, { codec: vcodec, quality, keyFrameInterval: 1, latencyMode: 'quality', ...(hw ? { hardwareAcceleration: 'prefer-hardware' as const } : {}) });
  o.onEncoder?.({ codec: vcodec, mbps, hardware: hw, audio: acodec });
  output.addVideoTrack(video, { frameRate: o.fps });
  let audio: AudioBufferSource | null = null;
  if (acodec) {
    audio = new AudioBufferSource({ codec: acodec, quality: aquality });
    output.addAudioTrack(audio);
  }
  await output.start();

  try {
    if (audio) {
      o.onProgress(0.01, 'Mixage et volume…');
      const { buffer, info } = await masterMix(project, duration);
      o.onMix?.(info);
      await audio.add(buffer);
      audio.close();
    }
    const frames = Math.round(duration * o.fps);
    const dt = 1 / o.fps;

    // face cam frames, decoded in order with WebCodecs (frame-exact)
    let faceIter: AsyncGenerator<WrappedCanvas | null, void, unknown> | null = null;
    let input: Input | null = null;
    const segs = segmentsOf(project.aroll);
    if (project.aroll && segs.length) {
      const blob = await mediaBlob(project.aroll.mediaId);
      if (blob) {
        input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        const track = await input.getPrimaryVideoTrack();
        if (track) {
          const maxSide = Math.max(W, H);
          const k = Math.min(1, maxSide / Math.max(project.aroll.width, project.aroll.height));
          const sink = new CanvasSink(track, { width: Math.round(project.aroll.width * k), height: Math.round(project.aroll.height * k), fit: 'fill', poolSize: 2 });
          const times = (function* () { for (let f = 0; f < frames; f++) yield toSource(segs, f * dt).src; })();
          faceIter = sink.canvasesAtTimestamps(times);
        }
      }
    }

    for (let f = 0; f < frames; f++) {
      if (o.signal.aborted) throw new DOMException('Export annulé', 'AbortError');
      const t = f * dt;
      let faceFrame: CanvasImageSource | null = null;
      if (faceIter) {
        const r = await faceIter.next();
        faceFrame = (r.value?.canvas as CanvasImageSource) ?? null;
      }
      if (project.look?.motionBlur !== false && renderer.fast(project, t)) {
        // motion blur: average 4 sub-frames across the shutter (180°) on fast moves only
        const n = 4;
        for (let k = 0; k < n; k++) {
          if (k) await o.step?.();
          renderer.draw(subCtx, project, t + ((k + 0.5) / n - 0.5) * dt * 0.5, () => faceFrame);
          ctx.globalAlpha = 1 / (k + 1);
          ctx.drawImage(sub, 0, 0);
        }
        ctx.globalAlpha = 1;
      } else renderer.draw(ctx, project, t, () => faceFrame);
      await video.add(t, dt);
      await o.step?.();
      if (f % 6 === 0) o.onProgress(0.03 + 0.95 * (f / frames), `Rendu image ${f + 1} / ${frames}`);
    }
    video.close();
    await faceIter?.return(undefined);
    (input as unknown as { dispose?: () => void } | null)?.dispose?.();
    o.onProgress(0.99, 'Finalisation du MP4…');
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  }
  const buf = (output.target as BufferTarget).buffer!;
  if (o.onCheck) { o.onProgress(0.995, 'Vérification son / image…'); try { o.onCheck(await checkSync(buf, duration)); } catch { /* unreadable: reported as no check */ } }
  o.onProgress(1, 'Terminé');
  return new Blob([buf], { type: 'video/mp4' });
}

/** Captions as an .srt file (for YouTube subtitles / accessibility). */
export function exportSrt(project: Project) {
  const ts = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  let n = 0;
  if (project.subtitles.length) {
    return project.subtitles.map((s) => `${++n}\n${ts(s.s)} --> ${ts(s.e)}\n${s.text}\n`).join('\n');
  }
  return layoutShots(project)
    .filter((t) => t.shot.caption.text.trim())
    .map((t) => `${++n}\n${ts(t.start)} --> ${ts(t.end)}\n${t.shot.caption.text.trim()}\n`)
    .join('\n');
}

/** kept here for the modules that import it from the export engine */
export { download } from '../lib/util';

/** YouTube chapters (description timestamps) from covers, schemas and title cards */
export function youtubeChapters(project: Project): string {
  const fmt = (t: number) => { const m = Math.floor(t / 60), s = Math.floor(t % 60); return `${m}:${String(s).padStart(2, '0')}`; };
  const marks: { t: number; title: string }[] = [];
  for (const ts of layoutShots(project)) {
    const s = ts.shot;
    const title = s.diagram?.title || (s.pageId == null ? s.caption.text : '') || s.nameTag || '';
    if (title.trim()) marks.push({ t: ts.start, title: title.trim().replace(/\s+/g, ' ').slice(0, 60) });
  }
  // YouTube rules: first at 0:00, at least 3 chapters, each ≥ 10 s
  const out: { t: number; title: string }[] = [];
  for (const m of marks) if (!out.length || m.t - out[out.length - 1].t >= 10) out.push(m);
  if (!out.length || out[0].t > 0) out.unshift({ t: 0, title: 'Introduction' });
  else out[0].t = 0;
  return out.length >= 3 ? out.map((m) => `${fmt(m.t)} ${m.title}`).join('\n') : '';
}

/**
 * Subtitles as Advanced SubStation (.ass): word-by-word karaoke timing (\\k),
 * keywords in the accent colour, the Forge style and position. Opens in
 * DaVinci Resolve, Premiere (via plug-in), VLC, mpv, and burns in with FFmpeg.
 */
export function exportAss(project: Project, keys?: Set<string>, tok?: (w: string) => string): string {
  const { w: W, h: H } = FORMATS[project.format];
  const st = project.subtitleStyle;
  const assColor = (hex: string) => { const h = hex.replace('#', '').padEnd(6, '0'); return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase(); };
  const ts = (x: number) => { const cs = Math.max(0, Math.round(x * 100)); const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s2 = Math.floor((cs % 6000) / 100); return `${h}:${String(m).padStart(2, '0')}:${String(s2).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
  const size = Math.round(Math.min(W, H) * 0.075 * (st.size || 1) * 0.85);
  const y = project.format === '9:16' ? Math.min(0.78, Math.max(0.12, st.y)) : st.y;
  const marginV = Math.round((1 - y) * H - size / 2);
  const upper = ['tiktok', 'impact', 'neon', 'comic'].includes(st.preset);
  const head = [
    '[Script Info]', '; Forge', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 0', 'ScaledBorderAndShadow: yes', '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: Forge,Anton,${size},&H00FFFFFF,${assColor(project.accent)},&H00000000,&H64000000,0,0,0,0,100,100,1,0,1,${Math.max(2, Math.round(size * 0.09))},2,2,60,60,${marginV},1`,
    '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];
  const lines = project.subtitles.map((sb) => {
    const words = sb.words.length ? sb.words : sb.text.split(/\s+/).map((w, i, a) => ({ w, s: sb.s + ((sb.e - sb.s) * i) / a.length, e: sb.s + ((sb.e - sb.s) * (i + 1)) / a.length }));
    const txt = words.map((w, i) => {
      const next = words[i + 1]?.s ?? sb.e;
      const k = Math.max(1, Math.round((next - w.s) * 100));
      const word = upper ? w.w.toUpperCase() : w.w;
      const hot = keys && tok && keys.has(tok(w.w));
      return `{\\k${k}}${hot ? `{\\c${assColor(project.accent)}&}${word}{\\c&H00FFFFFF&}` : word}`;
    }).join(' ');
    return `Dialogue: 0,${ts(sb.s)},${ts(sb.e)},Forge,,0,0,0,,${txt}`;
  });
  return [...head, ...lines].join('\n') + '\n';
}
