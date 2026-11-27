import { useMemo, useState } from 'react';
import { Check, ScrollText, X, AlertTriangle, CalendarClock, Network, Swords, BarChart3, Quote, Type, Map } from 'lucide-react';
import { getState, setUI, update, useStore } from '../store';
import { analyseScript, KIND_FR, ROLE_FR, type Role, type SuggestionKind } from '../engine/scriptIntel';
import { acceptSuggestion } from '../actions';
import { toast } from './Toast';
import { aiReviewScript, roleLabel, type AiAnalysis, type ReviewNote } from '../ai/tasks';
import { INFO } from '../ai/providers';
import { Bot, Loader2 } from 'lucide-react';
import type { Suggestion } from '../engine/scriptIntel';

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
  const [ai, setAi] = useState<{ data: AiAnalysis; by: string } | null>(null);
  const [rev, setRev] = useState<{ notes: ReviewNote[]; verdict: string; by: string } | null>(null);
  const [busyAi, setBusyAi] = useState<string | null>(null);
  const by = (r: { provider: keyof typeof INFO; model: string }) => (r.provider === 'local' ? 'analyse locale de Forge (aucune IA distante disponible)' : `${INFO[r.provider].label} · ${r.model}`);
  const runAi = async (what: 'analyse' | 'review') => {
    setBusyAi(what);
    try {
      if (what === 'analyse') {
        // a production task: shown in the queue, retried on network errors and quotas, same script = no second call
        const { runTask, scriptHash } = await import('../production/kinds');
        const t = await runTask('script.analyse', { hash: scriptHash() }, false);
        if (t.state !== 'done') throw new Error(t.error?.message ?? 'Analyse interrompue');
        const r = t.result as { data: Parameters<typeof setAi>[0] extends infer A ? A extends { data: infer D } ? D : never : never; via: { provider: keyof typeof INFO; model: string } };
        setAi({ data: r.data, by: by(r.via) });
      }
      else { const r = await aiReviewScript(getState().project); setRev({ notes: r.notes, verdict: r.verdict, by: by(r.via) }); }
    } catch (e) { toast((e as Error).message, 'error'); }
    setBusyAi(null);
  };
  /** AI visuals become ordinary suggestions (accepted the same way) */
  const aiSuggestions: Suggestion[] = (ai?.data.visuels ?? []).filter((v) => ['chronologie', 'reseau', 'versus', 'echelle', 'citation', 'titre'].includes(v.type)).map((v, k) => ({
    id: `ai${k}`, kind: v.type as Suggestion['kind'], passages: [v.de], at: a.passages[v.de]?.s ?? 0, title: v.titre || v.type, detail: v.raison ?? '',
    items: (v.elements ?? []).filter((e) => e && e.label).map((e) => ({ label: e.label, sub: e.detail })),
    needs: v.type === 'citation' ? 'Vérifie la source exacte (numéro, page) avant de publier.' : undefined,
  }));
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
          <div className="field">
            <label>IA (selon le centre de contrôle : gratuite, locale ou désactivée)</label>
            <div className="row-btns gap">
              <button className="btn sm" disabled={!!busyAi} onClick={() => void runAi('analyse')}>{busyAi === 'analyse' ? <Loader2 size={14} className="spin" /> : <Bot size={14} />} Analyse approfondie</button>
              <button className="btn sm" disabled={!!busyAi} onClick={() => void runAi('review')}>{busyAi === 'review' ? <Loader2 size={14} className="spin" /> : <Bot size={14} />} Deuxième lecture éditoriale</button>
            </div>
            {rev && (
              <div className="sg-list">
                <p className="muted">{rev.verdict} · par {rev.by}</p>
                {rev.notes.map((n, k) => (
                  <div key={k} className="sg"><Bot size={15} /><div className="sg-body"><strong>{n.constat}</strong><span>{n.conseil}</span>{n.i >= 0 && a.passages[n.i] && <span className="muted">« {a.passages[n.i].text.slice(0, 90)} »</span>}</div></div>
                ))}
              </div>
            )}
            {ai && (
              <div className="sg-list">
                <p className="muted">Analyse approfondie par {ai.by} : {ai.data.passages.length} passages, {ai.data.entites.length} entités, {aiSuggestions.length} visuels proposés.</p>
                {ai.data.rythme.map((r, k) => <div key={'r' + k} className="sg"><Bot size={15} /><div className="sg-body"><strong>{r.note}</strong>{a.passages[r.i] && <span className="muted">« {a.passages[r.i].text.slice(0, 90)} »</span>}</div></div>)}
                {ai.data.passages.filter((x) => a.passages[x.i] && a.passages[x.i].role !== x.role).slice(0, 8).map((x, k) => (
                  <div key={'p' + k} className="sg"><Bot size={15} /><div className="sg-body"><strong>Passage {x.i + 1} : {roleLabel(x.role)} plutôt que {roleLabel(a.passages[x.i].role)}</strong>{x.illustration && <span>À montrer : {x.illustration}</span>}</div></div>
                ))}
                {aiSuggestions.map((g) => {
                  const st = done[g.id];
                  return (
                    <div key={g.id} className={`sg ${st ?? ''}`}>
                      <Bot size={17} />
                      <div className="sg-body"><strong>{KIND_LABEL[g.kind]} · {g.title}</strong><span>{g.detail}</span><span className="sg-items">{g.items.map((it) => it.label).join(' · ')}</span>{g.needs && <span className="sg-needs"><AlertTriangle size={12} /> {g.needs}</span>}</div>
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
            )}
          </div>
        )}

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
