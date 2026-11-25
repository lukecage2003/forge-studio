import { useState } from 'react';
import { X, Crown, Download, Loader2, Wand2, ImagePlus } from 'lucide-react';
import { getState, setUI, update, useStore } from '../store';
import { brandOf, cutoutQuality, drawThumbnail, sticker, trimAlpha, type ThumbLayout } from '../engine/brand';
import { cutoutOf, depthCutout, hasWebGPU } from '../engine/vision';
import { getImage } from '../engine/media';
import { download } from '../engine/export';
import { PanelPicker } from './FxDiagram';
import { toast } from './Toast';
import { arollPlayer } from '../engine/video';
import { loadSegmenter, magicTouchCutout, personMask } from '../engine/segment';
import { panelFocus } from '../engine/auto';
import type { Rect } from '../types';

type Pick = { pageId: string; rect: Rect } | null;

export function ChannelModal() {
  const project = useStore((s) => s.project);
  const b = brandOf(project);
  const set = (patch: Partial<typeof b>) => update((p) => ({ ...p, brand: { ...p.brand, ...patch } }));
  const [title, setTitle] = useState(project.name && project.name !== 'Sans titre' ? project.name : 'L’espoir');
  const [a, setA] = useState<Pick>(null);
  const [c, setC] = useState<Pick>(null);
  const [picking, setPicking] = useState<'a' | 'c' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<{ layout: ThumbLayout; url: string; blob: Blob }[]>([]);
  const close = () => setUI({ channelOpen: false });

  const cut = async (pk: Pick, strict = false, minQ = 0.75) => {
    if (!pk) return null;
    const pg = getState().project.pages.find((x) => x.id === pk.pageId);
    const im = pg && getImage(pg.mediaId);
    if (!im) return null;
    // precise cut-out (BiRefNet): fast on the graphics card, slower on the processor; depth-based cut-out as last resort
    let out: HTMLCanvasElement | null = null;
    if (await hasWebGPU()) {
      try {
        out = await Promise.race([
          cutoutOf(im.img, pk.rect, (p) => setBusy(`Modèle de détourage… ${Math.round(p * 100)} %`)),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('lent')), 180000)),
        ]);
      } catch { out = null; }
    }
    if (!out) {
      // Magic Touch on the panel's point of interest (fast on any processor)
      setBusy('Détourage Magic Touch…');
      try { out = await magicTouchCutout(im.img, pk.rect, panelFocus(im.img, pk.rect)); } catch { out = null; }
    }
    if (!out && strict) return null;
    if (!out) out = await depthCutout(im.img, pk.rect, (p) => setBusy(`Modèle de profondeur… ${Math.round(p * 100)} %`));
    // scan-site banners at the very bottom of the page never go on a thumbnail
    const k = out.width / pk.rect.w;
    const cutY = (im.height * 0.955 - pk.rect.y) * k;
    if (cutY < out.height) out.getContext('2d')!.clearRect(0, cutY, out.width, out.height - cutY);
    const t = trimAlpha(out);
    if (strict && cutoutQuality(t) < minQ) return null; // messy cut-out: try another panel
    return sticker(t, Math.max(6, Math.max(t.width, t.height) * 0.014));
  };

  const faceCut = async () => {
    const ar = getState().project.aroll;
    const frame = ar && arollPlayer.frame(ar.mediaId);
    if (!frame) return null;
    await loadSegmenter();
    const m = personMask(frame);
    if (!m) return null;
    const cv = document.createElement('canvas');
    cv.width = ar!.width; cv.height = ar!.height;
    const x = cv.getContext('2d')!;
    x.drawImage(frame, 0, 0, cv.width, cv.height);
    x.globalCompositeOperation = 'destination-in';
    x.drawImage(m, 0, 0, cv.width, cv.height);
    const t = trimAlpha(cv);
    return sticker(t, Math.max(6, t.height * 0.012));
  };

  const generate = async () => {
    setBusy('Détourage des personnages…');
    try {
      // your picks are used as they are; otherwise Forge tries the best panels until two cut out cleanly
      let sa = a ? await cut(a) : null, sc = c ? await cut(c) : null;
      if (!sa) {
        const used = new Set<string>();
        for (const cand of rankedPanels()) {
          if (sa || used.size >= 10) break;
          const key = cand.pageId + cand.rect.x + ':' + cand.rect.y;
          if (used.has(key)) continue;
          used.add(key);
          setBusy(`Recherche du meilleur personnage (${used.size})…`);
          const st = await cut(cand, true);
          if (!st) continue;
          sa = st;
        }
      }
      const variants: { layout: ThumbLayout; a: HTMLCanvasElement | null; c: HTMLCanvasElement | null }[] = [
        ...(sc ? [{ layout: 'duo' as ThumbLayout, a: sa, c: sc }] : [{ layout: 'right' as ThumbLayout, a: sa, c: null }]),
        { layout: 'solo', a: sa, c: null },
      ];
      if (getState().project.aroll) {
        setBusy('Détourage de ton visage…');
        const f = await faceCut();
        if (f) variants.push({ layout: 'face', a: f, c: sa });
      } else if (sc) variants.push({ layout: 'solo', a: sc, c: null });
      const out = [];
      for (const v of variants) {
        const cv = drawThumbnail(b, title, v.layout, v.a, v.c);
        const blob = await new Promise<Blob>((r) => cv.toBlob((x) => r(x!), 'image/png'));
        out.push({ layout: v.layout, url: URL.createObjectURL(blob), blob });
      }
      setThumbs(out);
    } catch (e) {
      toast('Miniature : ' + (e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const uploadLogo = () => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*';
    i.onchange = () => {
      const f = i.files?.[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => set({ logo: r.result as string });
      r.readAsDataURL(f);
    };
    i.click();
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="modal channel-modal" role="dialog" aria-labelledby="ch-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><Crown size={18} /></span>
            <div><h2 id="ch-title">Ma chaîne</h2><p>Ton identité visuelle, appliquée à l’intro, aux chapitres, à l’écran de fin et aux miniatures.</p></div>
          </div>
          <button className="icon-btn ghost" onClick={close} aria-label="Fermer"><X size={18} /></button>
        </header>

        <section className="set-section">
          <div className="brand-row">
            <img src={b.logo} alt="Logo de la chaîne" className="brand-logo" />
            <div className="brand-fields">
              <label className="color-row"><input type="color" value={b.bg} onChange={(e) => set({ bg: e.target.value })} /><span>Fond · {b.bg}</span></label>
              <label className="color-row"><input type="color" value={b.ink} onChange={(e) => set({ ink: e.target.value })} /><span>Titres · {b.ink}</span></label>
              <div className="row-btns gap">
                <button className="btn sm ghost" onClick={uploadLogo}><ImagePlus size={14} /> Mon logo</button>
                <button className="link-btn" onClick={() => set({ logo: 'channel-logo.svg' })}>Logo Forge par défaut</button>
              </div>
            </div>
          </div>
          <label className="toggle"><input type="checkbox" checked={b.intro} onChange={(e) => set({ intro: e.target.checked })} /><span className="switch" /><span>Intro logo (1,2 s) au début de chaque vidéo</span></label>
          <label className="toggle"><input type="checkbox" checked={b.outro} onChange={(e) => set({ outro: e.target.checked })} /><span className="switch" /><span>Écran de fin YouTube (10 s, emplacements pour tes vidéos)<small>Uniquement en 16:9</small></span></label>
          <p className="help">Avant chaque numéro, un carton de chapitre aux couleurs de la chaîne est ajouté par le montage auto.</p>
        </section>

        <section className="set-section">
          <h3><Wand2 size={15} /> Miniature YouTube</h3>
          <div className="field">
            <label htmlFor="th-title">Titre</label>
            <input id="th-title" className="input" value={title} maxLength={24} onChange={(e) => setTitle(e.target.value)} />
            <p className="help">Un ou deux mots marchent le mieux. Forge choisit seul le personnage principal ; choisis un second personnage pour la version duo.</p>
          </div>
          <div className="pick-row">
            {(['a', 'c'] as const).map((k) => {
              const v = k === 'a' ? a : c;
              return (
                <button key={k} className="pick-slot" onClick={() => setPicking(k)} title="Choisir la case du personnage">
                  {v ? <SlotThumb v={v} /> : <span>Auto<br />(ou choisir)</span>}
                </button>
              );
            })}
          </div>
          {picking && <PanelPicker onClose={() => setPicking(null)} onPick={(pageId, rect) => (picking === 'a' ? setA({ pageId, rect }) : setC({ pageId, rect }))} />}
          <button className="btn primary" onClick={generate} disabled={!!busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} />} {busy ?? 'Créer les miniatures'}
          </button>
          {thumbs.length > 0 && (
            <div className="thumbs">
              {thumbs.map((t, i) => (
                <figure key={i}>
                  <img src={t.url} alt={`Miniature ${i + 1}`} />
                  <button className="btn sm" onClick={() => download(t.blob, `miniature-${i + 1}.png`)}><Download size={14} /> PNG</button>
                </figure>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function SlotThumb({ v }: { v: { pageId: string; rect: Rect } }) {
  const pg = useStore((s) => s.project.pages.find((p) => p.id === v.pageId));
  const im = pg && getImage(pg.mediaId);
  if (!pg || !im) return null;
  const k = 90 / v.rect.h;
  return <div className="crop" style={{ width: Math.min(v.rect.w * k, 140), height: 90, backgroundImage: `url(${im.url})`, backgroundSize: `${pg.width * k}px ${pg.height * k}px`, backgroundPosition: `${-v.rect.x * k}px ${-v.rect.y * k}px` }} />;
}

/** candidate character panels, best first */
function rankedPanels(): { pageId: string; rect: Rect }[] {
  const p = getState().project;
  // full-figure characters live in big, rather tall panels; close-ups (wide strips) make poor stickers
  const score = (s: (typeof p.shots)[number]) => {
    const pg = p.pages.find((x) => x.id === s.pageId);
    const area = pg ? (s.rect.w * s.rect.h) / (pg.width * pg.height) : 0;
    const tall = Math.min(2, Math.max(0.4, s.rect.h / s.rect.w));
    const cover = pg?.kind === 'cover' || pg?.kind === 'variant' || pg?.kind === 'splash' ? 1.4 : 1;
    // a box covering much of a page usually holds several panels: poor sticker
    const crowded = area > 0.4 && pg?.kind !== 'cover' && pg?.kind !== 'variant' ? 0.3 : 1;
    return area * tall * cover * crowded * (1 + 0.2 * (s.chars?.length ?? 0));
  };
  const list = p.shots.filter((s) => s.pageId && !s.zone).sort((x, y) => score(y) - score(x));
  return list.map((s) => ({ pageId: s.pageId!, rect: s.rect }));
}
