import { useEffect, useRef, useState } from 'react';
import { Download, ImagePlus, Loader2, Search, X, Clipboard } from 'lucide-react';
import { getState } from '../store';
import { brandOf, drawThumbnail, sticker, trimAlpha, THUMB_PALETTES, type ThumbLayout, type ThumbPalette } from '../engine/brand';
import { getImage, onMediaChange } from '../engine/media';
import { download } from '../lib/util';
import { magicTouchCutout } from '../engine/segment';
import { cutoutOf, hasWebGPU } from '../engine/vision';
import { panelFocus } from '../engine/auto';
import { PanelPicker } from './FxDiagram';
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

/** transparent PNGs are used as they are; anything else gets its background removed */
async function toSticker(src: HTMLCanvasElement, focus = { x: 0.5, y: 0.45 }): Promise<HTMLCanvasElement> {
  let cut: HTMLCanvasElement | null = hasAlpha(src) ? src : null;
  const r = { x: 0, y: 0, w: src.width, h: src.height };
  if (!cut && (await hasWebGPU())) { try { cut = await cutoutOf(src, r); } catch { cut = null; } }
  if (!cut) { try { cut = await magicTouchCutout(src, r, focus); } catch { cut = null; } }
  const t = trimAlpha(cut ?? src);
  return sticker(t, Math.max(6, Math.max(t.width, t.height) * 0.014));
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

  const put = async (src: HTMLCanvasElement, label: string, focus?: { x: number; y: number }) => {
    setBusy('Détourage…');
    try {
      const st = await toSticker(src, focus);
      setSlots((s) => s.map((x, i) => (i === target ? { sticker: st, label } : x)));
      setTarget((t) => (t === 0 ? 1 : t));
    } catch (e) {
      toast('Image : ' + (e as Error).message, 'error');
    } finally { setBusy(null); }
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
    void put(c, 'Case du comics', panelFocus(a.img, rect));
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
