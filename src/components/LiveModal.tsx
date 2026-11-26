import { useEffect, useMemo, useRef, useState } from 'react';
import { Radio, X, Play, SkipForward } from 'lucide-react';
import { getState, setUI, useStore } from '../store';
import { getImage } from '../engine/media';
import { layoutShots } from '../engine/timeline';
import { peaks } from '../engine/audio';
import { TRANSITION } from '../engine/effects';
import { play, seek } from '../engine/transport';
import type { Project, Shot } from '../types';

const LAYOUT_FR: Record<string, string> = { full: 'case plein écran', split: 'écran partagé', pip: 'bulle visage', grid: 'multi-cases', page: 'page entière' };
const MOTION_FR: Record<string, string> = { auto: 'mouvement auto', static: 'fixe', 'zoom-in': 'zoom avant', 'zoom-out': 'zoom arrière', 'pan-left': 'panoramique ←', 'pan-right': 'panoramique →', 'pan-up': 'panoramique ↑', 'pan-down': 'panoramique ↓', read: 'la caméra lit les bulles', tour: 'exploration : plan général, détail, retour', 'page-glide': 'travelling sur la page', 'panel-nav': 'de case en case', reveal: 'révélation depuis un détail' };
const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** one line of the journal: what the shot is and why */
export function describeShot(p: Project, s: Shot): string {
  if (s.diagram) return `Schéma « ${s.diagram.title || s.diagram.kind} »${s.why ? ' · ' + s.why : ''}`;
  if (!s.pageId) return `Carton « ${s.caption.text.slice(0, 40)} »`;
  const pg = p.pages.find((x) => x.id === s.pageId);
  const bits = [`${pg?.name ?? 'case'}`, LAYOUT_FR[s.layout] ?? s.layout, MOTION_FR[s.motion] ?? s.motion, `entrée ${TRANSITION[s.transition]?.label ?? s.transition}`];
  const why = [s.match?.sentence ? `illustre « ${s.match.sentence.slice(0, 60)}${s.match.sentence.length > 60 ? '…' : ''} »` : '', s.why ?? ''].filter(Boolean).join(' · ');
  return bits.join(' · ') + (why ? ' — ' + why : '');
}

function PageCut({ p, pageId, order, progress }: { p: Project; pageId: string; order: Shot[]; progress: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, pg = p.pages.find((x) => x.id === pageId), a = pg && getImage(pg.mediaId);
    if (!c || !pg || !a) return;
    const H = 360, W = Math.round((H * pg.width) / pg.height);
    c.width = W; c.height = H;
    const x = c.getContext('2d')!;
    const k = H / pg.height;
    x.drawImage(a.img, 0, 0, W, H);
    x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 0, W, H);
    const n = Math.floor(progress * order.length + 0.001);
    order.slice(0, n + 1).forEach((s, i) => {
      const r = s.rect, f = i < n ? 1 : (progress * order.length) % 1;
      x.save();
      x.globalAlpha = Math.min(1, f * 2);
      x.drawImage(a.img, r.x, r.y, r.w, r.h, r.x * k, r.y * k, r.w * k, r.h * k);
      x.strokeStyle = '#FFE500'; x.lineWidth = 3;
      x.strokeRect(r.x * k, r.y * k, r.w * k * Math.min(1, f * 1.5), r.h * k * Math.min(1, f * 1.5));
      x.fillStyle = '#FFE500'; x.beginPath(); x.arc(r.x * k + 14, r.y * k + 14, 11, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#111'; x.font = 'bold 13px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(i + 1), r.x * k + 14, r.y * k + 14);
      x.restore();
    });
  });
  return <canvas ref={ref} className="live-page" />;
}

function RushCuts({ p, progress }: { p: Project; progress: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current, ar = p.aroll;
    if (!c || !ar) return;
    const W = 860, H = 120;
    c.width = W; c.height = H;
    const x = c.getContext('2d')!;
    x.fillStyle = '#111'; x.fillRect(0, 0, W, H);
    const pk = peaks(ar.mediaId, W);
    x.fillStyle = '#4fd1c5';
    if (pk) for (let i = 0; i < W; i++) { const h = pk[i] * H * 0.9; x.fillRect(i, H / 2 - h / 2, 1, h); }
    const lim = progress * ar.duration;
    for (const cut of ar.cuts.filter((q) => q.on && q.s < lim)) {
      const x0 = (cut.s / ar.duration) * W, x1 = (Math.min(cut.e, lim) / ar.duration) * W;
      x.fillStyle = cut.reason === 'retake' ? 'rgba(244,114,182,0.6)' : cut.reason === 'silence' ? 'rgba(255,90,31,0.45)' : 'rgba(250,204,21,0.55)';
      x.fillRect(x0, 0, Math.max(1, x1 - x0), H);
    }
    x.fillStyle = '#fff'; x.fillRect(lim / ar.duration * W, 0, 2, H);
  });
  return <canvas ref={ref} className="live-wave" />;
}

