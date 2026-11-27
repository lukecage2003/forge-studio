import { PLACE_FR } from '../engine/overlays';
import { addOverlay } from '../actions';
import { useEffect, useState } from 'react';
import { MessageSquareText, X, Loader2, Check, Lightbulb, Send } from 'lucide-react';
import { useStore, getState, setUI, update } from '../store';
import { aiAssistant, type Proposal } from '../ai/tasks';
import { INFO } from '../ai/providers';
import { addFx, addTitleCard, acceptSuggestion } from '../actions';
import { addManualCut } from '../rush';
import { seek } from '../engine/transport';
import { toast } from './Toast';
import type { Transition } from '../types';

const QUICK = ['Analyse cette vidéo', 'Trouve les passages trop longs', 'Propose un montage plus dynamique', 'Identifie les moments où je dois afficher une image', 'Prépare les sous-titres', 'Vérifie la cohérence de mon script', 'Propose une meilleure introduction'];

/** what a proposal changes, said plainly */
function describe(p: Proposal): string {
  const shot = 'shotId' in p ? getState().project.shots.find((s) => s.id === p.shotId) : null;
  const where = shot ? `le plan ${getState().project.shots.indexOf(shot) + 1}` : '';
  switch (p.type) {
    case 'shot.duration': return `Mettre ${where} à ${p.seconds.toFixed(1)} s (au lieu de ${shot?.duration.toFixed(1)} s)`;
    case 'shot.transition': return `Transition de ${where} : ${p.transition}`;
    case 'title.add': return `Mot-clé « ${p.text} » à ${p.at.toFixed(1)} s`;
    case 'visual.suggest': return `${p.kind === 'chronologie' ? 'Frise' : p.kind === 'reseau' ? 'Carte des relations' : p.kind === 'versus' ? 'Duel' : p.kind === 'echelle' ? 'Échelle' : 'Citation'} « ${p.title} » à ${p.at.toFixed(1)} s (${p.items.map((i) => i.label).join(', ')})`;
    case 'rush.cut': return `Couper le rush de ${p.s.toFixed(2)} à ${p.e.toFixed(2)} s`;
    case 'note': return p.text;
    case 'overlay.add': return `Calque ${PLACE_FR[p.place].toLowerCase()} à ${p.at.toFixed(1)} s pendant ${p.duration.toFixed(1)} s`;
  }
}

/** apply one accepted proposal (each one is a single undo step) */
function apply(p: Proposal) {
  switch (p.type) {
    case 'shot.duration': update((x) => ({ ...x, shots: x.shots.map((s) => (s.id === p.shotId ? { ...s, duration: p.seconds, transitionDur: Math.min(s.transitionDur, p.seconds * 0.45) } : s)) })); break;
    case 'shot.transition': update((x) => ({ ...x, shots: x.shots.map((s) => (s.id === p.shotId ? { ...s, transition: p.transition as Transition, transitionDur: p.transition === 'cut' ? 0 : Math.max(s.transitionDur, 0.4), tp: undefined } : s)) })); break;
    case 'title.add': if (getState().project.aroll) addFx('callout', { start: p.at, duration: 1.4, text: p.text.toUpperCase() }); else { setUI({ playhead: p.at }); addTitleCard(p.text.toUpperCase()); } break;
    case 'visual.suggest': acceptSuggestion({ id: 'as' + Date.now(), kind: p.kind as 'chronologie', passages: [], title: p.title, detail: p.raison ?? '', items: p.items, at: p.at }); break;
    case 'rush.cut': addManualCut(p.s, p.e, 'assistant'); break;
    case 'note': break;
    case 'overlay.add': addOverlay({ kind: 'panel', pageId: p.pageId, rect: p.rect }, { start: p.at, duration: p.duration, place: p.place, enter: p.place === 'pip' ? 'pop' : 'slide', fade: 0.35 }); break;
  }
}

export function AssistantModal() {
  const [cmd, setCmd] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ resume: string; proposals: Proposal[]; by: string; sent?: string } | null>(null);
  const [done, setDone] = useState<Record<number, 'ok' | 'no'>>({});
  const close = () => setUI({ assistantOpen: false });
  const ask = async (c: string) => {
    if (!c.trim()) return;
    setBusy(true); setRes(null); setDone({});
    try {
      const r = await aiAssistant(c, getState().project);
      setRes({ resume: r.resume, proposals: r.proposals, by: r.via.provider === 'local' ? 'assistant hors ligne de Forge' : `${INFO[r.via.provider].label} · ${r.via.model}`,
        sent: r.via.provider === 'local' ? undefined : `Envoyé à l’IA : ${r.context.kept.join(', ') || 'durée et format'} — ${r.context.chars.toLocaleString('fr-FR')} caractères${r.context.chars < r.context.fullChars ? ` au lieu de ${r.context.fullChars.toLocaleString('fr-FR')}` : ''}.` });
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusy(false);
  };
  // opened by a command with a request: run it at once
  const pending = useStore((s) => s.ui.assistantAsk);
  useEffect(() => { if (pending) { setCmd(pending); setUI({ assistantAsk: undefined }); void ask(pending); } }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal assistant-modal" role="dialog" aria-labelledby="as-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><MessageSquareText size={18} /></span>
            <div><h2 id="as-title">Assistant de montage</h2><p>Il propose, tu valides chaque changement. Tout s’annule avec Ctrl+Z.</p></div>
          </div>
          <button className="icon-btn ghost" onClick={close} aria-label="Fermer"><X size={18} /></button>
        </header>
        <div className="chips">{QUICK.map((q) => <button key={q} className="chip" disabled={busy} onClick={() => { setCmd(q); void ask(q); }}>{q}</button>)}</div>
        <div className="key-row">
          <input className="input" value={cmd} placeholder="Ta demande…" onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void ask(cmd)} aria-label="Demande à l’assistant" />
          <button className="btn primary" onClick={() => void ask(cmd)} disabled={busy || !cmd.trim()}>{busy ? <Loader2 size={15} className="spin" /> : <Send size={15} />}</button>
        </div>
        {res && (
          <div className="sg-list">
            <p className="muted">{res.resume || `${res.proposals.length} proposition(s)`} · par {res.by}</p>
            {res.sent && <p className="help">{res.sent}</p>}
            {!res.proposals.length && <p className="muted">Aucune proposition applicable.</p>}
            {res.proposals.map((p, i) => (
              <div key={i} className={`sg ${done[i] ?? ''}`}>
                {p.type === 'note' ? <Lightbulb size={16} /> : <Check size={16} />}
                <div className="sg-body">
                  <strong>{describe(p)}</strong>
                  {'raison' in p && p.raison && <span>{p.raison}</span>}
                </div>
                {p.type === 'note' ? null : done[i] ? <span className="muted">{done[i] === 'ok' ? 'Appliqué' : 'Refusé'}</span> : (
                  <div className="sg-btns">
                    {'at' in p && <button className="btn sm ghost" onClick={() => seek(p.at)}>Voir</button>}
                    <button className="btn sm primary" onClick={() => { apply(p); setDone({ ...done, [i]: 'ok' }); }}>Appliquer</button>
                    <button className="btn sm ghost" onClick={() => setDone({ ...done, [i]: 'no' })}>Refuser</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
