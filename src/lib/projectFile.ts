import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { Project } from '../types';
import { ensureMedia, ensureVideo, mediaBlob, putMediaBlob } from '../engine/media';

const MAGIC = 'forge-project@1';
const MAGIC2 = 'forge-project@2';

export type MediaKind = 'image' | 'audio' | 'video';

/** every media a project points to: comic pages, audio clips, the face-cam rush */
export function mediaRefs(p: Project): { id: string; kind: MediaKind }[] {
  const out = new Map<string, MediaKind>();
  for (const x of p.pages ?? []) out.set(x.mediaId, 'image');
  for (const x of p.audio ?? []) out.set(x.mediaId, 'audio');
  if (p.aroll?.mediaId) out.set(p.aroll.mediaId, 'video');
  return [...out].map(([id, kind]) => ({ id, kind }));
}

/** decode what the project needs so preview and export can use it */
export async function loadMediaOf(p: Project) {
  await Promise.all(mediaRefs(p).map((m) => (m.kind === 'video' ? ensureVideo(m.id) : ensureMedia(m.id, m.kind)).catch(() => null)));
}

/**
 * Self-contained project file (.forge, version 2): a zip holding project.json
 * and every media as its original bytes (no base64), the rush included.
 * Media are stored without recompression: images, sound and video already are.
 */
export async function saveProjectFile(p: Project): Promise<Blob> {
  const files: Zippable = {};
  const types: Record<string, string> = {};
  for (const { id } of mediaRefs(p)) {
    const b = await mediaBlob(id);
    if (!b) continue;
    files[`media/${id}`] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }];
    types[id] = b.type;
  }
  files['project.json'] = strToU8(JSON.stringify({ magic: MAGIC2, project: p, types }));
  return new Blob([zipSync(files)], { type: 'application/zip' });
}

/** read a .forge file: version 2 (zip) or version 1 (JSON with base64 media) */
export async function readProjectFile(file: Blob): Promise<{ project: Project; media: Map<string, Blob> }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const media = new Map<string, Blob>();
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const z = unzipSync(bytes);
    if (!z['project.json']) throw new Error("Ce fichier n'est pas un projet Forge.");
    const data = JSON.parse(strFromU8(z['project.json']));
    if (data.magic !== MAGIC2) throw new Error("Ce fichier n'est pas un projet Forge.");
    for (const [name, b] of Object.entries(z)) {
      if (!name.startsWith('media/')) continue;
      const id = name.slice(6);
      media.set(id, new Blob([b as Uint8Array<ArrayBuffer>], { type: data.types?.[id] ?? '' }));
    }
    return { project: data.project, media };
  }
  const data = JSON.parse(strFromU8(bytes));
  if (data.magic !== MAGIC) throw new Error("Ce fichier n'est pas un projet Forge.");
  for (const [id, url] of Object.entries<string>(data.media ?? {})) media.set(id, await (await fetch(url)).blob());
  return { project: data.project, media };
}

export async function openProjectFile(file: File): Promise<Project> {
  const { project, media } = await readProjectFile(file);
  for (const [id, blob] of media) await putMediaBlob(id, blob);
  await loadMediaOf(project);
  return project;
}
