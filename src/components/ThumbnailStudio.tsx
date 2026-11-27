import { useEffect, useRef, useState } from 'react';
import { Download, ImagePlus, Loader2, Search, X, Clipboard } from 'lucide-react';
import { getState } from '../store';
import { brandOf, drawThumbnail, sticker, trimAlpha, THUMB_PALETTES, type ThumbLayout, type ThumbPalette } from '../engine/brand';
import { getImage, onMediaChange } from '../engine/media';
import { download } from '../lib/util';
import { magicTouchCutout } from '../engine/segment';
import { cutoutOf, depthCutout, hasWebGPU } from '../engine/vision';
import { panelFocus } from '../engine/auto';
import { PanelPicker } from './FxDiagram';
import { cachedLines, readLines } from '../engine/paddleOcr';
import { toast } from './Toast';
import type { Rect } from '../types';

/**
 * Thumbnail in three gestures: a title, one or two characters (pasted from the
 * web, dropped, or taken from a panel), done. In the channel's black and yellow, TikTok cover or YouTube thumbnail, no logo unless asked,
 * live preview, one click to save.
 */
type Slot = { sticker: HTMLCanvasElement; label: string } | null;

const hasAlpha = (c: HTMLCanvasElement) => {
  const x = c.getContext('2d', { willReadFrequently: true })!;
  const d = x.getImageData(0, 0, c.width, c.height).data;
  let t = 0;
  for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 200) t++;
  return t > d.length / (4 * 7) * 0.04;
};

async function imageToCanvas(blob: Blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c;
}

/** share of the picture a cut-out keeps: a character, not the whole panel, is between 4 % and 80 % */
function keptShare(c: HTMLCanvasElement) {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  let n = 0, k = 0;
  for (let i = 3; i < d.length; i += 4 * 5) { n++; if (d[i] > 128) k++; }
  return n ? k / n : 1;
}
/** opaque share of the top, left and right borders: a panel kept whole is opaque all round (the bottom may cut a body) */
function borderShare(c: HTMLCanvasElement) {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  const W = c.width, H = c.height; let n = 0, k = 0;
  const at = (x: number, y: number) => { n++; if (d[(y * W + x) * 4 + 3] > 128) k++; };
  for (let x = 0; x < W; x += 3) at(x, 0);
  for (let y = 0; y < H; y += 3) { at(0, y); at(W - 1, y); }
  return n ? k / n : 1;
}
/** transparent holes inside the figure (an erased balloon over the body), as a share of the figure */
function holeShare(c: HTMLCanvasElement) {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  const S = 4, gw = Math.ceil(c.width / S), gh = Math.ceil(c.height / S);
  const op = new Uint8Array(gw * gh); let solid = 0;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const v = d[(Math.min(c.height - 1, y * S) * c.width + Math.min(c.width - 1, x * S)) * 4 + 3] > 128; op[y * gw + x] = v ? 1 : 0; if (v) solid++; }
  const out = new Uint8Array(gw * gh); const q: number[] = [];
  for (let i = 0; i < gw * gh; i++) { const x = i % gw, y = (i - x) / gw; if (!op[i] && (x === 0 || y === 0 || x === gw - 1 || y === gh - 1)) { out[i] = 1; q.push(i); } }
  while (q.length) { const j = q.pop()!; const x = j % gw; for (const k of [x > 0 ? j - 1 : -1, x < gw - 1 ? j + 1 : -1, j - gw, j + gw]) if (k >= 0 && k < gw * gh && !op[k] && !out[k]) { out[k] = 1; q.push(k); } }
  let holes = 0; for (let i = 0; i < gw * gh; i++) if (!op[i] && !out[i]) holes++;
  return solid ? holes / solid : 1;
}
/** a character, not a panel nor a vehicle: part of the picture, borders free, figure-shaped (not much wider than tall), no hole */
export function characterScore(c: HTMLCanvasElement) {
  const t = trimAlpha(c);
  return { kept: keptShare(c), border: borderShare(c), aspect: t.height / Math.max(1, t.width), holes: holeShare(c) };
}
export const isCharacter = (c: HTMLCanvasElement | null) => {
  if (!c) return false;
  const s = characterScore(c);
  return s.kept > 0.05 && s.kept < 0.65 && s.border < 0.4 && s.aspect >= 0.75 && s.holes < 0.03;
};

/**
 * a cut-out made clean: balloons and lettering (read on the page) erased, then only the
 * main figure kept (the biggest solid part)
 */
