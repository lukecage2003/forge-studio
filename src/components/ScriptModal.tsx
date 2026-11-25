import { useMemo, useState } from 'react';
import { Check, ScrollText, X, AlertTriangle, CalendarClock, Network, Swords, BarChart3, Quote, Type, Map } from 'lucide-react';
import { getState, setUI, update, useStore } from '../store';
import { analyseScript, KIND_FR, ROLE_FR, type Role, type SuggestionKind } from '../engine/scriptIntel';
import { acceptSuggestion } from '../actions';
import { toast } from './Toast';

const ICON: Record<SuggestionKind, typeof Check> = { chronologie: CalendarClock, reseau: Network, versus: Swords, echelle: BarChart3, citation: Quote, titre: Type, carte: Map };
const KIND_LABEL: Record<SuggestionKind, string> = { chronologie: 'Frise chronologique', reseau: 'Carte des relations', versus: 'Duel', echelle: 'Échelle', citation: 'Citation', titre: 'Mot-clé en grand', carte: 'Lieux' };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * Script Intelligence: what the narration says, passage by passage, and the
 * visuals Forge proposes for it. Nothing is added until the user accepts.
 */
export function ScriptModal() {
  const script = useStore((s) => s.project.script ?? '');
  const sig = useStore((s) => `${s.project.aroll?.words.length ?? 0}:${s.project.audio.map((a) => a.words?.length ?? 0).join(',')}:${s.project.shots.length}`);
  const [draft, setDraft] = useState(script);
  const [done, setDone] = useState<Record<string, 'ok' | 'no'>>({});
  const a = useMemo(() => analyseScript(getState().project), [script, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => setUI({ scriptOpen: false });
  const counts = a.passages.reduce<Partial<Record<Role, number>>>((m, p) => ((m[p.role] = (m[p.role] ?? 0) + 1), m), {});
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal script-modal" role="dialog" aria-labelledby="sc-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><ScrollText size={18} /></span>
            <div><h2 id="sc-title">Analyse du script</h2><p>{a.source === 'audio' ? 'D’après ta voix transcrite.' : a.source === 'script' ? 'D’après le script collé (minutage estimé).' : 'Colle ton script ou transcris ta voix.'} Rien n’est ajouté sans ton accord.</p></div>
          </div>
          <button className="icon-btn ghost" onClick={close} aria-label="Fermer"><X size={18} /></button>
        </header>

        <div className="field">
          <label htmlFor="sc-text">Script</label>
          <textarea id="sc-text" className="input" rows={4} value={draft} placeholder="Colle le texte de ta vidéo…" onChange={(e) => setDraft(e.target.value)} />
          <div className="row-btns gap">
            <button className="btn sm primary" onClick={() => { update((p) => ({ ...p, script: draft }), 'script'); toast('Script analysé'); }} disabled={draft === script}>Analyser</button>
            {a.source === 'audio' && <span className="muted">La voix transcrite est prioritaire sur le script collé.</span>}
          </div>
        </div>

        {a.passages.length > 0 && (
          <>
            <div className="sc-summary">
              {(Object.keys(counts) as Role[]).map((r) => <span key={r} className={`role-chip r-${r}`}>{ROLE_FR[r]} · {counts[r]}</span>)}
            </div>
            <div className="field">
              <label>Propositions de visuels ({a.suggestions.length})</label>
              {!a.suggestions.length && <p className="muted">Rien à proposer : pas de dates, de comparaison, de citation ni de personnages récurrents.</p>}
              <div className="sg-list">
                {a.suggestions.map((g) => {
                  const I = ICON[g.kind];
                  const st = done[g.id];
                  return (
                    <div key={g.id} className={`sg ${st ?? ''}`}>
                      <I size={17} />
                      <div className="sg-body">
                        <strong>{KIND_LABEL[g.kind]} · {g.title}</strong>
                        <span>{g.detail} <span className="muted">À {mmss(g.at)}.</span></span>
                        <span className="sg-items">{g.items.map((it) => it.label + (it.sub && g.kind !== 'echelle' ? ` (${it.sub})` : '')).join(' · ')}</span>
                        {g.needs && <span className="sg-needs"><AlertTriangle size={12} /> {g.needs}</span>}
                      </div>
                      {st ? <span className="muted">{st === 'ok' ? 'Ajouté' : 'Ignoré'}</span> : (
                        <div className="sg-btns">
                          <button className="btn sm primary" onClick={() => { acceptSuggestion(g, a.passages[g.passages[0]]?.text ?? ''); setDone({ ...done, [g.id]: 'ok' }); }}><Check size={14} /> Accepter</button>
                          <button className="btn sm ghost" onClick={() => setDone({ ...done, [g.id]: 'no' })}>Ignorer</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="field">
              <label>Personnages, lieux, concepts ({a.entities.length})</label>
              <div className="chips">{a.entities.slice(0, 40).map((e) => <span key={e.name} className={`ent-chip k-${e.kind}`} title={KIND_FR[e.kind]}>{e.name}{e.count > 1 ? ` ×${e.count}` : ''}</span>)}</div>
            </div>
            <div className="field">
              <label>Passages</label>
              <ol className="sc-passages">
                {a.passages.map((p) => (
                  <li key={p.i}>
                    <span className={`role-chip r-${p.role}`}>{ROLE_FR[p.role]}</span>
                    <span className="muted">{mmss(p.s)}</span>
                    <span>{p.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
