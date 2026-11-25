import { useEffect, useRef, useState } from 'react';
import { Film, Type, Music2, AudioLines, Volume2, ZoomIn, ZoomOut, Maximize2, ScanFace } from 'lucide-react';
import type { AudioClip, AudioKind, Project, Shot } from '../types';
import { getState, setUI, update, useStore } from '../store';
import { layoutShots, segmentsOf, videoDuration } from '../engine/timeline';
import { getImage } from '../engine/media';
import { peaks } from '../engine/audio';
import { seek } from '../engine/transport';
import { useMediaVersion } from '../lib/hooks';
import { moveShot } from '../actions';
import { clamp, fmtShort } from '../lib/util';

const LANES: { kind: 'face' | 'video' | 'text' | AudioKind; label: string; icon: React.ReactNode }[] = [
  { kind: 'face', label: 'Visage', icon: <ScanFace size={14} /> },
  { kind: 'video', label: 'Cases', icon: <Film size={14} /> },
  { kind: 'text', label: 'Texte', icon: <Type size={14} /> },
  { kind: 'voice', label: 'Voix', icon: <AudioLines size={14} /> },
  { kind: 'music', label: 'Musique', icon: <Music2 size={14} /> },
  { kind: 'sfx', label: 'Bruitages', icon: <Volume2 size={14} /> },
];

