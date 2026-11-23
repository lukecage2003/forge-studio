import { useState } from 'react';
import { Wand2, X, Zap, Film, BookOpen, Loader2 } from 'lucide-react';
import { autoMontage, STYLES, type AutoLength, type AutoStyle } from '../engine/auto';
import { getState, setUI, update, useStore } from '../store';
import { toast } from './Toast';
import { FORMATS } from '../types';

const ICONS = { dynamic: Zap, cinematic: Film, manga: BookOpen };
const LENGTHS: { v: AutoLength; l: string }[] = [
  { v: 'auto', l: 'Auto' }, { v: 'voice', l: 'Suivre la voix' }, { v: 15, l: '15 s' }, { v: 30, l: '30 s' },
  { v: 60, l: '60 s' }, { v: 90, l: '90 s' }, { v: 180, l: '3 min' },
];

export function AutoModal({ onClose }: { onClose: () => void }) {
  const format = useStore((s) => s.project.format);
  const hasVoice = useStore((s) => s.project.audio.some((a) => a.kind === 'voice'));
  const hasMusic = useStore((s) => s.project.audio.some((a) => a.kind === 'music'));
  const pages = useStore((s) => s.project.pages.length);
  const [style, setStyle] = useState<AutoStyle>(format === '16:9' ? 'cinematic' : 'dynamic');
  const [length, setLength] = useState<AutoLength>(hasVoice ? 'voice' : 'auto');
  const [hook, setHook] = useState('');
  const [redetect, setRedetect] = useState(false);
  const [beatSync, setBeatSync] = useState(true);
  const [captionStyle, setCaptionStyle] = useState(true);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const { project, report } = await autoMontage(getState().project, { style, length, hook, redetect, beatSync, captionStyle });
      update(() => project);
      setUI({ mode: 'preview', playhead: 0, selection: null });
      const bits = [`${report.shots} cases`, `${report.duration.toFixed(1)} s`];
      if (report.bpm) bits.push(`calé sur ${report.bpm} BPM`);
      if (report.followedVoice) bits.push('suit la voix off');
      toast('Montage prêt : ' + bits.join(' · '));
      report.notes.forEach((n) => toast(n));
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal auto-modal" role="dialog" aria-labelledby="auto-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><Wand2 size={18} /></span>
            <div>
              <h2 id="auto-title">Montage automatique</h2>
              <p>Forge découpe, cadre, rythme et mixe ta vidéo {FORMATS[format].label} tout seul. Tout reste modifiable ensuite.</p>
            </div>
          </div>
          <button className="icon-btn ghost" onClick={onClose} disabled={busy} aria-label="Fermer"><X size={18} /></button>
        </header>

        <div className="field">
          <label>Style</label>
          <div className="style-cards">
            {(Object.keys(STYLES) as AutoStyle[]).map((k) => {
              const I = ICONS[k];
              return (
                <button key={k} className={`style-card ${style === k ? 'on' : ''}`} onClick={() => setStyle(k)}>
                  <I size={20} />
                  <strong>{STYLES[k].label}</strong>
                  <span>{STYLES[k].desc}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <label>Durée</label>
          <div className="chips">
            {LENGTHS.map(({ v, l }) => (
              <button key={String(v)} className={`chip ${length === v ? 'on' : ''}`} disabled={v === 'voice' && !hasVoice}
                title={v === 'voice' && !hasVoice ? 'Ajoute une voix off d’abord' : undefined} onClick={() => setLength(v)}>{l}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="hook">Accroche d’ouverture <span className="opt">optionnel</span></label>
          <input id="hook" className="input" placeholder="Ex. : Le jour où Batman a tout perdu…" value={hook} onChange={(e) => setHook(e.target.value)} maxLength={90} />
          <p className="help">Un carton plein écran pendant les 2 premières secondes, pour retenir le spectateur.</p>
        </div>

        <div className="toggles">
          <Toggle on={beatSync} set={setBeatSync} disabled={!hasMusic} label="Couper sur le beat de la musique" hint={hasMusic ? undefined : 'Ajoute une musique pour l’activer'} />
          <Toggle on={captionStyle} set={setCaptionStyle} label="Appliquer le style de sous-titres du preset" />
          <Toggle on={redetect} set={setRedetect} label="Re-détecter toutes les cases" hint="Sinon, tes découpes manuelles sont conservées" />
        </div>

        <footer className="modal-foot">
          <span className="muted">{pages} planche{pages > 1 ? 's' : ''}{hasVoice ? ' · voix off' : ''}{hasMusic ? ' · musique' : ''}</span>
          <button className="btn primary lg" onClick={run} disabled={busy || !pages}>
            {busy ? <Loader2 size={17} className="spin" /> : <Wand2 size={17} />} {busy ? 'Montage en cours…' : 'Lancer le montage'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Toggle({ on, set, label, hint, disabled }: { on: boolean; set: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={on && !disabled} disabled={disabled} onChange={(e) => set(e.target.checked)} />
      <span className="switch" />
      <span>{label}{hint && <small>{hint}</small>}</span>
    </label>
  );
}
