import {
  ALL_FORMATS, AudioBufferSource, type WrappedCanvas, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output,
  QUALITY_HIGH, QUALITY_VERY_HIGH, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
} from 'mediabunny';
import type { Project } from '../types';
import { FORMATS } from '../types';
import { renderMix } from './audio';
import { createRenderer, loadFonts } from './render';
import { layoutShots, segmentsOf, videoDuration } from './timeline';
import { ensureMedia, ensureVideo, mediaBlob } from './media';
import { toSource } from './speech';
import { validateProject } from './validate';
import { loadSegmenter } from './segment';

export interface ExportOpts {
  quality: 'high' | 'max';
  fps: number;
  onProgress: (p: number, label: string) => void;
  signal: AbortSignal;
}

export async function exportMp4(input0: Project, o: ExportOpts): Promise<Blob> {
  const project = validateProject(input0).project;
  if (project.aroll && project.look?.cutout !== false && project.fx?.some((f) => f.kind !== 'callout')) {
    o.onProgress(0, 'Chargement du détourage…');
    await loadSegmenter();
  }
  if (typeof VideoEncoder === 'undefined') {
    throw new Error("Ton navigateur ne supporte pas l'encodage vidéo (WebCodecs). Utilise Chrome, Edge ou Firefox récent.");
  }
  const { w: W, h: H } = FORMATS[project.format];
  const duration = videoDuration(project);
  if (duration <= 0) throw new Error('Le projet est vide : ajoute des cases ou un rush avant d’exporter.');

  o.onProgress(0, 'Préparation des médias…');
  await loadFonts();
  await Promise.all([
    ...project.pages.map((p) => ensureMedia(p.mediaId, 'image')),
    ...project.audio.map((a) => ensureMedia(a.mediaId, 'audio')),
    ...(project.aroll ? [ensureVideo(project.aroll.mediaId)] : []),
  ]);

  const quality = o.quality === 'max' ? QUALITY_VERY_HIGH : QUALITY_HIGH;
  const vcodec = await getFirstEncodableVideoCodec(['avc', 'hevc', 'vp9', 'av1'], { width: W, height: H, quality, frameRate: o.fps });
  if (!vcodec) throw new Error('Aucun encodeur vidéo disponible dans ce navigateur.');
  const hasAudio = project.audio.length > 0 || !!project.aroll;
  const acodec = hasAudio ? await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000, quality }) : null;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const renderer = createRenderer(W, H);

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: vcodec, quality, keyFrameInterval: 1 });
  output.addVideoTrack(video, { frameRate: o.fps });
  let audio: AudioBufferSource | null = null;
  if (acodec) {
    audio = new AudioBufferSource({ codec: acodec, quality });
    output.addAudioTrack(audio);
  }
  await output.start();

  try {
    if (audio) {
      o.onProgress(0.01, 'Mixage audio…');
      const mix = await renderMix(project, duration);
      await audio.add(mix);
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
      renderer.draw(ctx, project, t, () => faceFrame);
      await video.add(t, dt);
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

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
