/**
 * Hand-off to a classic editor: the edit as an OpenTimelineIO file (.otio,
 * the ASWF interchange format that DaVinci Resolve imports), packed with its
 * media and subtitles in a .zip. Panels are still images of their page; the
 * Forge framing (panel rect, camera move, transition) travels as metadata.
 * Written by Forge, no OpenTimelineIO dependency.
 */
import { zipSync } from 'fflate';
import type { Project } from '../types';
import { layoutShots, overlayMode, segmentsOf, videoDuration } from './timeline';
import { mediaBlob } from './media';
import { TRANSITION } from './effects';

type J = Record<string, unknown>;
const RT = (sec: number, rate: number): J => ({ OTIO_SCHEMA: 'RationalTime.1', rate, value: Math.round(sec * rate) });
const TR = (start: number, dur: number, rate: number): J => ({ OTIO_SCHEMA: 'TimeRange.1', start_time: RT(start, rate), duration: RT(dur, rate) });
const item = (schema: string, name: string, range: J, metadata: J = {}): J => ({ OTIO_SCHEMA: schema, metadata, name, source_range: range, effects: [], markers: [], enabled: true });

function clip(name: string, url: string, start: number, dur: number, rate: number, metadata: J = {}, available?: [number, number]): J {
  return {
    ...item('Clip.2', name, TR(start, dur, rate), metadata),
    media_references: {
      DEFAULT_MEDIA: {
        OTIO_SCHEMA: 'ExternalReference.1', metadata: {}, name, target_url: url,
        available_range: available ? TR(available[0], available[1], rate) : null, available_image_bounds: null,
      },
    },
    active_media_reference_key: 'DEFAULT_MEDIA',
  };
}
const gap = (dur: number, rate: number, name = '', metadata: J = {}) => item('Gap.1', name, TR(0, dur, rate), metadata);
const track = (name: string, kind: 'Video' | 'Audio', children: J[]): J => ({ ...item('Track.1', name, null as unknown as J), children, kind });

const safe = (s: string) => s.replace(/[^\w\-. ]+/g, '_').trim() || 'media';
const extOf = (b: Blob) => (b.type.includes('png') ? 'png' : b.type.includes('jpeg') || b.type.includes('jpg') ? 'jpg' : b.type.includes('webp') ? 'webp'
  : b.type.includes('mp4') ? 'mp4' : b.type.includes('webm') ? 'webm' : b.type.includes('wav') ? 'wav' : b.type.includes('mpeg') ? 'mp3' : b.type.includes('ogg') ? 'ogg' : 'bin');

/** places clips on a track at absolute times, filling the holes with gaps */
function lay(items: { at: number; dur: number; node: J; tr?: { kind: string; dur: number } }[], rate: number): J[] {
  const out: J[] = [];
  let t = 0;
  for (const it of items.sort((a, b) => a.at - b.at)) {
    const at = Math.max(t, it.at);
    if (at - t > 0.5 / rate) out.push(gap(at - t, rate));
    else if (it.tr && out.length && it.tr.kind !== 'cut') {
      const half = it.tr.dur / 2;
      out.push({ OTIO_SCHEMA: 'Transition.1', metadata: { forge: { transition: it.tr.kind } }, name: TRANSITION[it.tr.kind as 'fade']?.label ?? it.tr.kind,
        in_offset: RT(half, rate), out_offset: RT(half, rate), transition_type: 'SMPTE_Dissolve' });
    }
    out.push(it.node);
    t = at + it.dur;
  }
  return out;
}

