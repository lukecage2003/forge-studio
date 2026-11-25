import { unzipSync } from 'fflate';

/**
 * Turns whatever the user drops into page images: PDF (every page rendered),
 * CBZ/ZIP comic archives, or plain images. Everything happens locally.
 */
export interface PageImage { name: string; blob: Blob }

const natural = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
const IMG = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;

export const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
export const isArchive = (f: File) => /\.(cbz|zip)$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-cbz';
export const isImage = (f: File) => f.type.startsWith('image/') || IMG.test(f.name);
export const isComicFile = (f: File) => isPdf(f) || isArchive(f) || isImage(f);

let pdfjs: typeof import('pdfjs-dist') | null = null;
async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  return pdfjs;
}

const toBlob = (c: HTMLCanvasElement, type = 'image/jpeg', q = 0.9) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Rendu de page impossible'))), type, q));

async function pdfPages(file: File, onPage: (i: number, n: number) => void): Promise<PageImage[]> {
  const lib = await loadPdfjs();
  let doc;
  try {
    doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (e) {
    const msg = (e as Error).name === 'PasswordException' ? 'PDF protégé par mot de passe' : 'PDF illisible';
    throw new Error(`${file.name} : ${msg}.`);
  }
  const base = file.name.replace(/\.pdf$/i, '');
  const out: PageImage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    onPage(i, doc.numPages);
    try {
      const page = await doc.getPage(i);
      const v1 = page.getViewport({ scale: 1 });
      // ~2200 px on the long side, max ~7 Mpx: sharp enough for 1080p zooms, light on memory
      let scale = 2200 / Math.max(v1.width, v1.height);
      scale = Math.min(scale, Math.sqrt(7e6 / (v1.width * v1.height)));
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width);
      c.height = Math.round(vp.height);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      out.push({ name: `${base} p${String(i).padStart(2, '0')}`, blob: await toBlob(c) });
      page.cleanup();
      c.width = c.height = 0;
    } catch {
      /* a broken page is skipped, the others still import */
    }
  }
  await doc.destroy();
  return out;
}

function archivePages(buf: Uint8Array, name: string): PageImage[] {
  const files = unzipSync(buf, { filter: (f) => IMG.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name) });
  const base = name.replace(/\.(cbz|zip)$/i, '');
  return Object.keys(files)
    .sort(natural.compare)
    .map((k, i) => {
      const ext = k.split('.').pop()!.toLowerCase();
      const type = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return { name: `${base} p${String(i + 1).padStart(2, '0')}`, blob: new Blob([files[k] as BlobPart], { type }) };
    });
}

export async function filesToPages(files: File[], progress: (label: string) => void): Promise<{ pages: PageImage[]; errors: string[] }> {
  const pages: PageImage[] = [];
  const errors: string[] = [];
  const sorted = [...files].sort((a, b) => natural.compare(a.name, b.name));
  for (const f of sorted) {
    try {
      if (isPdf(f)) {
        pages.push(...(await pdfPages(f, (i, n) => progress(`${f.name} : page ${i}/${n}`))));
      } else if (isArchive(f)) {
        progress(`Ouverture de ${f.name}…`);
        const p = archivePages(new Uint8Array(await f.arrayBuffer()), f.name);
        if (!p.length) errors.push(`${f.name} : aucune image dans l’archive.`);
        pages.push(...p);
      } else if (isImage(f)) {
        pages.push({ name: f.name.replace(/\.[^.]+$/, ''), blob: f });
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { pages, errors };
}
