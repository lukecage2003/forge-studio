import { useEffect, useMemo, useState } from 'react';
import { Bot, X, KeyRound, Trash2, Loader2, CheckCircle2, XCircle, ExternalLink, ShieldCheck, ArrowUp, ArrowDown, Eraser } from 'lucide-react';
import { setUI } from '../store';
import { DEFAULT_ROUTES, getConfig, onConfig, setConfig } from '../ai/config';
import { INFO, PROVIDERS } from '../ai/providers';
import { catalogueDate, isZero, modelsOf } from '../ai/models';
import { masked, setKey, removeKey, hasKey } from '../ai/vault';
import { clearCache, clearHistory, cooling, getHistory, onHistory, usageNow } from '../ai/ledger';
import { plan, testProvider } from '../ai/orchestrator';
import type { Mode, ProviderId, TaskKind } from '../ai/types';

const TASK_FR: Record<TaskKind, string> = {
  'script.analyse': 'Analyse du script', 'script.review': 'Deuxième lecture éditoriale', 'audio.transcribe': 'Transcription',
  'captions.punctuate': 'Ponctuation des sous-titres', assistant: 'Assistant de montage', classify: 'Classification légère',
  'connection.test': 'Test', 'gemini.feature': 'Fonctions Gemini de Forge',
};
const TASKS: TaskKind[] = ['script.analyse', 'script.review', 'audio.transcribe', 'captions.punctuate', 'assistant', 'classify'];
const MODE: Record<Mode, { l: string; d: string }> = {
  zero: { l: 'Zéro coût', d: 'IA locale, offres gratuites et modèles au prix 0 vérifié uniquement. Tout appel payant est refusé avant l’envoi.' },
  balanced: { l: 'Équilibré', d: 'Le gratuit d’abord ; les crédits d’essai et le payant seulement sous ton plafond mensuel.' },
  quality: { l: 'Qualité', d: 'Le meilleur modèle pour la tâche, payant seulement chez les fournisseurs que tu as autorisés, sous ton plafond.' },
};

function useTick() {
  const [, b] = useState(0);
  useEffect(() => { const u1 = onConfig(() => b((x) => x + 1)); const u2 = onHistory(() => b((x) => x + 1)); return () => { u1(); u2(); }; }, []);
  return () => b((x) => x + 1);
}

/** Forge AI Control Center: providers, keys, models, routing, costs, privacy, history */
export function AiCenter() {
  const [tab, setTab] = useState<'dash' | 'prov' | 'route' | 'hist' | 'priv'>('dash');
  const bump = useTick();
  const c = getConfig();
  const close = () => setUI({ aiOpen: false });
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal ai-center" role="dialog" aria-labelledby="ai-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><Bot size={18} /></span>
            <div><h2 id="ai-title">Centre de contrôle IA</h2><p>Mode {MODE[c.mode].l}{c.localOnly ? ' · local uniquement' : ''} · les abonnements ChatGPT, Gemini et Claude ne donnent pas d’accès API.</p></div>
          </div>
          <button className="icon-btn ghost" onClick={close} aria-label="Fermer"><X size={18} /></button>
        </header>
        <div className="seg full ai-tabs">
          {([['dash', 'Tableau de bord'], ['prov', 'Fournisseurs'], ['route', 'Routage'], ['priv', 'Coûts et confidentialité'], ['hist', 'Historique']] as const).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        {tab === 'dash' && <Dashboard />}
        {tab === 'prov' && <Providers onChange={bump} />}
        {tab === 'route' && <Routes />}
        {tab === 'priv' && <Privacy />}
        {tab === 'hist' && <History />}
      </div>
    </div>
  );
}

function state(p: ProviderId): { cls: string; text: string } {
  const c = getConfig().providers[p];
  if (!c.enabled) return { cls: 'off', text: 'désactivé' };
  if (INFO[p].needsKey && !hasKey(p)) return { cls: 'off', text: 'sans clé' };
  if (!INFO[p].direct && !getConfig().bridge.token) return { cls: 'off', text: 'Bridge requis' };
  const cd = cooling(p);
  if (cd) return { cls: 'warn', text: cd.why === 'auth' ? 'clé refusée' : `en pause (${cd.why})` };
  return { cls: 'ok', text: 'prêt' };
}