export function Timeline() {
  useMediaVersion();
  const project = useStore((s) => s.project);
  const pps = useStore((s) => s.ui.pxPerSec);
  const playhead = useStore((s) => s.ui.playhead);
  const sel = useStore((s) => s.ui.selection);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drop, setDrop] = useState<number | null>(null);

  const timed = layoutShots(project);
  const overlay = !!project.aroll;
  const segs = segmentsOf(project.aroll);
  const vdur = videoDuration(project);
  const adur = project.audio.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
  const total = Math.max(vdur, adur, 10) + 4;
  const width = total * pps;

  const xToT = (clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return (clientX - r.left + el.scrollLeft) / pps;
  };

  const scrub = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    seek(xToT(e.clientX));
    const mv = (ev: PointerEvent) => seek(xToT(ev.clientX));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  // follow the playhead while playing
  const playing = useStore((s) => s.ui.playing);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = playhead * pps;
    if (x > el.scrollLeft + el.clientWidth - 80 || x < el.scrollLeft) el.scrollLeft = x - 120;
  }, [playhead, playing, pps]);

  const zoom = (f: number) => setUI({ pxPerSec: clamp(pps * f, 8, 400) });
  const fitAll = () => {
    const el = scrollRef.current;
    if (el) setUI({ pxPerSec: clamp((el.clientWidth - 40) / Math.max(vdur, adur, 5), 8, 400) });
  };

  /* -------- shot drag: reorder / resize */
  const startShotDrag = (e: React.PointerEvent, s: Shot, index: number, mode: 'move' | 'resize') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setUI({ selection: { kind: 'shot', id: s.id }, activePageId: s.pageId ?? getState().ui.activePageId });
    const x0 = e.clientX, d0 = s.duration, s0 = s.start ?? 0;
    let moved = false;
    let target = index;
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (mode === 'resize') {
        update((p) => ({ ...p, shots: p.shots.map((x) => (x.id === s.id ? { ...x, duration: +clamp(d0 + dx / pps, 0.4, 30).toFixed(2) } : x)) }), 'tl-dur-' + s.id);
        return;
      }
      if (!moved && Math.abs(dx) < 5) return;
      moved = true;
      if (overlay) {
        let st = Math.max(0, s0 + dx / pps);
        const pts = [0, getState().ui.playhead, ...segs.map((g) => g.t), ...layoutShots(getState().project).filter((x) => x.shot.id !== s.id).flatMap((x) => [x.start, x.end])];
        for (const p of pts) {
          if (Math.abs(p - st) * pps < 7) { st = p; break; }
          if (Math.abs(p - (st + s.duration)) * pps < 7) { st = p - s.duration; break; }
        }
        update((p) => ({ ...p, shots: p.shots.map((x) => (x.id === s.id ? { ...x, start: +st.toFixed(3) } : x)) }), 'tl-start-' + s.id);
        return;
      }
      const t = xToT(ev.clientX);
      const tl = layoutShots(getState().project);
      target = tl.findIndex((ts) => t < ts.start + ts.shot.duration / 2);
      if (target < 0) target = tl.length;
      setDrop(target);
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      setDrop(null);
      if (mode === 'move') {
        if (!overlay && moved && target !== index && target !== index + 1) moveShot(index, target);
        else if (!moved) seek((timed.find((x) => x.shot.id === s.id)?.start ?? 0) + 0.001);
      }
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  /* -------- audio drag: move / trim */
  const snapPoints = () => [0, getState().ui.playhead, ...segs.map((g) => g.t), ...layoutShots(getState().project).flatMap((t) => [t.start, t.end])];
  const snap = (t: number) => {
    for (const p of snapPoints()) if (Math.abs(p - t) * pps < 7) return p;
    return t;
  };
  const startClipDrag = (e: React.PointerEvent, c: AudioClip, mode: 'move' | 'l' | 'r') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setUI({ selection: { kind: 'audio', id: c.id } });
    const x0 = e.clientX;
    const mv = (ev: PointerEvent) => {
      const dt = (ev.clientX - x0) / pps;
      let patch: Partial<AudioClip>;
      if (mode === 'move') {
        patch = { start: Math.max(0, snap(c.start + dt)) };
        const endSnap = snap(c.start + dt + c.duration);
        if (endSnap !== c.start + dt + c.duration) patch.start = Math.max(0, endSnap - c.duration);
      } else if (mode === 'r') {
        const end = snap(c.start + c.duration + dt);
        patch = { duration: clamp(end - c.start, 0.1, c.sourceDuration - c.offset) };
      } else {
        const ns = clamp(snap(c.start + dt), c.start - c.offset, c.start + c.duration - 0.1);
        const d = ns - c.start;
        patch = { start: Math.max(0, ns), offset: c.offset + d, duration: c.duration - d };
      }
      update((p) => ({ ...p, audio: p.audio.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) }), `tl-a-${mode}-${c.id}`);
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  // ruler ticks
  const step = pps > 120 ? 0.5 : pps > 50 ? 1 : pps > 20 ? 5 : 10;
  const ticks: number[] = [];
  for (let t = 0; t <= total; t += step) ticks.push(t);

  return (
    <section className="timeline" aria-label="Timeline">
      <div className="tl-toolbar">
        <span className="tl-title">Timeline</span>
        <span className="tl-meta">{project.shots.length} plans · {fmtShort(vdur)}</span>
        <div className="toolbar-spacer" />
        <button className="icon-btn sm" onClick={() => zoom(1 / 1.4)} title="Dézoomer"><ZoomOut size={15} /></button>
        <input className="zoom-range" type="range" min={8} max={400} value={pps}
          style={{ ['--p' as string]: ((pps - 8) / 392) * 100 + '%' }}
          onChange={(e) => setUI({ pxPerSec: +e.target.value })} aria-label="Zoom timeline" />
        <button className="icon-btn sm" onClick={() => zoom(1.4)} title="Zoomer"><ZoomIn size={15} /></button>
        <button className="icon-btn sm" onClick={fitAll} title="Tout afficher"><Maximize2 size={15} /></button>
      </div>
      <div className="tl-body">
        <div className="tl-labels">
          <div className="tl-ruler-spacer" />
          {LANES.map((l) => (
            <div key={l.kind} className={`tl-label lane-${l.kind}`}>{l.icon}<span>{l.label}</span></div>
          ))}
        </div>
        <div className="tl-scroll" ref={scrollRef}>
          <div className="tl-inner" style={{ width }}>
            <div className="tl-ruler" onPointerDown={scrub}>
              {ticks.map((t) => (
                <div key={t} className={`tick ${t % (step * 2) === 0 ? 'major' : ''}`} style={{ left: t * pps }}>
                  {t % (step * 2) === 0 && <span>{t < 60 ? `${t}s` : `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`}</span>}
                </div>
              ))}
            </div>

            {/* face-cam lane */}
            <div className="tl-lane lane-face" onPointerDown={() => setUI({ selection: project.aroll ? { kind: 'aroll' } : null })}>
              {segs.map((g, i) => (
                <div key={i} className={`face-seg ${sel?.kind === 'aroll' ? 'on' : ''} ${i % 2 ? 'odd' : ''}`} style={{ left: g.t * pps, width: Math.max(1, (g.e - g.s) * pps) }} />
              ))}
              {!project.aroll && <div className="lane-empty">Ton rush face caméra (onglet Rush)</div>}
            </div>

            {/* video lane */}
            <div className="tl-lane lane-video" onPointerDown={() => setUI({ selection: null })}>
              {timed.map(({ shot, start, index }, ti) => (
                <ShotBlock key={shot.id} shot={shot} project={project} left={start * pps} width={shot.duration * pps}
                  on={sel?.kind === 'shot' && sel.id === shot.id} index={overlay ? ti : index}
                  onMove={(e) => startShotDrag(e, shot, index, 'move')} onResize={(e) => startShotDrag(e, shot, index, 'resize')} />
              ))}
              {drop != null && <div className="drop-line" style={{ left: (timed[drop]?.start ?? vdur) * pps }} />}
              {!timed.length && <div className="lane-empty">Les cases apparaîtront ici</div>}
            </div>

            {/* text lane */}
            <div className="tl-lane lane-text">
              {project.subtitles.map((sb, i) => (
                <div key={'sub' + i} className="cap-chip sub" style={{ left: sb.s * pps + 1, width: Math.max(4, (sb.e - sb.s) * pps - 2) }} title={sb.text}>{sb.text}</div>
              ))}
              {timed.filter((t) => t.shot.caption.text.trim()).map(({ shot, start }) => (
                <div key={shot.id} className={`cap-chip ${sel?.kind === 'shot' && sel.id === shot.id ? 'on' : ''}`}
                  style={{ left: start * pps + 1, width: shot.duration * pps - 2 }}
                  onPointerDown={(e) => { e.stopPropagation(); setUI({ selection: { kind: 'shot', id: shot.id } }); }}>
                  {shot.caption.text}
                </div>
              ))}
            </div>

            {(['voice', 'music', 'sfx'] as AudioKind[]).map((k) => (
              <div key={k} className={`tl-lane lane-${k}`}>
                {project.audio.filter((c) => c.kind === k).map((c) => (
                  <ClipBlock key={c.id} clip={c} pps={pps} on={sel?.kind === 'audio' && sel.id === c.id}
                    onDown={(e, m) => startClipDrag(e, c, m)} />
                ))}
              </div>
            ))}

            <div className="tl-playhead" style={{ left: playhead * pps }}><span /></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ShotBlock({ shot, project, left, width, on, index, onMove, onResize }: {
  shot: Shot; project: Project; left: number; width: number; on: boolean; index: number;
  onMove: (e: React.PointerEvent) => void; onResize: (e: React.PointerEvent) => void;
}) {
  const page = project.pages.find((p) => p.id === shot.pageId);
  const a = page && getImage(page.mediaId);
  const H = 52;
  let tiles: React.ReactNode = null;
  if (page && a) {
    const k = H / shot.rect.h;
    const tw = Math.max(8, shot.rect.w * k);
    const style: React.CSSProperties = {
      width: tw, height: H,
      backgroundImage: `url(${a.url})`,
      backgroundSize: `${page.width * k}px ${page.height * k}px`,
      backgroundPosition: `${-shot.rect.x * k}px ${-shot.rect.y * k}px`,
      backgroundRepeat: 'no-repeat',
    };
    const n = Math.min(40, Math.ceil(width / tw));
    tiles = Array.from({ length: n }, (_, i) => <div key={i} className="film-tile" style={style} />);
  }
  return (
    <div className={`shot-block ${on ? 'on' : ''} ${page ? '' : 'title'}`} style={{ left, width }} onPointerDown={onMove}>
      <div className="shot-film">{tiles}{!page && <span className="title-label">{shot.caption.text || 'Titre'}</span>}</div>
      <span className="shot-idx">{index + 1}</span>
      {width > 54 && <span className="shot-dur">{shot.duration.toFixed(1)}s</span>}
      {index > 0 && shot.transition !== 'cut' && <span className="tr-mark" title={`Transition : ${shot.transition}`} />}
      <div className="resize-h" onPointerDown={onResize} title="Glisser pour changer la durée" />
    </div>
  );
}

function ClipBlock({ clip, pps, on, onDown }: {
  clip: AudioClip; pps: number; on: boolean; onDown: (e: React.PointerEvent, m: 'move' | 'l' | 'r') => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = Math.max(4, clip.duration * pps);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const pk = peaks(clip.mediaId);
    const cw = Math.min(4000, Math.round(w));
    c.width = cw;
    c.height = 36;
    const x = c.getContext('2d')!;
    x.clearRect(0, 0, cw, 36);
    if (!pk) return;
    x.fillStyle = 'currentColor';
    const style = getComputedStyle(c);
    x.fillStyle = style.color;
    for (let i = 0; i < cw; i += 2) {
      const tt = clip.offset + (i / cw) * clip.duration;
      const v = pk[Math.min(pk.length - 1, Math.floor((tt / clip.sourceDuration) * pk.length))] ?? 0;
      const hh = Math.max(1, v * 34);
      x.fillRect(i, 18 - hh / 2, 1.4, hh);
    }
  }, [clip.mediaId, clip.offset, clip.duration, clip.sourceDuration, w]);
  return (
    <div className={`clip-block k-${clip.kind} ${on ? 'on' : ''}`} style={{ left: clip.start * pps, width: w }} onPointerDown={(e) => onDown(e, 'move')}>
      <canvas ref={ref} className="wave" />
      <span className="clip-name">{clip.name}</span>
      <div className="trim l" onPointerDown={(e) => onDown(e, 'l')} />
      <div className="trim r" onPointerDown={(e) => onDown(e, 'r')} />
    </div>
  );
}