export function cleanCut(c: HTMLCanvasElement, erase: Rect[] = []): HTMLCanvasElement {
  const W = c.width, H = c.height;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const x = out.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(c, 0, 0);
  // generous margin: a caption's frame or a balloon's outline must go too
  for (const r of erase) { const m = Math.max(5, Math.min(r.w, r.h) * 0.12); x.clearRect(r.x - m, r.y - m, r.w + 2 * m, r.h + 2 * m); }
  const id = x.getImageData(0, 0, W, H); const d = id.data;
  // parts on a quarter grid (fast), then pixels outside the kept parts cleared
  const S = 4, gw = Math.ceil(W / S), gh = Math.ceil(H / S);
  const on = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) on[gy * gw + gx] = d[((Math.min(H - 1, gy * S + 1) * W) + Math.min(W - 1, gx * S + 1)) * 4 + 3] > 128 ? 1 : 0;
  const lab = new Int32Array(gw * gh); const sizes = [0]; const q: number[] = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || lab[i]) continue;
    const L = sizes.length; let n = 0; lab[i] = L; q.length = 0; q.push(i);
    while (q.length) { const j = q.pop()!; n++; const gx = j % gw, gy = (j - gx) / gw;
      for (const k of [gx > 0 ? j - 1 : -1, gx < gw - 1 ? j + 1 : -1, gy > 0 ? j - gw : -1, gy < gh - 1 ? j + gw : -1]) if (k >= 0 && on[k] && !lab[k]) { lab[k] = L; q.push(k); } }
    sizes.push(n);
  }
  const big = Math.max(0, ...sizes);
  // one figure: the biggest part only (two characters side by side make two stickers, not one)
  const keep = sizes.map((n, i) => n > 0 && n === big && sizes.indexOf(big) === i);
  // only pixels of dropped parts are cleared: the kept figure's own edge stays smooth
  const near = (gx: number, gy: number) => { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const X = gx + i, Y = gy + j; if (X >= 0 && Y >= 0 && X < gw && Y < gh && keep[lab[Y * gw + X]]) return true; } return false; };
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const l = lab[gy * gw + gx];
    if (keep[l] || (!l && near(gx, gy))) continue;
    for (let y = gy * S; y < Math.min(H, gy * S + S); y++) for (let X = gx * S; X < Math.min(W, gx * S + S); X++) d[(y * W + X) * 4 + 3] = 0;
  }
  x.putImageData(id, 0, 0);
  return out;
}

/**
 * a thumbnail shows a CHARACTER, never a panel: transparent PNGs are used as they are,
 * anything else is cut out (background model, Magic Touch, then depth); when no cut-out
 * isolates a character, the picture is refused rather than pasted as a rectangle
 */
export async function toSticker(src: HTMLCanvasElement, focus = { x: 0.5, y: 0.45 }, erase: Rect[] = []): Promise<HTMLCanvasElement> {
  let cut: HTMLCanvasElement | null = hasAlpha(src) ? src : null;
  const r = { x: 0, y: 0, w: src.width, h: src.height };
  const ok = (c: HTMLCanvasElement | null) => { if (!c) return null; const k = cleanCut(c, erase.map((e) => ({ x: e.x * c.width / src.width, y: e.y * c.height / src.height, w: e.w * c.width / src.width, h: e.h * c.height / src.height }))); return isCharacter(k) ? k : null; };
  // the background model (BiRefNet) first: on the graphics card, else tried on the processor
  if (!cut) { try { cut = ok(await cutoutOf(src, r)); } catch { /* next */ } }
  if (!cut && !(await hasWebGPU())) { try { cut = ok(await magicTouchCutout(src, r, focus)); } catch { /* next */ } }
  if (!cut) { try { cut = ok(await depthCutout(src, r)); } catch { /* next */ } }
  if (!cut) throw new Error('aucun personnage détouré dans cette image : prends une autre case ou colle un PNG du personnage');
  const t = trimAlpha(cut);
  return sticker(t, Math.max(6, Math.max(t.width, t.height) * 0.014));
}

/** balloons and lettering of a panel (page px) as rects of its crop (scale k): erased from the cut-out */
function lettering(mediaId: string, rect: Rect, balloons: Rect[] | undefined, k: number): Rect[] {
  const lines = (cachedLines(mediaId) ?? []).filter((l) => l.x + l.w / 2 > rect.x && l.x + l.w / 2 < rect.x + rect.w && l.y + l.h / 2 > rect.y && l.y + l.h / 2 < rect.y + rect.h);
  return [...(balloons ?? []), ...lines].map((b) => ({ x: (b.x - rect.x) * k, y: (b.y - rect.y) * k, w: b.w * k, h: b.h * k }));
}