function Dashboard() {
  const u = usageNow();
  const c = getConfig();
  const ready = PROVIDERS.filter((p) => state(p.id).cls === 'ok');
  return (
    <div className="ai-body">
      <div className="kpi-row">
        <div className="kpi"><b>{ready.length}</b><span>IA prêtes</span></div>
        <div className="kpi"><b>{Object.values(u.calls).reduce((a, b) => a + b, 0)}</b><span>appels aujourd’hui</span></div>
        <div className="kpi"><b>{u.cost.toFixed(2)} $</b><span>coût estimé du mois{c.mode !== 'zero' ? ` / ${c.budget} $` : ''}</span></div>
        <div className="kpi"><b>{MODE[c.mode].l}</b><span>mode</span></div>
      </div>
      <table className="ai-table">
        <thead><tr><th>Fournisseur</th><th>État</th><th>Modèles</th><th>Appels (jour / mois)</th></tr></thead>
        <tbody>
          {PROVIDERS.map((p) => {
            const st = state(p.id);
            return (
              <tr key={p.id}>
                <td><b>{p.label}</b><small>{p.role}</small></td>
                <td><span className={`dot ${st.cls}`} /> {st.text}</td>
                <td>{modelsOf(p.id).length || '—'}{p.id === 'openrouter' && modelsOf(p.id).length ? ` (${modelsOf(p.id).filter(isZero).length} gratuits)` : ''}</td>
                <td>{u.calls[p.id] ?? 0} / {u.monthCalls[p.id] ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="help">Quotas : Forge compte ses propres appels et respecte les limites renvoyées par chaque service (attente imposée après un « trop de requêtes »). Les quotas gratuits changent : vérifie-les dans la console de chaque fournisseur.</p>
    </div>
  );
}

function Providers({ onChange }: { onChange: () => void }) {
  const c = getConfig();
  const [draft, setDraft] = useState<Partial<Record<ProviderId, string>>>({});
  const [test, setTest] = useState<Partial<Record<ProviderId, { busy?: boolean; ok?: boolean; msg?: string }>>>({});
  const setP = (id: ProviderId, patch: Partial<typeof c.providers.local>) => setConfig((x) => ({ ...x, providers: { ...x.providers, [id]: { ...x.providers[id], ...patch } } }));
  const runTest = async (id: ProviderId) => {
    setTest((t) => ({ ...t, [id]: { busy: true } }));
    const r = await testProvider(id);
    setTest((t) => ({ ...t, [id]: { ok: r.ok, msg: r.message } }));
    onChange();
  };
  return (
    <div className="ai-body prov-list">
      {PROVIDERS.filter((p) => p.id !== 'local').map((p) => {
        const s = c.providers[p.id];
        const models = modelsOf(p.id);
        const t = test[p.id];
        return (
          <div key={p.id} className={`prov ${s.enabled ? '' : 'disabled'}`}>
            <div className="prov-head">
              <label className="toggle">
                <input type="checkbox" checked={s.enabled} onChange={(e) => setP(p.id, { enabled: e.target.checked })} />
                <span className="switch" /><span><b>{p.label}</b><small>{p.role}</small></span>
              </label>
              <span className={`dot ${state(p.id).cls}`} title={state(p.id).text} />
            </div>
            <p className="help">{p.free} {p.site && <a href={p.site} target="_blank" rel="noreferrer">Site <ExternalLink size={11} /></a>}</p>
            {p.needsKey && (
              <div className="key-row">
                {hasKey(p.id) ? (
                  <>
                    <span className="key-masked"><KeyRound size={13} /> {masked(p.id)}</span>
                    <button className="btn sm ghost" onClick={() => { void removeKey(p.id).then(onChange); }}><Trash2 size={13} /> Supprimer la clé</button>
                  </>
                ) : (
                  <>
                    <input className="input sm" type="password" autoComplete="off" spellCheck={false} placeholder="Colle ta clé API" value={draft[p.id] ?? ''} onChange={(e) => setDraft({ ...draft, [p.id]: e.target.value })} />
                    <button className="btn sm primary" disabled={!draft[p.id]?.trim()} onClick={() => { void setKey(p.id, draft[p.id]!).then(() => { setDraft({ ...draft, [p.id]: '' }); onChange(); }); }}>Enregistrer</button>
                    {p.keyUrl && <a className="btn sm ghost" href={p.keyUrl} target="_blank" rel="noreferrer">Créer une clé <ExternalLink size={11} /></a>}
                  </>
                )}
              </div>
            )}
            {(p.id === 'ollama' || p.id === 'lmstudio') && (
              <input className="input sm" value={s.baseUrl ?? ''} onChange={(e) => setP(p.id, { baseUrl: e.target.value.trim() })} placeholder="http://localhost:11434" aria-label="Adresse du serveur local" />
            )}
            {!p.direct && <p className="help">Nécessite Forge Bridge (onglet Coûts et confidentialité).</p>}
            <div className="row-btns gap">
              <button className="btn sm" onClick={() => void runTest(p.id)} disabled={t?.busy}>{t?.busy ? <Loader2 size={13} className="spin" /> : null} Tester la connexion</button>
              {t && !t.busy && <span className={t.ok ? 'ok-text' : 'err-text'}>{t.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {t.msg}</span>}
            </div>
            <div className="two-col">
              <div className="field">
                <label>Compte</label>
                <select className="input sm" value={s.billing} onChange={(e) => setP(p.id, { billing: e.target.value as typeof s.billing })}>
                  <option value="free-tier">Offre gratuite, sans facturation</option>
                  <option value="free-model">Modèles gratuits seulement</option>
                  <option value="trial">Crédits d’essai</option>
                  <option value="paid">Payant (facturation activée)</option>
                  <option value="local">Local</option>
                </select>
              </div>
              <div className="field">
                <label>Modèle{catalogueDate(p.id) ? ` · catalogue du ${new Date(catalogueDate(p.id)!).toLocaleDateString('fr-FR')}` : ''}</label>
                <select className="input sm" value={s.model ?? ''} onChange={(e) => setP(p.id, { model: e.target.value || undefined })}>
                  <option value="">Automatique{p.hint ? ` (${p.hint})` : ''}</option>
                  {models.filter((m) => !m.caps.includes('transcribe')).map((m) => <option key={m.id} value={m.id}>{m.id}{isZero(m) ? ' · gratuit' : m.price ? ' · payant' : ''}</option>)}
                </select>
              </div>
            </div>
            {models.some((m) => m.caps.includes('transcribe')) && (
              <div className="field">
                <label>Modèle de transcription</label>
                <select className="input sm" value={s.transcribeModel ?? ''} onChange={(e) => setP(p.id, { transcribeModel: e.target.value || undefined })}>
                  <option value="">Automatique</option>
                  {models.filter((m) => m.caps.includes('transcribe')).map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                </select>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Routes() {
  const c = getConfig();
  const move = (k: TaskKind, i: number, d: number) => setConfig((x) => {
    const r = [...(x.routes[k] ?? DEFAULT_ROUTES[k])];
    const j = i + d;
    if (j < 0 || j >= r.length) return x;
    [r[i], r[j]] = [r[j], r[i]];
    return { ...x, routes: { ...x.routes, [k]: r } };
  });
  return (
    <div className="ai-body">
      <p className="help">Pour chaque tâche, Forge essaie les fournisseurs dans cet ordre et passe au suivant en cas de panne, de quota ou de refus. Ceux qui ne peuvent pas faire la tâche (pas de clé, mode Zéro coût, capacité absente) sont sautés, avec la raison. L’IA locale de Forge est toujours le dernier recours.</p>
      {TASKS.map((k) => {
        const p = plan({ kind: k, needs: k === 'audio.transcribe' ? ['transcribe'] : ['text', 'json'], data: [k === 'audio.transcribe' ? 'audio' : 'texte'], local: async () => ({ text: '' }) });
        const order = c.routes[k] ?? DEFAULT_ROUTES[k];
        return (
          <div key={k} className="route">
            <div className="route-head"><b>{TASK_FR[k]}</b>{c.routes[k] && <button className="link-btn" onClick={() => setConfig((x) => { const r = { ...x.routes }; delete r[k]; return { ...x, routes: r }; })}>Ordre par défaut</button>}</div>
            <ol>
              {order.map((id, i) => {
                const st = p.find((x) => x.provider === id);
                return (
                  <li key={id} className={st?.skip ? 'skip' : 'go'}>
                    <span>{INFO[id].label}</span>
                    <small>{st?.skip ?? (st?.model ? st.model.id : '')}</small>
                    <span className="route-btns">
                      <button className="icon-btn sm ghost" onClick={() => move(k, i, -1)} disabled={!i} aria-label="Monter"><ArrowUp size={12} /></button>
                      <button className="icon-btn sm ghost" onClick={() => move(k, i, 1)} disabled={i === order.length - 1} aria-label="Descendre"><ArrowDown size={12} /></button>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        );
      })}
    </div>
  );
}

function Privacy() {
  const c = getConfig();
  return (
    <div className="ai-body">
      <div className="field">
        <label>Mode</label>
        <div className="seg full">{(Object.keys(MODE) as Mode[]).map((m) => <button key={m} className={c.mode === m ? 'on' : ''} onClick={() => setConfig({ mode: m })}>{MODE[m].l}</button>)}</div>
        <p className="help">{MODE[c.mode].d}</p>
      </div>
      {c.mode !== 'zero' && (
        <div className="field">
          <label htmlFor="ai-budget">Plafond mensuel des appels payants (USD)</label>
          <input id="ai-budget" className="input sm" type="number" min={0} step={1} value={c.budget} onChange={(e) => setConfig({ budget: Math.max(0, Number(e.target.value) || 0) })} />
        </div>
      )}
      <label className="toggle">
        <input type="checkbox" checked={c.localOnly} onChange={(e) => setConfig({ localOnly: e.target.checked })} />
        <span className="switch" /><span><ShieldCheck size={13} /> Local uniquement<small>Rien ne sort de l’ordinateur : script, voix et images restent ici. Pour les contenus sensibles.</small></span>
      </label>
      <div className="field">
        <label>Envois déjà autorisés</label>
        {Object.entries(c.consent).filter(([, v]) => v?.length).length ? (
          <ul className="consents">
            {Object.entries(c.consent).filter(([, v]) => v?.length).map(([p, v]) => (
              <li key={p}>{INFO[p as ProviderId].label} : {v!.join(', ')} <button className="link-btn" onClick={() => setConfig((x) => ({ ...x, consent: { ...x.consent, [p]: [] } }))}>Retirer</button></li>
            ))}
          </ul>
        ) : <p className="muted">Aucun : Forge demandera avant le premier envoi à chaque service.</p>}
      </div>
      <div className="field">
        <label>Forge Bridge (facultatif)</label>
        <p className="help">Petit programme à lancer sur ton ordinateur (dossier <code>bridge/</code> du projet). Il garde les clés dans le coffre de Windows ou de Linux et donne accès à Cloudflare, NVIDIA et whisper.cpp, que le navigateur ne peut pas appeler directement.</p>
        <div className="two-col">
          <input className="input sm" value={c.bridge.url} onChange={(e) => setConfig({ bridge: { ...c.bridge, url: e.target.value.trim() } })} aria-label="Adresse du Bridge" />
          <input className="input sm" type="password" placeholder="Code d’appairage affiché par le Bridge" value={c.bridge.token} onChange={(e) => setConfig({ bridge: { ...c.bridge, token: e.target.value.trim() } })} aria-label="Code d’appairage" />
        </div>
      </div>
      <div className="row-btns gap">
        <button className="btn sm ghost" onClick={clearCache}><Eraser size={13} /> Vider le cache des réponses</button>
      </div>
    </div>
  );
}

function History() {
  const h = useMemo(() => getHistory(), [getHistory().length]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ai-body">
      <div className="row-btns gap"><span className="muted">{h.length} traitement(s) récents · jamais de clé ni de contenu dans l’historique.</span><button className="link-btn" onClick={clearHistory}>Effacer</button></div>
      <table className="ai-table">
        <thead><tr><th>Quand</th><th>Tâche</th><th>IA · modèle</th><th>Résultat</th><th>Envoyé</th></tr></thead>
        <tbody>
          {h.slice(0, 100).map((e, i) => (
            <tr key={i}>
              <td>{new Date(e.t).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
              <td>{TASK_FR[e.task] ?? e.task}</td>
              <td>{INFO[e.provider].label}<small>{e.model}</small></td>
              <td className={e.ok ? 'ok-text' : 'err-text'}>{e.ok ? (e.cached ? 'cache' : `OK · ${(e.ms / 1000).toFixed(1)} s`) : `${e.error} · ${e.message ?? ''}`}</td>
              <td>{e.sent.length ? e.sent.join(', ') : 'rien'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
