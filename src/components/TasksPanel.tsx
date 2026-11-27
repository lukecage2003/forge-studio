import { useEffect, useState, useSyncExternalStore } from 'react';
import { X, Pause, Play, Square, RotateCcw, ArrowUp, Download, CheckCircle2, AlertTriangle, Loader2, Clock, Ban, CircleDot, Trash2 } from 'lucide-react';
import { setUI, useStore } from '../store';
import type { TaskRecord, TaskState } from '../engine/queue';
import { budget } from '../engine/resources';
import { queue } from '../production/orchestrator';
import { renders } from '../production/kinds';
import { download } from '../engine/export';
import { toast } from './Toast';

const STATE: Record<TaskState, { label: string; icon: typeof Loader2; tone: string }> = {
  waiting: { label: 'En attente', icon: Clock, tone: 'muted' },
  queued: { label: 'Prévue', icon: CircleDot, tone: 'muted' },
  running: { label: 'En cours', icon: Loader2, tone: 'run' },
  paused: { label: 'En pause', icon: Pause, tone: 'warn' },
  retrying: { label: 'Nouvel essai', icon: Clock, tone: 'warn' },
  done: { label: 'Terminée', icon: CheckCircle2, tone: 'ok' },
  failed: { label: 'Échec', icon: AlertTriangle, tone: 'err' },
  cancelled: { label: 'Annulée', icon: Ban, tone: 'muted' },
  stale: { label: 'Obsolète', icon: AlertTriangle, tone: 'warn' },
};
const MODE: Record<string, string> = { normal: 'Pleine vitesse', interface: 'Priorité à l’interface', economie: 'Économie de batterie', memoire: 'Mémoire limitée' };

let version = 0;
queue.subscribe(() => { version++; });
const useQueue = () => useSyncExternalStore((f) => queue.subscribe(f), () => version);

/** number of unfinished tasks of the open project, for the top bar badge */
export function useActiveTasks() {
  useQueue();
  const pid = useStore((s) => s.project.id);
  return queue.active(pid).length;
}

