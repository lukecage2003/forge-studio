import { useCallback, useEffect, useState } from 'react';
import { FolderKanban, X, Plus, Copy, Trash2, FolderOpen, History, HardDrive, ListChecks, Film, RotateCcw, Check, Loader2 } from 'lucide-react';
import { getState, setUI, update, useStore } from '../store';
import type { Project } from '../types';
import { toast } from './Toast';
import type { ProjectMeta, Template, VersionInfo } from '../lib/workspace';
import * as S from '../lib/studio';
import { uid } from '../lib/util';

type Status = NonNullable<Project['production']>['status'];
export const STATUS: { id: Status; label: string }[] = [
  { id: 'idee', label: 'Idée' }, { id: 'script', label: 'Script' }, { id: 'tournage', label: 'Tournage' },
  { id: 'montage', label: 'Montage' }, { id: 'finition', label: 'Finition' }, { id: 'publie', label: 'Publié' },
];
const statusLabel = (s: Status) => STATUS.find((x) => x.id === s)?.label ?? s;
const when = (iso: string) => {
  const d = new Date(iso), mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'à l’instant';
  if (mins < 60) return `il y a ${mins} min`;
  if (mins < 60 * 24) return `il y a ${Math.round(mins / 60)} h`;
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
};

export function ProjectsModal() {
  const [tab, setTab] = useState<'list' | 'this' | 'versions' | 'storage'>('list');
  const close = () => setUI({ projectsOpen: false });
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal projects-modal" role="dialog" aria-labelledby="pj-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><FolderKanban size={18} /></span>
            <div><h2 id="pj-title">Projets</h2><p>Tes vidéos, leur avancement, leurs versions et où elles sont rangées.</p></div>
          </div>
          <button className="icon-btn ghost" onClick={close} aria-label="Fermer"><X size={18} /></button>
        </header>
        <div className="seg pj-tabs" role="tablist">
          {([['list', 'Tous les projets', FolderOpen], ['this', 'Ce projet', ListChecks], ['versions', 'Versions', History], ['storage', 'Stockage', HardDrive]] as const).map(([id, label, Icon]) => (
            <button key={id} role="tab" aria-selected={tab === id} aria-checked={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}><Icon size={14} /> {label}</button>
          ))}
        </div>
        {tab === 'list' && <ListTab onOpened={() => setTab('this')} />}
        {tab === 'this' && <ThisTab />}
        {tab === 'versions' && <VersionsTab />}
        {tab === 'storage' && <StorageTab />}
      </div>
    </div>
  );
}

function useStudio<T>(load: () => Promise<T>, init: T): [T, () => void] {
  const [v, setV] = useState<T>(init);
  const reload = useCallback(() => { void load().then(setV); }, [load]);
  useEffect(() => { reload(); return S.onStudio(reload); }, [reload]);
  return [v, reload];
}

/* ---------------------------------------------------------------- all projects */

