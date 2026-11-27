import { useEffect, useMemo, useState } from 'react';
import { X, Clapperboard, RefreshCw, Wand2, AlertTriangle, Loader2, ImagePlus } from 'lucide-react';
import { getState, setUI, update, useStore } from '../store';
import type { Project, Rect } from '../types';
import { boardIssues, boardSummary, captionChunks, sentenceKey, type Board, type BoardCamera, type BoardMode, type BoardRow, type BoardSound } from '../engine/storyboard';
import { narration } from '../engine/narration';
import { panelThumb } from '../engine/auto';
import { PanelPicker } from './FxDiagram';
import { toast } from './Toast';

const CAMERAS: [BoardCamera, string][] = [['auto', 'Automatique'], ['read', 'Lire les bulles'], ['tour', 'Explorer'], ['zoom-in', 'Zoom avant'], ['zoom-out', 'Zoom arrière'], ['reveal', 'Révéler'], ['panel-nav', 'Case à case'], ['page-glide', 'Glisser sur la page'], ['static', 'Fixe']];
const SOUNDS: [BoardSound, string][] = [['auto', 'Automatique'], ['impact', 'Impact'], ['whoosh', 'Souffle'], ['none', 'Aucun']];
const MODES: [BoardMode, string][] = [['auto', 'Forge choisit'], ['panel', 'Case'], ['face', 'Visage']];
const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function StoryboardModal() {
  const board = useStore((s) => s.project.storyboard);
  const project = useStore((s) => s.project);
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const sents = useMemo(() => narration(project).sentences, [project.script, project.aroll, project.audio]); // eslint-disable-line react-hooks/exhaustive-deps
  const stale = !!board && board.key !== sentenceKey(sents);
  const issues = board ? boardIssues(board, project) : [];
  const sum = board ? boardSummary(board) : null;
  const close = () => setUI({ storyboardOpen: false });
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && pick == null) close(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [pick]);

  const compute = async () => {
    setBusy('Préparation du storyboard…');
    try {
      const { planBoard } = await import('../production/kinds');
      const { queue } = await import('../production/orchestrator');
      const t = await planBoard('local');
      const off = queue.subscribe(() => { const x = queue.get(t.id); if (x && x.state === 'running') setBusy(x.note ?? 'Préparation du storyboard…'); });
      await queue.idle([t.id]);
      off();
      const x = queue.get(t.id);
      if (x?.state === 'failed') toast(x.error?.message ?? 'Storyboard impossible', 'error');
      if (x?.state === 'stale') toast('Tu as modifié le storyboard pendant le calcul : tes choix sont gardés, le nouveau calcul attend dans la file de tâches.', 'info');
    } finally { setBusy(null); }
  };
  /** one row changed by hand: marked as edited, so a new computation keeps it */
  const edit = (i: number, patch: Partial<BoardRow>, field: NonNullable<BoardRow['edited']>[number]) =>
    update((p) => {
      const b = p.storyboard;
      if (!b) return p;
      const rows = b.rows.map((r, k) => (k === i ? { ...r, ...patch, edited: [...new Set([...(r.edited ?? []), field])] } : r));
      return { ...p, storyboard: { ...b, rows } };
    });
  const choose = (i: number, shotId: string) => edit(i, { shotId, mode: 'panel', conf: 1 }, 'shot');
  const pickRect = async (i: number, pageId: string, rect: Rect) => {
    const same = getState().project.shots.find((s) => s.pageId === pageId && Math.abs(s.rect.x - rect.x) < 2 && Math.abs(s.rect.y - rect.y) < 2 && Math.abs(s.rect.w - rect.w) < 2 && Math.abs(s.rect.h - rect.h) < 2);
    if (same) { choose(i, same.id); setPick(null); return; }
    const { addShotRect } = await import('../actions');
    addShotRect(pageId, rect);
    const made = getState().project.shots.filter((s) => s.pageId === pageId).at(-1);
    if (made) choose(i, made.id);
    setPick(null);
  };
  const edit_ = () => { close(); setUI({ autoOpen: true }); };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal storyboard-modal" role="dialog" aria-labelledby="sb-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><Clapperboard size={18} /></span>
            <div><h2 id="sb-title">Storyboard</h2><p>Le plan de ta vidéo, phrase par phrase, à corriger avant le montage. Le montage automatique le suit tel quel.</p></div>
          </div>
          <button className="icon-btn ghost" onClick={close} aria-label="Fermer"><X size={18} /></button>
        </header>
        <div className="sb-bar">
          {sum && <span className="help">{sum.rows} phrases · {fmt(sum.duration)} · {sum.panels} cases · visage {Math.round(sum.faceShare * 100)} % · {sum.edited} modifiée{sum.edited > 1 ? 's' : ''} à la main</span>}
          <span className="sb-actions">
            <button className="btn sm" disabled={!!busy || !sents.length} onClick={() => void compute()}>{busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} {board ? 'Recalculer (garde tes choix)' : 'Préparer le storyboard'}</button>
            <button className="btn sm primary" disabled={!board || stale || !!busy} onClick={edit_}><Wand2 size={13} /> Monter selon ce storyboard</button>
          </span>
        </div>
        {busy && <p className="help">{busy}</p>}
        {!sents.length && <p className="help">Il faut une narration : colle ton script (bouton Script) ou transcris ton rush.</p>}
        {stale && <p className="error-box">Le script a changé depuis ce storyboard : recalcule-le (tes choix sur les phrases inchangées sont gardés).</p>}
        {issues.length > 0 && <p className="sb-issues"><AlertTriangle size={13} /> {issues.filter((x) => x.level === 'error').length} à corriger · {issues.filter((x) => x.level === 'warn').length} à vérifier</p>}
        {board && (
          <ol className="sb-rows">
            {board.rows.map((r, i) => <Row key={i} i={i} r={r} next={board.rows[i + 1]} project={project} issues={issues.filter((x) => x.row === i).map((x) => x.text)} edit={edit} choose={choose} onPick={() => setPick(i)} />)}
          </ol>
        )}
        {pick != null && <PanelPicker onPick={(pg, rect) => void pickRect(pick, pg, rect)} onClose={() => setPick(null)} />}
      </div>
    </div>
  );
}