export function TasksPanel() {
  useQueue();
  const pid = useStore((s) => s.project.id);
  const [b, setB] = useState(budget());
  useEffect(() => { const t = setInterval(() => setB(budget()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setUI({ tasksOpen: false }); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  const mine = queue.tasks.filter((t) => t.projectId === pid);
  const active = mine.filter((t) => ['running', 'paused', 'retrying', 'queued', 'waiting', 'stale'].includes(t.state)).sort((a, x) => order(a) - order(x) || x.priority - a.priority);
  const done = mine.filter((t) => ['done', 'failed', 'cancelled'].includes(t.state)).sort((a, x) => (x.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, 40);
  const others = queue.tasks.filter((t) => t.projectId !== pid && ['queued', 'waiting', 'paused', 'retrying'].includes(t.state)).length;
  return (
    <aside className="tasks-panel" role="dialog" aria-labelledby="tasks-title">
      <header className="tasks-head">
        <div><h2 id="tasks-title">File de tâches</h2><p className="help">{MODE[b.mode]} · {b.reason}</p></div>
        <button className="icon-btn ghost" onClick={() => setUI({ tasksOpen: false })} aria-label="Fermer"><X size={18} /></button>
      </header>
      <div className="tasks-tools">
        <button className="btn sm" onClick={() => queue.pauseAll(!queue.pausedAll)}>{queue.pausedAll ? <><Play size={13} /> Tout reprendre</> : <><Pause size={13} /> Tout mettre en pause</>}</button>
        <button className="btn sm ghost" disabled={!done.length} onClick={() => queue.clearFinished(pid)}><Trash2 size={13} /> Effacer les terminées</button>
      </div>
      {queue.pausedAll && <p className="tasks-note">File en pause : aucune nouvelle tâche ne démarre. Celles en cours s’arrêtent à leur prochain point d’arrêt si tu les mets en pause.</p>}
      {others > 0 && <p className="tasks-note">{others} tâche{others > 1 ? 's' : ''} d’autres projets reprendr{others > 1 ? 'ont' : 'a'} quand tu les rouvriras.</p>}
      <ul className="tasks-list">
        {active.map((t) => <Row key={t.id} t={t} />)}
        {!active.length && <li className="tasks-empty">Rien en cours.</li>}
      </ul>
      {done.length > 0 && <><h3 className="tasks-sub">Terminées</h3><ul className="tasks-list">{done.map((t) => <Row key={t.id} t={t} />)}</ul></>}
    </aside>
  );
}
const order = (t: TaskRecord) => ({ running: 0, paused: 1, retrying: 2, stale: 3, queued: 4, waiting: 5 } as Record<string, number>)[t.state] ?? 9;

function Row({ t }: { t: TaskRecord }) {
  const s = STATE[t.state];
  const Icon = s.icon;
  const pct = Math.round(t.progress * 100);
  const r = t.kind === 'render' ? (t.result as { file?: string; size?: number; saved?: boolean } | undefined) : undefined;
  const save = async () => {
    let blob = renders.get(t.id) ?? null;
    if (!blob && r?.file) { const { workspace } = await import('../lib/studio'); blob = (await workspace()?.getExport(r.file)) ?? null; }
    if (blob) download(blob, r?.file ?? 'forge.mp4'); else toast('Fichier introuvable : relance le rendu', 'error');
  };
  return (
    <li className={`task t-${s.tone}`}>
      <div className="task-top">
        <Icon size={14} className={t.state === 'running' ? 'spin' : ''} aria-hidden />
        <b className="task-label">{t.label}</b>
        <span className={`task-state t-${s.tone}`}>{s.label}</span>
      </div>
      {(t.state === 'running' || t.state === 'paused') && <div className="task-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></div>}
      {(t.note || t.error) && <p className="task-note">{t.error && t.state !== 'done' ? `${t.note ? t.note + ' : ' : ''}${t.error.message}` : t.note}</p>}
      {t.state === 'done' && t.ms != null && t.ms > 1500 && <p className="task-note">{(t.ms / 1000).toFixed(1)} s{t.interrupted ? ' · reprise après interruption' : t.attempts > 1 ? ` · ${t.attempts} essais` : ''}</p>}
      <div className="task-actions">
        {(t.state === 'running' || t.state === 'queued' || t.state === 'waiting' || t.state === 'retrying') && <button className="btn sm ghost" onClick={() => queue.pause(t.id)}><Pause size={12} /> Pause</button>}
        {t.state === 'paused' && <button className="btn sm" onClick={() => queue.resume(t.id)}><Play size={12} /> Reprendre</button>}
        {(t.state === 'queued' || t.state === 'waiting') && <button className="btn sm ghost" onClick={() => queue.setPriority(t.id, t.priority + 100)}><ArrowUp size={12} /> Passer devant</button>}
        {['running', 'paused', 'queued', 'waiting', 'retrying'].includes(t.state) && <button className="btn sm ghost" onClick={() => queue.cancel(t.id)}><Square size={12} /> Annuler</button>}
        {(t.state === 'failed' || t.state === 'cancelled') && <button className="btn sm" onClick={() => queue.retry(t.id)}><RotateCcw size={12} /> Relancer cette étape</button>}
        {t.state === 'stale' && <>
          <button className="btn sm" onClick={() => { queue.applyStale(t.id); toast('Résultat appliqué (Ctrl+Z pour annuler)'); }}>Appliquer quand même</button>
          <button className="btn sm ghost" onClick={() => queue.retry(t.id)}><RotateCcw size={12} /> Recalculer</button>
          <button className="btn sm ghost" onClick={() => queue.cancel(t.id)}>Ignorer</button>
        </>}
        {t.state === 'done' && r && <button className="btn sm primary" onClick={() => void save()}><Download size={12} /> Télécharger{r.size ? ` (${(r.size / 1e6).toFixed(1)} Mo)` : ''}</button>}
        {t.state === 'done' && r?.saved && <span className="task-note">aussi dans le dossier « exports »</span>}
      </div>
    </li>
  );
}
