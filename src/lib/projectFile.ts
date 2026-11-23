import type { Project } from '../types';
import { ensureMedia, mediaBlob, putMediaBlob } from '../engine/media';

const MAGIC = 'forge-project@1';

const toDataUrl = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(b);
  });

/** Self-contained project file: JSON + embedded media. */
export async function saveProjectFile(p: Project): Promise<Blob> {
  const ids = [...p.pages.map((x) => x.mediaId), ...p.audio.map((x) => x.mediaId)];
  const media: Record<string, string> = {};
  for (const id of new Set(ids)) {
    const b = await mediaBlob(id);
    if (b) media[id] = await toDataUrl(b);
  }
  return new Blob([JSON.stringify({ magic: MAGIC, project: p, media })], { type: 'application/json' });
}

export async function openProjectFile(file: File): Promise<Project> {
  const data = JSON.parse(await file.text());
  if (data.magic !== MAGIC) throw new Error("Ce fichier n'est pas un projet Forge.");
  for (const [id, url] of Object.entries<string>(data.media ?? {})) {
    const blob = await (await fetch(url)).blob();
    await putMediaBlob(id, blob);
  }
  const p: Project = data.project;
  await Promise.all([
    ...p.pages.map((x) => ensureMedia(x.mediaId, 'image')),
    ...p.audio.map((x) => ensureMedia(x.mediaId, 'audio')),
  ]);
  return p;
}