/** the timeline as OTIO JSON; `urls` maps media ids to paths inside the bundle */
export function buildOtio(p: Project, urls: Record<string, string>): J {
  const rate = p.fps || 30;
  const timed = layoutShots(p);
  const overlay = overlayMode(p);
  const pageName = (id: string | null) => p.pages.find((x) => x.id === id);
  const shotItems = timed.map((ts) => {
    const s = ts.shot;
    const pg = pageName(s.pageId);
    const meta = { forge: { shot: s.id, rect: s.rect, layout: s.layout, motion: s.motion, intensity: s.intensity, caption: s.caption.text, transition: s.transition, transitionDur: s.transitionDur, diagram: s.diagram?.kind ?? null } };
    const node = pg && urls[pg.mediaId]
      ? clip(`${pg.name} · case`, urls[pg.mediaId], 0, s.duration, rate, meta)
      : gap(s.duration, rate, s.diagram ? `Schéma : ${s.diagram.title || s.diagram.kind}` : s.caption.text ? `Carton : ${s.caption.text.slice(0, 40)}` : 'Carton', meta);
    const tr = s.transition === 'glide' ? 'cut' : s.transition;
    return { at: ts.start, dur: s.duration, node, tr: { kind: tr, dur: Math.min(s.transitionDur, s.duration * 0.45) } };
  });
  const tracks: J[] = [];
  const audio: J[] = [];
  const ar = p.aroll;
  if (ar && urls[ar.mediaId]) {
    const segs = segmentsOf(ar).map((g, i) => ({ at: g.t, dur: g.e - g.s, node: clip(`${ar.name} #${i + 1}`, urls[ar.mediaId], g.s, g.e - g.s, rate, {}, [0, ar.duration]) }));
    tracks.push(track('V1 Face caméra', 'Video', lay(segs.map((x) => ({ ...x })), rate)));
    audio.push(track('A1 Voix (rush)', 'Audio', lay(segs.map((x) => ({ ...x, node: { ...x.node } })), rate)));
  }
  tracks.push(track(overlay ? 'V2 Cases' : 'V1 Cases', 'Video', lay(shotItems, rate)));
  for (const kind of ['voice', 'music', 'sfx'] as const) {
    const clips = p.audio.filter((c) => c.kind === kind && urls[c.mediaId]);
    if (!clips.length) continue;
    const name = { voice: 'Voix off', music: 'Musique', sfx: 'Bruitages' }[kind];
    audio.push(track(`A${audio.length + 1} ${name}`, 'Audio', lay(clips.map((c) => ({
      at: c.start, dur: c.duration,
      node: clip(c.name, urls[c.mediaId], c.offset, c.duration, rate, { forge: { volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut } }, [0, c.sourceDuration]),
    })), rate)));
  }
  return {
    OTIO_SCHEMA: 'Timeline.1',
    metadata: { forge: { engine: p.engine, format: p.format, fps: rate, duration: videoDuration(p), profile: p.direction?.profile ?? null } },
    name: p.name || 'Forge',
    global_start_time: RT(0, rate),
    tracks: { ...item('Stack.1', 'tracks', null as unknown as J), children: [...tracks, ...audio] },
  };
}

/** .zip with timeline.otio, the media it points to and the subtitles */
export async function exportOtioBundle(p: Project, srt: string): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const urls: Record<string, string> = {};
  const used = new Set<string>();
  const add = async (id: string, folder: string, name: string) => {
    if (urls[id]) return;
    const b = await mediaBlob(id);
    if (!b) return;
    let path = `media/${folder}/${safe(name)}.${extOf(b)}`;
    for (let k = 2; used.has(path); k++) path = `media/${folder}/${safe(name)}-${k}.${extOf(b)}`;
    used.add(path);
    files[path] = new Uint8Array(await b.arrayBuffer());
    urls[id] = path;
  };
  const usedPages = new Set(p.shots.map((s) => s.pageId).filter(Boolean));
  for (const pg of p.pages) if (usedPages.has(pg.id)) await add(pg.mediaId, 'pages', pg.name);
  if (p.aroll) await add(p.aroll.mediaId, 'rush', p.aroll.name);
  for (const c of p.audio) await add(c.mediaId, 'audio', c.name);
  const enc = new TextEncoder();
  files['timeline.otio'] = enc.encode(JSON.stringify(buildOtio(p, urls), null, 1));
  if (srt.trim()) files['sous-titres.srt'] = enc.encode(srt);
  files['LISEZ-MOI.txt'] = enc.encode([
    'Montage Forge au format OpenTimelineIO.',
    '',
    'DaVinci Resolve : Fichier > Importer > Timeline… puis choisis timeline.otio (laisse les médias dans le dossier media/).',
    'Premiere Pro n’ouvre pas les .otio directement : passe par DaVinci Resolve (export XML) ou par l’outil otioconvert.',
    '',
    'Les cases arrivent comme la page entière en plan fixe : le cadrage de la case, le mouvement de caméra',
    'et la transition Forge sont notés dans les métadonnées de chaque plan (forge.rect, forge.motion, forge.transition).',
    'Les schémas, cartons et scènes 3D sont des espaces vides nommés : exporte-les en MP4 depuis Forge si tu en as besoin.',
  ].join('\n'));
  return new Blob([zipSync(files, { level: 0 }) as BlobPart], { type: 'application/zip' });
}
