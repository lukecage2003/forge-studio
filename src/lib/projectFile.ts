import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { Project } from '../types';
import { ensureMedia, ensureVideo, mediaBlob, putMediaBlob } from '../engine/media';
import { APP_VERSION, ENGINE_VERSIONS, SCHEMA_VERSION } from './schema';

const MAGIC = 'forge-project@1';
const MAGIC2 = 'forge-project@2';

export type MediaKind = 'image' | 'audio' | 'video';

/** every media a project points to: comic pages, audio clips, the face-cam rush, overlay pictures and videos */
export function mediaRefs(p: Project): { id: string; kind: MediaKind }[] {
  const out = new Map<string, MediaKind>();
  for (const x of p.pages ?? []) out.set(x.mediaId, 'image');
  for (const x of p.audio ?? []) out.set(x.mediaId, 'audio');
  if (p.aroll?.mediaId) out.set(p.aroll.mediaId, 'video');
  // overlay tracks: their pictures and videos are used media too (saved, carried in .forge, never cleaned)
  for (const o of p.overlays ?? []) if (o.source.kind === 'image') out.set(o.source.mediaId, 'image'); else if (o.source.kind === 'video') out.set(o.source.mediaId, 'video');
  return [...out].map(([id, kind]) => ({ id, kind }));
}

/** decode what the project needs so preview and export can use it */
export async function loadMediaOf(p: Project) {
  await Promise.all(mediaRefs(p).map((m) => (m.kind === 'video' ? ensureVideo(m.id) : ensureMedia(m.id, m.kind)).catch(() => null)));
}

/** a version of the project carried inside a .forge file (same content as in the workspace) */
export interface CarriedVersion { file: string; text: string }
/** what a .forge file says about itself (read by any later version of Forge) */
export interface ForgeManifest { schemaVersion: number; appVersion: string; engineVersions: Record<string, number>; savedAt: string; versions: number; media: number; missing: string[] }

/**
 * Self-contained project file (.forge): a zip holding project.json (the project
 * and a manifest: schema, Forge build, engine versions), every media as its
 * original bytes (no base64, the rush included) and, when given, the versions
 * of the project with the media they use, so a restore works on another PC.
 * Media are stored without recompression: images, sound and video already are.
 * The magic stays « @2 »: an older Forge still opens the project (and ignores the versions).
 */
export interface CarriedHistory { past: Project[]; future: Project[] }
export async function saveProjectFile(p: Project, opts: { versions?: CarriedVersion[]; history?: CarriedHistory } = {}): Promise<Blob> {
  const files: Zippable = {};
  const types: Record<string, string> = {};
  const versions = opts.versions ?? [];
  const ids = new Set(mediaRefs(p).map((m) => m.id));
  for (const v of versions) { try { for (const m of mediaRefs(JSON.parse(v.text).project ?? {})) ids.add(m.id); } catch { /* unreadable version: kept as text */ } }
  for (const h of [...(opts.history?.past ?? []), ...(opts.history?.future ?? [])]) for (const m of mediaRefs(h)) ids.add(m.id);
  const missing: string[] = [];
  for (const id of ids) {
    const b = await mediaBlob(id);
    if (!b) { missing.push(id); continue; }
    files[`media/${id}`] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }];
    types[id] = b.type;
  }
  for (const v of versions) files[`versions/${v.file}`] = strToU8(v.text);
  // the undo history (Ctrl+Z after reopening); its media are the project's or its versions' (no new bytes)
  if (opts.history?.past.length || opts.history?.future.length) files['history.json'] = strToU8(JSON.stringify(opts.history));
  const manifest: ForgeManifest = { schemaVersion: p.schemaVersion ?? SCHEMA_VERSION, appVersion: APP_VERSION, engineVersions: { ...ENGINE_VERSIONS }, savedAt: new Date().toISOString(), versions: versions.length, media: ids.size - missing.length, missing };
  files['project.json'] = strToU8(JSON.stringify({ magic: MAGIC2, manifest, project: p, types }));
  return new Blob([zipSync(files)], { type: 'application/zip' });
}

/** read a .forge file: zip (version 2 and later) or version 1 (JSON with base64 media) */
export async function readProjectFile(file: Blob): Promise<{ project: Project; media: Map<string, Blob>; versions: CarriedVersion[]; manifest: ForgeManifest | null; history: CarriedHistory | null }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const media = new Map<string, Blob>();
  const versions: CarriedVersion[] = [];
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const z = unzipSync(bytes);
    if (!z['project.json']) throw new Error("Ce fichier n'est pas un projet Forge.");
    const data = JSON.parse(strFromU8(z['project.json']));
    if (data.magic !== MAGIC2) throw new Error("Ce fichier n'est pas un projet Forge.");
    for (const [name, b] of Object.entries(z)) {
      if (name.startsWith('media/')) { const id = name.slice(6); media.set(id, new Blob([b as Uint8Array<ArrayBuffer>], { type: data.types?.[id] ?? '' })); }
      else if (name.startsWith('versions/') && name.length > 9) versions.push({ file: name.slice(9), text: strFromU8(b as Uint8Array) });
    }
    let history: CarriedHistory | null = null;
    try { if (z['history.json']) history = JSON.parse(strFromU8(z['history.json'])); } catch { /* unreadable history: the project still opens */ }
    return { project: data.project, media, versions, manifest: data.manifest ?? null, history };
  }
  const data = JSON.parse(strFromU8(bytes));
  if (data.magic !== MAGIC) throw new Error("Ce fichier n'est pas un projet Forge.");
  for (const [id, url] of Object.entries<string>(data.media ?? {})) media.set(id, await (await fetch(url)).blob());
  return { project: data.project, media, versions, manifest: null, history: null };
}

/** media into the cache, decoded; returns what the studio needs to finish the opening */
export async function openProjectFile(file: File): Promise<{ project: Project; versions: CarriedVersion[]; manifest: ForgeManifest | null; history: CarriedHistory | null }> {
  const { project, media, versions, manifest, history } = await readProjectFile(file);
  for (const [id, blob] of media) await putMediaBlob(id, blob);
  await loadMediaOf(project);
  return { project, versions, manifest, history };
}
