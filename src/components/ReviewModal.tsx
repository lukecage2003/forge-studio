import { useEffect, useState } from 'react';
import { redo, setUI, undo, update, useStore } from '../store';
import type { Rect, Shot } from '../types';
import { layoutShots } from '../engine/timeline';
import { getImage } from '../engine/media';
import { pause, play, seek } from '../engine/transport';
import { PanelPicker } from './FxDiagram';
import { toast } from './Toast';

/** a panel of a page, as a thumbnail */
function Crop({ pageId, rect, h }: { pageId: string; rect: Rect; h: number }) {
  const page = useStore((st) => st.project.pages.find((p) => p.id === pageId));
  const a = page && getImage(page.mediaId);
  if (!page || !a) return <div className="crop empty" style={{ height: h }} />;
  const k = h / rect.h;
  const w = Math.min(rect.w * k, h * 1.8);
  const kk = Math.min(k, w / rect.w);
  return <div className="crop" style={{ width: rect.w * kk, height: rect.h * kk, backgroundImage: `url(${a.url})`, backgroundSize: `${page.width * kk}px ${page.height * kk}px`, backgroundPosition: `${-rect.x * kk}px ${-rect.y * kk}px` }} />;
}

/**
 * Express review: one doubtful sentence at a time, the panel Forge chose and
 * the other candidates side by side. Keyboard: Enter = right panel, Ctrl+Z = undo, 1–5 =
 * take that alternative, → / ← = next / previous, L = listen, Esc = close.
 * Every choice is undoable and makes the placement the user's (confidence 100 %).
 */
export function ReviewModal() {
  const project = useStore((s) => s.project);
  const [all, setAll] = useState(false);
  const [i, setI] = useState(0);
  const [picking, setPicking] = useState(false);
  const items = layoutShots(project).filter((t) => t.shot.match && (all || t.shot.match.conf < 0.5));
  const cur = items[Math.min(i, Math.max(0, items.length - 1))];
  const close = () => setUI({ reviewOpen: false });

  const setPanel = (s: Shot, pageId: string, rect: Rect) => {
    update((p) => ({ ...p, shots: p.shots.map((x) => (x.id === s.id ? { ...x, pageId, rect, focus: undefined, zone: undefined, path: undefined, shared: undefined, shape: undefined, balloons: undefined, auto: undefined, match: x.match ? { ...x.match, conf: 1 } : undefined, why: 'case choisie à la main (correction express)' } : x)) }));
  };
  const confirm = (s: Shot) => update((p) => ({ ...p, shots: p.shots.map((x) => (x.id === s.id && x.match ? { ...x, match: { ...x.match, conf: 1 } } : x)) }));
  const next = () => setI((v) => (all ? Math.min(v + 1, items.length - 1) : v));
  const listen = () => {
    if (!cur) return;
    seek(cur.start + 0.01); play();
    const d = cur.shot.duration;
    setTimeout(() => pause(), Math.min(15, d) * 1000);
  };
  const alts = cur?.shot.match?.altPanels ?? [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!cur || picking) { if (e.key === 'Escape') (picking ? setPicking(false) : close()); return; }
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter') { e.preventDefault(); confirm(cur.shot); next(); }
      else if (e.key === 'ArrowRight') setI((v) => Math.min(v + 1, items.length - 1));
      else if (e.key === 'ArrowLeft') setI((v) => Math.max(0, v - 1));
      else if (e.key.toLowerCase() === 'l') listen();
      else if (/^[1-5]$/.test(e.key)) { const a = alts[+e.key - 1]; if (a) { setPanel(cur.shot, a.pageId, a.rect); next(); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const tc = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal review-modal" role="dialog" aria-label="Correction express">
        <div className="modal-head">
          <h2>Correction express</h2>
          <label className="toggle small"><input type="checkbox" checked={all} onChange={(e) => { setAll(e.target.checked); setI(0); }} /><span className="switch" /><span>Revoir toutes les associations</span></label>
          <button className="btn sm ghost" onClick={close}>Fermer (Échap)</button>
        </div>
        {!cur ? (
          <div className="review-done">
            <p><b>Tout est vérifié.</b> Chaque phrase a sa case.</p>
            <button className="btn" onClick={close}>Terminer</button>
          </div>
        ) : (
          <>
            <div className="review-progress">{Math.min(i, items.length - 1) + 1} / {items.length} · {tc(cur.start)} · confiance {Math.round((cur.shot.match?.conf ?? 0) * 100)} %</div>
            <blockquote className="said big">« {cur.shot.match!.sentence} »</blockquote>
            <div className="review-row">
              <div className="review-current">
                <span className="muted">Case choisie par Forge</span>
                {cur.shot.pageId && <Crop pageId={cur.shot.pageId} rect={cur.shot.rect} h={230} />}
                <button className="btn" onClick={() => { confirm(cur.shot); next(); }}>C’est la bonne (Entrée)</button>
              </div>
              <div className="review-alts">
                <span className="muted">Ou plutôt…</span>
                <div className="alts">
                  {alts.map((a, k) => (
                    <button key={k} className="alt" title={a.why} onClick={() => { setPanel(cur.shot, a.pageId, a.rect); next(); }}>
                      <b className="key">{k + 1}</b>
                      <Crop pageId={a.pageId} rect={a.rect} h={110} />
                      <small>{a.why}</small>
                    </button>
                  ))}
                  {!alts.length && <small className="hint">pas d’autre candidate : choisis une case dans les planches</small>}
                </div>
                <button className="btn sm ghost" onClick={() => setPicking(true)}>Choisir une autre case dans les planches…</button>
              </div>
            </div>
            <div className="review-nav">
              <button className="btn sm ghost" onClick={() => setI((v) => Math.max(0, v - 1))}>← Précédente</button>
              <button className="btn sm ghost" onClick={listen}>▶ Écouter la phrase (L)</button>
              <button className="btn sm ghost" onClick={() => setI((v) => Math.min(v + 1, items.length - 1))}>Passer →</button>
            </div>
          </>
        )}
        {picking && cur && <PanelPicker onClose={() => setPicking(false)} onPick={(pageId, rect) => { setPanel(cur.shot, pageId, rect); setPicking(false); next(); toast('Case remplacée'); }} />}
      </div>
    </div>
  );
}