function Row({ i, r, next, project, issues, edit, choose, onPick }: { i: number; r: BoardRow; next?: BoardRow; project: Project; issues: string[]; edit: (i: number, p: Partial<BoardRow>, f: NonNullable<BoardRow['edited']>[number]) => void; choose: (i: number, id: string) => void; onPick: () => void }) {
  const shot = r.shotId ? project.shots.find((s) => s.id === r.shotId) : undefined;
  const len = (next?.s ?? r.e + 0.6) - r.s;
  const thumb = (id: string, size = 150) => { const s = project.shots.find((x) => x.id === id); return s?.pageId ? panelThumb(project, s.pageId, s.rect, size) : ''; };
  const chunks = captionChunks(r.text, project.subtitleStyle.maxWords || 3);
  return (
    <li className={`sb-row ${issues.length ? 'warn' : ''}`}>
      <div className="sb-time"><b>{fmt(r.s)}</b><span>{len.toFixed(1)} s</span></div>
      <div className="sb-visual">
        {r.mode === 'face' ? <div className="sb-face">Visage</div> : shot ? <img src={thumb(shot.id)} alt="" /> : <div className="sb-face missing">Aucune case</div>}
        {r.alts.length > 0 && <div className="sb-alts">{r.alts.slice(0, 3).map((a) => thumb(a, 70) && <button key={a} title="Prendre cette case" onClick={() => choose(i, a)}><img src={thumb(a, 70)} alt="Autre case" /></button>)}</div>}
        <button className="btn sm ghost" onClick={onPick}><ImagePlus size={12} /> Autre case…</button>
      </div>
      <div className="sb-main">
        <p className="sb-text">{r.text}</p>
        <div className="sb-controls">
          <div className="seg" role="radiogroup" aria-label="Image">{MODES.map(([m, l]) => <button key={m} role="radio" aria-checked={r.mode === m} className={r.mode === m ? 'on' : ''} onClick={() => edit(i, { mode: m }, 'mode')}>{l}</button>)}</div>
          <label>Caméra <select className="input sm" value={r.camera} onChange={(e) => edit(i, { camera: e.target.value as BoardCamera }, 'camera')}>{CAMERAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label>Son <select className="input sm" value={r.sound} onChange={(e) => edit(i, { sound: e.target.value as BoardSound }, 'sound')}>{SOUNDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        </div>
        <p className="sb-subs">{chunks.map((c, k) => <span key={k}>{c}</span>)}</p>
        <p className="help">{r.why}{r.edited?.length ? ' · modifiée à la main' : ''}</p>
        {issues.map((t, k) => <p key={k} className="sb-issue">{t}</p>)}
      </div>
    </li>
  );
}
export type { Board };