function ListTab({ onOpened }: { onOpened: () => void }) {
  const currentId = useStore((s) => s.project.id);
  const where = useStore((s) => s.ui.where);
  const [list] = useStudio(S.listProjects, [] as ProjectMeta[]);
  const [templates] = useStudio(S.listTemplates, [] as Template[]);
  const [name, setName] = useState('');
  const [tpl, setTpl] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (!S.workspace()) return <NoSpace where={where} />;

  const create = async () => {
    setBusy('new');
    await S.createProject(name.trim() || 'Nouveau projet', templates.find((t) => t.id === tpl));
    setName(''); setBusy(null);
    toast('Projet créé'); onOpened();
  };
  const open = async (id: string) => {
    setBusy(id);
    const ok = await S.openProject(id);
    setBusy(null);
    if (ok) { toast(`Projet « ${getState().project.name} » ouvert`); onOpened(); } else toast('Ce projet n’a pas pu être ouvert', 'error');
  };
  return (
    <section className="set-section pj-section">
      <div className="pj-new">
        <input id="pj-new-name" className="input" placeholder="Nom de la nouvelle vidéo" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
        <select id="pj-new-tpl" className="input" value={tpl} onChange={(e) => setTpl(e.target.value)} aria-label="Modèle">
          <option value="">Sans modèle</option>
          {templates.map((t) => <option key={t.id} value={t.id}>Modèle : {t.name}</option>)}
        </select>
        <button className="btn primary" onClick={() => void create()} disabled={busy === 'new'}><Plus size={15} /> Nouveau projet</button>
      </div>
      <p className="help">Le projet ouvert est enregistré avant d’en ouvrir ou d’en créer un autre.</p>
      <ul className="pj-list">
        {list.map((m) => (
          <li key={m.id} className={m.id === currentId ? 'current' : ''}>
            <div className="pj-main">
              <b>{m.name}</b>
              <span className="pj-meta">
                <span className={`pj-status s-${m.status}`}>{statusLabel(m.status)}</span>
                <span>{m.format}</span>
                <span>{m.pages} page{m.pages > 1 ? 's' : ''} · {m.shots} plan{m.shots > 1 ? 's' : ''}</span>
                {m.hasRush && <span title="Face caméra"><Film size={12} /> face caméra</span>}
                {m.tasksOpen + m.tasksDone > 0 && <span>{m.tasksDone}/{m.tasksOpen + m.tasksDone} tâches</span>}
                <span>modifié {when(m.updatedAt)}</span>
              </span>
            </div>
            <div className="pj-actions">
              {m.id === currentId ? <span className="pj-open-tag">Ouvert</span> : <button className="btn sm" onClick={() => void open(m.id)} disabled={!!busy}>{busy === m.id ? <Loader2 size={13} className="spin" /> : 'Ouvrir'}</button>}
              <button className="icon-btn ghost" title="Dupliquer" aria-label={`Dupliquer ${m.name}`} onClick={() => void S.duplicateProject(m.id).then(() => toast('Copie créée'))}><Copy size={15} /></button>
              {m.id !== currentId && (confirmDel === m.id
                ? <span className="pj-confirm">Supprimer définitivement ? <button className="btn sm danger" onClick={() => void S.deleteProject(m.id).then(() => { setConfirmDel(null); toast('Projet supprimé (ses médias restent dans le dossier)'); })}>Supprimer</button><button className="btn sm ghost" onClick={() => setConfirmDel(null)}>Annuler</button></span>
                : <button className="icon-btn ghost" title="Supprimer" aria-label={`Supprimer ${m.name}`} onClick={() => setConfirmDel(m.id)}><Trash2 size={15} /></button>)}
            </div>
          </li>
        ))}
        {!list.length && <li className="pj-empty">Aucun projet enregistré pour l’instant : le projet ouvert le sera à la première modification.</li>}
      </ul>
    </section>
  );
}

function NoSpace({ where }: { where?: string }) {
  return (
    <section className="set-section">
      <p className="help">{where === 'reconnect'
        ? 'Le dossier de projets attend ton autorisation. Va dans l’onglet Stockage et clique sur « Reconnecter le dossier ». En attendant, ton travail est gardé dans le navigateur.'
        : 'Aucun espace de projets disponible dans ce navigateur. Ton travail reste enregistré automatiquement, et tu peux toujours l’exporter en fichier .forge.'}</p>
    </section>
  );
}

/* ---------------------------------------------------------------- this project */

