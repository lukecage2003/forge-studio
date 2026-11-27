import { useState } from 'react';
import { Trash2, Layers } from 'lucide-react';
import type { Overlay, OverlayPlace } from '../types';
import { deleteSelection, patchOverlay, OVERLAY_TRACKS } from '../actions';
import { PLACE_FR } from '../engine/overlays';
import { Slider } from './Slider';
import { PanelPicker } from './FxDiagram';
import { seek } from '../engine/transport';

/** inspector of a picture on an overlay track: track, place, timing, push-in, fade */
export function OverlayPanel({ o }: { o: Overlay }) {
  const [pick, setPick] = useState(false);
  const k = (f: string) => `${o.id}-${f}`;
  const what = o.source.kind === 'panel' ? 'Case' : o.source.kind === 'image' ? 'Image' : 'Vidéo';
  const maxD = o.source.kind === 'video' ? Math.max(0.3, o.source.sourceDuration - o.source.offset) : 60;
  return (
    <>
      <div className="insp-title">
        <div><span className="eyebrow"><Layers size={12} /> Calque superposé · piste {o.track}</span><h2>{o.source.kind === 'panel' ? what : o.source.name ?? what}</h2></div>
        <button className="icon-btn ghost danger" title="Supprimer (Suppr)" onClick={deleteSelection}><Trash2 size={16} /></button>
      </div>
      <p className="help">Posée au-dessus de la piste principale, sans la modifier. La piste la plus haute passe devant.{o.source.kind === 'video' ? ' Une vidéo en superposition est muette : le son vient des pistes voix et musique.' : ''}</p>
      <section className="insp-section">
        <div className="insp-head"><h3>Piste</h3></div>
        <div className="seg full" role="radiogroup" aria-label="Piste">
          {Array.from({ length: OVERLAY_TRACKS }, (_, i) => i + 1).map((n) => <button key={n} role="radio" aria-checked={o.track === n} className={o.track === n ? 'on' : ''} onClick={() => patchOverlay(o.id, { track: n })}>{n}</button>)}
        </div>
        <div className="insp-head"><h3>Placement</h3></div>
        <div className="seg full wrap" role="radiogroup" aria-label="Placement">
          {(Object.keys(PLACE_FR) as OverlayPlace[]).map((p) => <button key={p} role="radio" aria-checked={o.place === p} className={o.place === p ? 'on' : ''} onClick={() => patchOverlay(o.id, { place: p })}>{PLACE_FR[p]}</button>)}
        </div>
      </section>
      <section className="insp-section">
        <div className="insp-head"><h3>Temps</h3><button className="link-btn" onClick={() => seek(o.start)}>Aller au début</button></div>
        <Slider label="Début" value={o.start} min={0} max={Math.max(o.start + 10, 60)} step={0.1} fmt={(v) => v.toFixed(1) + ' s'} onChange={(v) => patchOverlay(o.id, { start: v }, k('s'))} />
        <Slider label="Durée" value={o.duration} min={0.3} max={maxD} step={0.1} fmt={(v) => v.toFixed(1) + ' s'} onChange={(v) => patchOverlay(o.id, { duration: v }, k('d'))} />
        {o.source.kind === 'video' && (
          <Slider label="Départ dans la vidéo" value={o.source.offset} min={0} max={Math.max(0, o.source.sourceDuration - 0.3)} step={0.1} fmt={(v) => v.toFixed(1) + ' s'}
            onChange={(v) => { if (o.source.kind !== 'video') return; patchOverlay(o.id, { source: { ...o.source, offset: v }, duration: Math.min(o.duration, o.source.sourceDuration - v) }, k('o')); }} />
        )}
        <Slider label="Fondu" value={o.fade} min={0} max={1.5} step={0.05} fmt={(v) => (v ? v.toFixed(2) + ' s' : 'aucun')} onChange={(v) => patchOverlay(o.id, { fade: v }, k('f'))} />
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