export function ThumbnailStudio() {
  const b = brandOf(getState().project);
  const [title, setTitle] = useState(() => { const n = getState().project.name; return n && n !== 'Sans titre' ? n : 'L’espoir'; });
  const [slots, setSlots] = useState<Slot[]>([null, null]);
  const [target, setTarget] = useState(0);
  const [layout, setLayout] = useState<'auto' | ThumbLayout>('auto');
  // TikTok cover by default, the channel's black and yellow, no logo
  const [fmt, setFmt] = useState<'tiktok' | 'youtube'>('tiktok');
  const [palette, setPalette] = useState<ThumbPalette>('noir-jaune');
  const [logo, setLogo] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const preview = useRef<HTMLCanvasElement>(null);
  const [, bump] = useState(0);
  useEffect(() => { const off = onMediaChange(() => bump((x) => x + 1)); return () => { off(); }; }, []);

  const chars = slots.filter(Boolean) as NonNullable<Slot>[];
  const lay: ThumbLayout = layout !== 'auto' ? layout : chars.length >= 2 ? 'duo' : 'right';
  const pal = THUMB_PALETTES[palette];
  const render = () => drawThumbnail({ ...b, bg: pal.bg, ink: pal.ink }, title || ' ', lay, chars[0]?.sticker ?? null, chars[1]?.sticker ?? null, { vertical: fmt === 'tiktok', logo });

  useEffect(() => {
    const c = preview.current;
    if (!c) return;
    const out = render();
    c.getContext('2d')!.drawImage(out, 0, 0, c.width, c.height);
  });

  const put = async (src: HTMLCanvasElement, label: string, focus?: { x: number; y: number }, erase?: Rect[]) => {
    setBusy('Détourage…');
    try {
      const st = await toSticker(src, focus, erase);
      setSlots((s) => s.map((x, i) => (i === target ? { sticker: st, label } : x)));
      setTarget((t) => (t === 0 ? 1 : t));
    } catch (e) {
      toast('Image : ' + (e as Error).message, 'error');
    } finally { setBusy(null); }
  };

  // automatic cover: the two strongest panels of the edit (engine/pro coverPicks), one per slot
  const autoCover = async () => {
    const { coverPicks } = await import('../engine/pro');
    const p = getState().project;
    // candidates in order of strength; a panel counts only if a character comes out of it
    const picks = coverPicks(p, 8);
    if (!picks.length) { toast('Aucune case dans le montage pour la couverture.', 'error'); return; }
    setBusy('Détourage des personnages…');
    try {
      const next: Slot[] = [];
      for (const s of picks) {
        if (next.length >= 2) break;
        const pg = p.pages.find((x) => x.id === s.pageId); const a = pg && getImage(pg.mediaId);
        if (!a) continue;
        const c = document.createElement('canvas'); const k = Math.min(1, 1200 / Math.max(s.rect.w, s.rect.h));
        c.width = Math.round(s.rect.w * k); c.height = Math.round(s.rect.h * k);
        c.getContext('2d')!.drawImage(a.img, s.rect.x, s.rect.y, s.rect.w, s.rect.h, 0, 0, c.width, c.height);
        await readLines(pg!.mediaId, a.img, a.width, a.height).catch(() => null); // the lettering, to erase it
        try { next.push({ sticker: await toSticker(c, panelFocus(a.img, s.rect), lettering(pg!.mediaId, s.rect, s.balloons, k)), label: s.chars?.[0] ?? 'Personnage' }); } catch { /* no character here: next panel */ }
      }
      if (!next.length) { toast('Aucun personnage n’a pu être détouré dans les cases : colle un PNG du personnage (Ctrl+V).', 'error'); return; }
      setSlots([next[0], next[1] ?? null]); setTarget(next[1] ? 1 : 0);
      toast(`Couverture : ${next.length} personnage${next.length > 1 ? 's' : ''} détouré${next.length > 1 ? 's' : ''} des cases les plus fortes. Remplace-les si tu veux.`);
    } catch (e) { toast('Image : ' + (e as Error).message, 'error'); } finally { setBusy(null); }
  };

  const fromBlob = async (blob: Blob, label = 'Image') => put(await imageToCanvas(blob), label);

  // paste anywhere while the studio is open: an image, or an image link
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); await fromBlob(file, 'Image collée'); return; }
      const url = e.clipboardData?.getData('text')?.trim();
      if (url && /^https?:\/\/\S+$/i.test(url)) {
        e.preventDefault();
        try {
          const r = await fetch(url, { mode: 'cors' });
          if (!r.ok) throw new Error();
          await fromBlob(await r.blob(), 'Image du web');
        } catch {
          toast('Ce site bloque le téléchargement direct : fais clic droit → « Copier l’image », puis Ctrl+V.', 'error');
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  const fromPanel = (pageId: string, rect: Rect) => {
    const pg = getState().project.pages.find((p) => p.id === pageId);
    const a = pg && getImage(pg.mediaId);
    if (!a) return;
    const c = document.createElement('canvas');
    const k = Math.min(1, 1200 / Math.max(rect.w, rect.h));
    c.width = Math.round(rect.w * k); c.height = Math.round(rect.h * k);
    c.getContext('2d')!.drawImage(a.img, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
    void readLines(pg!.mediaId, a.img, a.width, a.height).catch(() => null).then(() => put(c, 'Case du comics', panelFocus(a.img, rect), lettering(pg!.mediaId, rect, undefined, k)));
  };

  const searchWeb = () => {
    const q = (query || title).trim();
    window.open(`https://www.google.com/search?tbm=isch&tbs=ic:trans&q=${encodeURIComponent(q + ' png')}`, '_blank', 'noopener');
  };

  const save = () => render().toBlob((bl) => bl && download(bl, `miniature-${(title || 'forge').toLowerCase().replace(/[^a-z0-9]+/gi, '-')}.png`), 'image/png');

  return (
    <div className="ts">
      <div className="ts-preview" onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')); if (f) void fromBlob(f, f.name); }}>
        <canvas ref={preview} width={fmt === "tiktok" ? 270 : 640} height={fmt === "tiktok" ? 480 : 360} key={fmt} />
        {busy && <div className="ts-busy"><Loader2 size={18} className="spin" /> {busy}</div>}
      </div>

      <div className="seg full" role="radiogroup" aria-label="Format de la miniature">
        <button role="radio" aria-checked={fmt === 'tiktok'} className={fmt === 'tiktok' ? 'on' : ''} onClick={() => setFmt('tiktok')}>TikTok · 9:16</button>
        <button role="radio" aria-checked={fmt === 'youtube'} className={fmt === 'youtube' ? 'on' : ''} onClick={() => setFmt('youtube')}>YouTube · 16:9</button>
      </div>
      <div className="seg full" role="radiogroup" aria-label="Couleurs">
        {(Object.keys(THUMB_PALETTES) as ThumbPalette[]).map((k) => <button key={k} role="radio" aria-checked={palette === k} className={palette === k ? 'on' : ''} onClick={() => setPalette(k)}>{THUMB_PALETTES[k].label}</button>)}
      </div>
      <label className="check-row"><input type="checkbox" checked={logo} onChange={(e) => setLogo(e.target.checked)} /> Ajouter le logo de la chaîne</label>
      <input className="input ts-title" value={title} maxLength={22} placeholder="Titre (1 ou 2 mots)" onChange={(e) => setTitle(e.target.value)} aria-label="Titre de la miniature" />

      <div className="ts-slots">
        {slots.map((s, i) => (
          <button key={i} className={`ts-slot ${target === i ? 'on' : ''}`} onClick={() => setTarget(i)} title="Cliquer pour remplir cet emplacement">
            {s ? (
              <>
                <img src={s.sticker.toDataURL()} alt="" />
                <span className="ts-x" role="button" aria-label="Retirer" onClick={(e) => { e.stopPropagation(); setSlots((x) => x.map((y, j) => (j === i ? null : y))); }}><X size={12} /></span>
              </>
            ) : <span>{i === 0 ? 'Personnage 1' : 'Personnage 2 (option)'}</span>}
          </button>
        ))}
      </div>

      <div className="ts-add">
        <div className="ts-search">
          <input className="input" placeholder="Ex. : Black Panther" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && searchWeb()} aria-label="Personnage à chercher" />
          <button className="btn sm" onClick={searchWeb}><Search size={14} /> Chercher un PNG</button>
        </div>
        <p className="help"><Clipboard size={12} /> Sur Google Images : clic droit sur l’image → <b>Copier l’image</b>, puis <b>Ctrl+V</b> ici. Ou glisse un fichier sur l’aperçu.</p>
        <div className="row-btns gap">
          <button className="btn sm ghost" onClick={() => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => i.files?.[0] && void fromBlob(i.files[0], i.files[0].name); i.click(); }}><ImagePlus size={14} /> Fichier</button>
          <button className="btn sm" disabled={!!busy} onClick={() => void autoCover()}>Choix auto</button>
          <button className="btn sm ghost" onClick={() => setPicking(!picking)}>Prendre une case</button>
          <div className="seg sm">
            {([['auto', 'Auto'], ['right', 'Droite'], ['solo', 'Centre'], ['duo', 'Duo']] as const).map(([k, l]) => (
              <button key={k} className={layout === k ? 'on' : ''} onClick={() => setLayout(k)}>{l}</button>
            ))}
          </div>
        </div>
        {picking && <PanelPicker onClose={() => setPicking(false)} onPick={fromPanel} />}
      </div>

      <button className="btn primary lg" onClick={save} disabled={!chars.length || !!busy}><Download size={16} /> Télécharger la miniature</button>
    </div>
  );
}