/** the live view: replays every decision of the auto edit, then plays it with the journal */
export function LiveModal() {
  const p = useStore((s) => s.project);
  const notes = useStore((s) => s.ui.lastNotes ?? []);
  const timed = useMemo(() => layoutShots(p), [p]);
  const pages = useMemo(() => {
    const seen: string[] = [];
    for (const t of timed) if (t.shot.pageId && !seen.includes(t.shot.pageId)) seen.push(t.shot.pageId);
    return seen.slice(0, 8);
  }, [timed]);
  const stages = [...(pages.length ? ['pages'] : []), ...(p.aroll ? ['rush'] : []), 'shots', 'done'] as const;
  const [stage, setStage] = useState(0);
  const [t, setT] = useState(0);
  const lens: Record<string, number> = { pages: Math.max(3, pages.length * 1.6), rush: 4, shots: Math.min(12, 2 + timed.length * 0.18), done: Infinity };
  const cur = stages[stage];
  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (now: number) => { setT((x) => x + (now - last) / 1000); last = now; raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => { if (t >= lens[cur]) { setStage((s) => Math.min(stages.length - 1, s + 1)); setT(0); } }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => setUI({ liveOpen: false });
  const watch = () => { setUI({ liveOpen: false, liveLog: true, mode: 'preview' }); seek(0); play(); };
  const pageIdx = cur === 'pages' ? Math.min(pages.length - 1, Math.floor(t / 1.6)) : 0;
  const pageShots = cur === 'pages' ? timed.filter((x) => x.shot.pageId === pages[pageIdx]).map((x) => x.shot).filter((s, i, a) => a.findIndex((y) => JSON.stringify(y.rect) === JSON.stringify(s.rect)) === i) : [];
  const shown = cur === 'shots' ? Math.floor((t / lens.shots) * timed.length) : timed.length;
  return (
    <div className="modal-back">
      <div className="modal live-modal" role="dialog" aria-labelledby="live-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><Radio size={18} /></span>
            <div><h2 id="live-title">Montage en direct</h2><p>{cur === 'pages' ? `Découpe des cases · page ${pageIdx + 1}/${pages.length} : dans l’ordre de lecture` : cur === 'rush' ? 'Dérushage : silences (orange), hésitations (jaune), reprises (rose) retirés' : cur === 'shots' ? 'Les plans se posent, chacun avec sa raison' : 'Montage prêt'}</p></div>
          </div>
          <div className="row-btns gap">
            {cur !== 'done' && <button className="btn sm ghost" onClick={() => { setStage(stages.length - 1); setT(0); }}><SkipForward size={14} /> Passer</button>}
            <button className="icon-btn ghost" onClick={close} aria-label="Fermer"><X size={18} /></button>
          </div>
        </header>
        <div className="steps-row">{stages.map((s, i) => <span key={s} className={`step ${i < stage ? 'done' : i === stage ? 'on' : ''}`}>{{ pages: 'Découpe', rush: 'Dérushage', shots: 'Plans', done: 'Lecture' }[s]}</span>)}</div>
        {cur === 'pages' && <PageCut p={p} pageId={pages[pageIdx]} order={pageShots} progress={Math.min(1, (t - pageIdx * 1.6) / 1.2)} />}
        {cur === 'rush' && <><RushCuts p={p} progress={Math.min(1, t / 3.5)} /><p className="muted">Rush {p.aroll!.duration.toFixed(1)} s · {p.aroll!.cuts.filter((c) => c.on).length} coupes</p></>}
        {(cur === 'shots' || cur === 'done') && (
          <ol className="live-list">
            {timed.slice(0, Math.max(0, shown)).map((x, i) => (
              <li key={x.shot.id + i}><span className="muted">{mmss(x.start)}</span><span>{describeShot(p, x.shot)}</span></li>
            ))}
          </ol>
        )}
        {cur === 'done' && (
          <>
            <ul className="learned">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
            <div className="row-btns gap"><button className="btn primary" onClick={watch}><Play size={15} /> Regarder avec le journal</button><button className="btn" onClick={close}>Fermer</button></div>
          </>
        )}
      </div>
    </div>
  );
}

/** journal docked on the preview: the decision behind the shot on screen */
export function LiveLog() {
  const p = useStore((s) => s.project);
  const t = useStore((s) => s.ui.playhead);
  const timed = useMemo(() => layoutShots(p), [p]);
  const i = Math.max(0, timed.findIndex((x) => t >= x.start && t < x.end));
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => { ref.current?.children[i]?.scrollIntoView({ block: 'nearest' }); }, [i]);
  return (
    <div className="live-log">
      <div className="live-log-head"><b>Journal du montage</b><button className="icon-btn sm ghost" onClick={() => setUI({ liveLog: false })} aria-label="Fermer le journal"><X size={13} /></button></div>
      <ol ref={ref}>
        {timed.map((x, k) => (
          <li key={x.shot.id + k} className={k === i ? 'on' : ''} onClick={() => seek(x.start + 0.01)}><span className="muted">{mmss(x.start)}</span> {describeShot(getState().project, x.shot)}</li>
        ))}
      </ol>
    </div>
  );
}