function ThisTab() {
  const prod = useStore((s) => s.project.production);
  const name = useStore((s) => s.project.name);
  const [task, setTask] = useState('');
  const [tplName, setTplName] = useState('');
  const set = (patch: Partial<NonNullable<Project['production']>>, key?: string) =>
    update((p) => ({ ...p, production: { status: 'idee', tasks: [], createdAt: new Date().toISOString(), ...p.production, ...patch } }), key);
  const tasks = prod?.tasks ?? [];
  const status = prod?.status ?? 'idee';
  const add = () => { if (!task.trim()) return; set({ tasks: [...tasks, { id: uid('t_'), text: task.trim(), done: false, phase: status }] }); setTask(''); };
  return (
    <section className="set-section pj-section">
      <h3>{name || 'Sans titre'}</h3>
      <div className="field">
        <label>Avancement</label>
        <div className="pj-steps" role="radiogroup" aria-label="Avancement">
          {STATUS.map((s, i) => (
            <button key={s.id} role="radio" aria-checked={status === s.id} className={`pj-step ${status === s.id ? 'on' : ''} ${STATUS.findIndex((x) => x.id === status) > i ? 'done' : ''}`} onClick={() => set({ status: s.id })}>{s.label}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Tâches</label>
        <ul className="pj-tasks">
          {tasks.map((t) => (
            <li key={t.id} className={t.done ? 'done' : ''}>
              <label><input type="checkbox" checked={t.done} onChange={() => set({ tasks: tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)) })} /> {t.text}</label>
              {t.phase && <span className="pj-phase">{statusLabel(t.phase)}</span>}
              <button className="icon-btn ghost" aria-label={`Retirer ${t.text}`} onClick={() => set({ tasks: tasks.filter((x) => x.id !== t.id) })}><X size={13} /></button>
            </li>
          ))}
        </ul>
        <div className="pj-new">
          <input id="pj-task" className="input" placeholder="Ajouter une tâche" value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
          <button className="btn sm" onClick={add}><Plus size={13} /> Ajouter</button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="pj-notes">Notes de production</label>
        <textarea id="pj-notes" className="input" rows={3} placeholder="Sources, idées d’accroche, numéros à citer…" value={prod?.notes ?? ''} onChange={(e) => set({ notes: e.target.value }, 'prod-notes')} />
      </div>
      <div className="field">
        <label htmlFor="pj-tpl">Modèle</label>
        <p className="help">Garde le format, le style, les sous-titres, le son et la liste de tâches de ce projet pour en démarrer d’autres. Le contenu (pages, rush, script) n’est jamais copié.</p>
        <div className="pj-new">
          <input id="pj-tpl" className="input" placeholder="Nom du modèle" value={tplName} onChange={(e) => setTplName(e.target.value)} />
          <button className="btn sm" disabled={!S.workspace()} onClick={() => void S.saveAsTemplate(tplName.trim() || name || 'Mon modèle').then((t) => { if (t) { toast(`Modèle « ${t.name} » enregistré`); setTplName(''); } })}>Enregistrer comme modèle</button>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- versions */

function VersionsTab() {
  const id = useStore((s) => s.project.id);
  const where = useStore((s) => s.ui.where);
  const load = useCallback(() => S.listVersions(id), [id]);
  const [list] = useStudio(load, [] as VersionInfo[]);
  const [label, setLabel] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const [cmp, setCmp] = useState<{ file: string; lines: { kind: string; text: string }[] } | null>(null);
  const compare = async (file: string) => {
    const v = await S.workspace()?.readVersion(id, file);
    if (!v) return;
    const { compareProjects } = await import('../engine/versionDiff');
    setCmp({ file, lines: compareProjects(v, getState().project) });
  };
  if (!S.workspace()) return <NoSpace where={where} />;
  return (
    <section className="set-section pj-section">
      <p className="help">Forge garde une version toutes les 10 minutes d’édition et avant chaque montage automatique (les 30 dernières). Les versions que tu nommes restent jusqu’à ce que tu les supprimes.</p>
      <div className="pj-new">
        <input id="pj-ver" className="input" placeholder="Nom de la version (ex. : avant le nouveau montage)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="btn sm primary" onClick={() => void S.takeVersion(label.trim() || 'Version manuelle').then(() => { setLabel(''); toast('Version enregistrée'); })}><Plus size={13} /> Créer une version</button>
      </div>
      <ul className="pj-list">
        {list.map((v) => (
          <li key={v.file}>
            <div className="pj-main">
              <b>{v.label}</b>
              <span className="pj-meta"><span>{when(v.at)}</span><span>{v.shots} plan{v.shots > 1 ? 's' : ''}</span>{v.auto && <span className="pj-auto">automatique</span>}</span>
            </div>
            <div className="pj-actions">
              {confirm === v.file
                ? <span className="pj-confirm">Remplacer l’état actuel ? <button className="btn sm primary" onClick={() => void S.restoreVersion(v.file).then((ok) => { setConfirm(null); toast(ok ? 'Version restaurée (l’état précédent est gardé en version)' : 'Restauration impossible', ok ? 'info' : 'error'); })}><Check size={13} /> Restaurer</button><button className="btn sm ghost" onClick={() => setConfirm(null)}>Annuler</button></span>
                : <button className="btn sm" onClick={() => setConfirm(v.file)}><RotateCcw size={13} /> Restaurer</button>}
              <button className="btn sm ghost" onClick={() => (cmp?.file === v.file ? setCmp(null) : void compare(v.file))}>{cmp?.file === v.file ? 'Masquer' : 'Comparer avec maintenant'}</button>
              {!v.auto && <button className="icon-btn ghost" aria-label={`Supprimer la version ${v.label}`} title="Supprimer" onClick={() => void S.deleteVersion(v.file)}><Trash2 size={15} /></button>}
            </div>
            {cmp?.file === v.file && <ul className="pj-diff" aria-label="Différences avec l’état actuel">{cmp.lines.map((l, k) => <li key={k} className={`d-${l.kind}`}>{l.kind === 'add' ? '+ ' : l.kind === 'del' ? '− ' : l.kind === 'mod' ? '~ ' : ''}{l.text}</li>)}</ul>}
          </li>
        ))}
        {!list.length && <li className="pj-empty">Pas encore de version pour ce projet.</li>}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- storage */

function StorageTab() {
  const where = useStore((s) => s.ui.where);
  const whereName = useStore((s) => s.ui.whereName);
  const [busy, setBusy] = useState<string | null>(null);
  const choose = async () => {
    setBusy('Copie des projets…');
    try {
      const r = await S.chooseFolder((d, n) => setBusy(`Copie des projets ${d}/${n}…`));
      if (r) toast(`Dossier choisi${r.copied ? ` : ${r.copied} projet${r.copied > 1 ? 's' : ''} copié${r.copied > 1 ? 's' : ''}` : ''}`);
    } catch (e) { toast(`Dossier inutilisable : ${(e as Error).message}`, 'error'); }
    setBusy(null);
  };
  return (
    <section className="set-section pj-section">
      <div className="pj-where">
        <HardDrive size={18} />
        <div>
          <b>{where === 'folder' ? `Dossier « ${whereName} »` : where === 'reconnect' ? `Dossier « ${whereName} » (accès à redonner)` : where === 'browser' ? 'Dans ce navigateur' : 'Aucun espace'}</b>
          <p className="help">{where === 'folder'
            ? 'Tes projets, leurs versions et leurs médias sont des fichiers dans ce dossier : tu peux le sauvegarder, le copier sur un disque externe ou le synchroniser.'
            : where === 'reconnect'
              ? 'Après un redémarrage, le navigateur demande ton accord pour réutiliser le dossier. Ton travail est gardé dans le navigateur en attendant.'
              : 'Les projets sont rangés dans l’espace privé du navigateur. Choisis un dossier sur ton disque pour de vraies sauvegardes.'}</p>
        </div>
      </div>
      {where === 'reconnect' && <button className="btn primary" onClick={() => void S.reconnectFolder().then((ok) => toast(ok ? 'Dossier reconnecté' : 'Accès refusé', ok ? 'info' : 'error'))}>Reconnecter le dossier</button>}
      {S.canPickFolder()
        ? <button className="btn" onClick={() => void choose()} disabled={!!busy}>{busy ? <><Loader2 size={14} className="spin" /> {busy}</> : <><FolderOpen size={15} /> {where === 'folder' ? 'Choisir un autre dossier…' : 'Choisir un dossier sur mon disque…'}</>}</button>
        : <p className="help">Ce navigateur ne permet pas de choisir un dossier : utilise Chrome ou Edge sur ordinateur.</p>}
      {where === 'folder' && <button className="btn ghost sm" onClick={() => void S.forgetFolder().then(() => toast('Projets de nouveau gardés dans le navigateur (le dossier n’est pas effacé)'))}>Ne plus utiliser ce dossier</button>}
      <p className="help">Les projets déjà présents dans le navigateur sont copiés dans le dossier choisi, jamais déplacés ni effacés. Les médias sont partagés entre projets et ne sont jamais supprimés automatiquement.</p>
      <DiskSpace />
    </section>
  );
}

const mo = (b: number) => (!b ? "0" : b >= 1e9 ? `${(b / 1e9).toFixed(1)} Go` : b >= 1e6 ? `${(b / 1e6).toFixed(1)} Mo` : `${Math.max(1, Math.round(b / 1e3))} Ko`);

/** what takes room, and a cleanup that only moves unused media to a recoverable trash */
function DiskSpace() {
  type U = NonNullable<Awaited<ReturnType<typeof S.diskUsage>>>;
  const [u, setU] = useState<U | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  // measured on demand only: measuring writes the open project first, which would re-trigger a studio listener
  const measure = useCallback(async () => { setBusy('Mesure…'); try { setU(await S.diskUsage()); } finally { setBusy(null); } }, []);
  useEffect(() => { void measure(); }, [measure]);
  const run = async (what: string, f: () => Promise<string>) => { setBusy(what); try { toast(await f()); } catch (e) { toast((e as Error).message, 'error'); } setBusy(null); await measure(); };
  if (!u) return <p className="help">{busy ? <><Loader2 size={13} className="spin" /> Mesure de l’espace…</> : 'Aucun espace de projets.'}</p>;
  const unused = u.unused.reduce((a, m) => a + m.bytes, 0);
  return (
    <div className="pj-disk" aria-label="Espace disque">
      <h4>Espace utilisé</h4>
      <table className="pj-disk-table"><tbody>
        <tr><td>Médias originaux utilisés</td><td>{u.used.count}</td><td>{mo(u.used.bytes)}</td></tr>
        <tr><td>Médias que plus aucun projet ni version n’utilise</td><td>{u.unused.length}</td><td>{mo(unused)}</td></tr>
        <tr><td>Versions des projets</td><td>{u.versions.count}</td><td>{mo(u.versions.bytes)}</td></tr>
        <tr><td>Vidéos exportées</td><td>{u.exports.count}</td><td>{mo(u.exports.bytes)}</td></tr>
        <tr><td>Aperçus légers des rushes (refaits au besoin)</td><td>{u.proxies.count}</td><td>{mo(u.proxies.bytes)}</td></tr>
        <tr><td>Corbeille</td><td>{u.trash.count}</td><td>{mo(u.trash.bytes)}</td></tr>
        <tr><td>Cache du navigateur (copies)</td><td>{u.cache.count}</td><td>{mo(u.cache.bytes)}</td></tr>
      </tbody></table>
      <div className="row-gap">
        <button className="btn" disabled={!!busy || (!u.unused.length && !u.cache.count)} onClick={() => void run('Nettoyage…', async () => {
          const r = await S.freeSpace();
          if (!r) return 'Aucun espace de projets';
          return `${r.moved} média${r.moved > 1 ? 's' : ''} inutilisé${r.moved > 1 ? 's' : ''} mis à la corbeille (${mo(r.bytes)}), ${r.cacheFreed} copie${r.cacheFreed > 1 ? 's' : ''} du cache libérée${r.cacheFreed > 1 ? 's' : ''} (${mo(r.cacheBytes)})${r.refused ? ` — ${r.refused} gardé${r.refused > 1 ? 's' : ''} car utilisé${r.refused > 1 ? 's' : ''}` : ''}`;
        })}>{busy === 'Nettoyage…' ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} Libérer de la place</button>
        {u.proxies.count > 0 && <button className="btn ghost" disabled={!!busy} onClick={() => void run('Suppression des aperçus…', async () => `${await S.removeProxies()} aperçu(s) léger(s) supprimé(s) : l’aperçu relit les originaux`)}>Supprimer les aperçus légers</button>}
        {u.trash.count > 0 && <button className="btn ghost" disabled={!!busy} onClick={() => void run('Restauration…', async () => `${await S.restoreTrash()} média(s) remis en place`)}><RotateCcw size={14} /> Restaurer la corbeille</button>}
        {u.trash.count > 0 && (confirmEmpty
          ? <button className="btn danger" disabled={!!busy} onClick={() => { setConfirmEmpty(false); void run('Suppression…', async () => `${await S.emptyTrash()} média(s) supprimé(s) définitivement`); }}>Confirmer : supprimer définitivement</button>
          : <button className="btn ghost" disabled={!!busy} onClick={() => setConfirmEmpty(true)}>Vider la corbeille…</button>)}
      </div>
      <p className="help">« Libérer de la place » ne supprime rien : les médias inutilisés vont dans la corbeille du dossier (restaurable), et seules les copies du cache que le dossier possède déjà sont retirées. Un média utilisé par un projet ou une de ses versions n’est jamais touché. Seul « Vider la corbeille » supprime, après confirmation.</p>
    </div>
  );
}
