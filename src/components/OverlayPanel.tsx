import { useState } from 'react';
import { Trash2, Layers } from 'lucide-react';
import type { Overlay, OverlayEnter, OverlayPlace } from '../types';
import { FORMATS } from '../types';
import { deleteSelection, patchOverlay, setOverlaySound, OVERLAY_TRACKS } from '../actions';
import { setUI, useStore } from '../store';
import { getImage } from '../engine/media';
import { PLACE_FR, ENTER_FR, bestPlace } from '../engine/overlays';
import { Slider } from './Slider';
import { PanelPicker } from './FxDiagram';
import { seek } from '../engine/transport';

/** inspector of a picture on an overlay track: track, place, timing, push-in, fade */
export function OverlayPanel({ o }: { o: Overlay }) {
  const [pick, setPick] = useState(false);
  const k = (f: string) => `${o.id}-${f}`;
  const what = o.source.kind === 'panel' ? 'Case' : o.source.kind === 'image' ? 'Image' : 'Vidéo';
  const fmt = useStore((s) => FORMATS[s.project.format]);
  const hasSound = useStore((s) => !!o.soundClip && s.project.audio.some((c) => c.id === o.soundClip));
  const editEnd = useStore((s) => !!s.ui.overlayEditEnd);
  const dims = o.source.kind === 'panel' ? [o.source.rect.w, o.source.rect.h] : o.source.kind === 'image' ? [getImage(o.source.mediaId)?.width ?? 1, getImage(o.source.mediaId)?.height ?? 1] : [o.source.width, o.source.height];
  const advised = bestPlace(dims[0], dims[1], fmt.w, fmt.h);
  const maxD = o.source.kind === 'video' ? Math.max(0.3, o.source.sourceDuration - o.source.offset) : 60;
  return (
    <>
      <div className="insp-title">
        <div><span className="eyebrow"><Layers size={12} /> Calque superposé · piste {o.track}</span><h2>{o.source.kind === 'panel' ? what : o.source.name ?? what}</h2></div>
        <button className="icon-btn ghost danger" title="Supprimer (Suppr)" onClick={deleteSelection}><Trash2 size={16} /></button>
      </div>
      {o.auto && o.why && <p className="help why">Montage automatique : {o.why}</p>}
      <p className="help">Posée au-dessus de la piste principale, sans la modifier. La piste la plus haute passe devant.{o.source.kind === 'video' ? '' : ''}</p>
      <section className="insp-section">
        <div className="insp-head"><h3>Piste</h3></div>
        <div className="seg full" role="radiogroup" aria-label="Piste">
          {Array.from({ length: OVERLAY_TRACKS }, (_, i) => i + 1).map((n) => <button key={n} role="radio" aria-checked={o.track === n} className={o.track === n ? 'on' : ''} onClick={() => patchOverlay(o.id, { track: n })}>{n}</button>)}
        </div>
        <div className="insp-head"><h3>Placement</h3></div>
        <div className="seg full wrap" role="radiogroup" aria-label="Placement">
          {(Object.keys(PLACE_FR) as OverlayPlace[]).filter((p) => p !== 'free' || o.box).map((p) => <button key={p} role="radio" aria-checked={o.place === p} className={o.place === p ? 'on' : ''} onClick={() => patchOverlay(o.id, { place: p })}>{PLACE_FR[p]}</button>)}
        </div>
        {o.place === 'pip' && (
          <div className="seg full wrap" role="radiogroup" aria-label="Position de l’incrustation">
            {([['tl', '↖ Haut G'], ['tr', 'Haut D ↗'], ['ml', '← Milieu G'], ['mr', 'Milieu D →'], ['bl', '↙ Bas G'], ['br', 'Bas D ↘']] as const).map(([c, l]) => <button key={c} role="radio" aria-checked={(o.corner ?? 'tr') === c} className={(o.corner ?? 'tr') === c ? 'on' : ''} onClick={() => patchOverlay(o.id, { corner: c })}>{l}</button>)}
          </div>
        )}
        {o.place === 'pip' && <Slider label="Taille" value={o.size ?? 1} min={0.6} max={1.6} step={0.05} fmt={(v) => Math.round(v * 100) + ' %'} onChange={(v) => patchOverlay(o.id, { size: v }, k('sz'))} />}
        {(o.place === 'top' || o.place === 'bottom' || o.place === 'left' || o.place === 'right') && (
          <label className="check-row"><input type="checkbox" checked={o.split !== false} onChange={(e) => patchOverlay(o.id, { split: e.target.checked })} /> Écran partagé : la case principale se range dans l’autre moitié</label>
        )}
        {o.place !== advised && o.source.kind !== 'video' && <button className="btn sm ghost wrap-btn" onClick={() => patchOverlay(o.id, { place: advised })}>Placement conseillé pour cette forme : {PLACE_FR[advised]}</button>}
        <p className="help">Dans l’aperçu, glisse le cadre pour le placer librement ; le coin en bas à droite change sa taille.</p>
        {o.place === 'free' && (
          <div className="row-gap">
            <button className={`btn sm ${editEnd ? 'primary' : ''}`} onClick={() => { if (!o.boxEnd) patchOverlay(o.id, { boxEnd: o.box }); setUI({ overlayEditEnd: !editEnd }); }}>{editEnd ? 'Je règle la position de fin' : 'Faire bouger : régler la fin'}</button>
            {o.boxEnd && <button className="btn sm ghost" onClick={() => { patchOverlay(o.id, { boxEnd: undefined }); setUI({ overlayEditEnd: false }); }}>Sans mouvement</button>}
          </div>
        )}
        <div className="insp-head"><h3>Entrée et sortie</h3></div>
        <div className="seg full" role="radiogroup" aria-label="Entrée et sortie">
          {(Object.keys(ENTER_FR) as OverlayEnter[]).map((e) => <button key={e} role="radio" aria-checked={(o.enter ?? 'fade') === e} className={(o.enter ?? 'fade') === e ? 'on' : ''} onClick={() => patchOverlay(o.id, { enter: e, fade: o.fade || 0.3 })}>{ENTER_FR[e]}</button>)}
        </div>
        {o.source.kind === 'video' && (
          <label className="check-row"><input type="checkbox" checked={hasSound} onChange={(e) => setOverlaySound(o.id, e.target.checked)} /> Garder le son de la vidéo (piste Bruitages, suit le calque)</label>
        )}
      </section>
      <section className="insp-section">
        <div className="insp-head"><h3>Temps</h3><button className="link-btn" onClick={() => seek(o.start)}>Aller au début</button></div>
        <Slider label="Début" value={o.start} min={0} max={Math.max(o.start + 10, 60)} step={0.1} fmt={(v) => v.toFixed(1) + ' s'} onChange={(v) => patchOverlay(o.id, { start: v }, k('s'))} />
        <Slider label="Durée" value={o.duration} min={0.3} max={maxD} step={0.1} fmt={(v) => v.toFixed(1) + ' s'} onChange={(v) => patchOverlay(o.id, { duration: v }, k('d'))} />
        {o.source.kind === 'video' && (
          <Slider label="Départ dans la vidéo" value={o.source.offset} min={0} max={Math.max(0, o.source.sourceDuration - 0.3)} step={0.1} fmt={(v) => v.toFixed(1) + ' s'}
            onChange={(v) => { if (o.source.kind !== 'video') return; patchOverlay(o.id, { source: { ...o.source, offset: v }, duration: Math.min(o.duration, o.source.sourceDuration - v) }, k('o')); }} />
        )}
        <Slider label="Durée d’entrée et de sortie" value={o.fade} min={0} max={1.5} step={0.05} fmt={(v) => (v ? v.toFixed(2) + ' s' : 'aucun')} onChange={(v) => patchOverlay(o.id, { fade: v }, k('f'))} />
        {o.source.kind !== 'video' && <Slider label="Zoom lent" value={o.zoom} min={0} max={1} step={0.05} fmt={(v) => (v ? Math.round(v * 8) + ' %' : 'fixe')} onChange={(v) => patchOverlay(o.id, { zoom: v }, k('z'))} />}
      </section>
      {o.source.kind === 'panel' && (
        <section className="insp-section">
          <div className="insp-head"><h3>Case</h3><button className="link-btn" onClick={() => setPick(!pick)}>Changer</button></div>
          {pick && <PanelPicker onClose={() => setPick(false)} onPick={(pageId, rect) => patchOverlay(o.id, { source: { kind: 'panel', pageId, rect } })} />}
        </section>
      )}
    </>
  );
}
