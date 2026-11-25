import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, ShieldCheck } from 'lucide-react';
import { FORMATS } from '../types';
import { createRenderer, loadFonts } from '../engine/render';
import { useMediaVersion } from '../lib/hooks';
import { setUI, useStore } from '../store';
import { pause, seek, toggle } from '../engine/transport';
import { layoutShots, segmentsOf, videoDuration } from '../engine/timeline';
import { arollPlayer } from '../engine/video';
import { toSource } from '../engine/speech';
import { fmtTime } from '../lib/util';
import { loadSegmenter, segmenterReady } from '../engine/segment';
import { notifyMedia } from '../engine/media';

const PREVIEW_SCALE = 0.5;

export function Preview() {
  const mv = useMediaVersion();
  const project = useStore((s) => s.project);
  const t = useStore((s) => s.ui.playhead);
  const playing = useStore((s) => s.ui.playing);
  const safe = useStore((s) => s.ui.safeZones);
  const { w, h } = FORMATS[project.format];
  const W = Math.round(w * PREVIEW_SCALE), H = Math.round(h * PREVIEW_SCALE);
  const renderer = useMemo(() => createRenderer(W, H), [W, H]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fontsReady, setFontsReady] = useState(false);
  const dur = videoDuration(project);

  useEffect(() => { void loadFonts().then(() => setFontsReady(true)); }, []);
  const needsCutout = !!project.aroll && project.look?.cutout !== false && project.fx?.some((f) => f.kind !== 'callout');
  useEffect(() => {
    if (needsCutout && !segmenterReady()) void loadSegmenter().then(() => notifyMedia());
  }, [needsCutout]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const k = Math.min((el.clientWidth - 24) / w, (el.clientHeight - 24) / h);
      setSize({ w: w * k, h: h * k });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [w, h]);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d', { alpha: false });
    const ar = project.aroll;
    if (ar && !playing) {
      const segs = segmentsOf(ar);
      if (segs.length) arollPlayer.seek(ar.mediaId, toSource(segs, t).src);
    }
    const face = ar ? () => arollPlayer.frame(ar.mediaId) : undefined;
    if (ctx) renderer.draw(ctx, project, t, face);
  }, [renderer, project, t, mv, fontsReady, playing]);

  const timed = layoutShots(project);
  const idx = timed.findIndex((x) => t >= x.start && t < x.end);
  const jump = (d: number) => {
    const i = idx < 0 ? timed.length - 1 : idx;
    const tgt = timed[Math.max(0, Math.min(timed.length - 1, i + d))];
    if (tgt) seek(d < 0 && t - timed[i].start > 0.3 ? timed[i].start : tgt.start);
  };

  return (
    <div className="stage preview">
      <div className="preview-box" ref={boxRef}>
        <div className="screen" style={{ width: size.w, height: size.h }}>
          <canvas ref={canvasRef} width={W} height={H} onClick={() => toggle()} />
          {safe && project.format === '9:16' && (
            <div className="safe-zones" aria-hidden="true">
              <div className="sz top" /><div className="sz bottom" /><div className="sz right" />
            </div>
          )}
          {!project.shots.length && !project.aroll && (
            <div className="screen-empty">Importe tes planches ou ton rush face caméra, puis lance le <b>montage auto</b>.</div>
          )}
        </div>
      </div>
      <div className="transport">
        <span className="tc">{fmtTime(t, project.fps)}</span>
        <div className="transport-btns">
          <button className="icon-btn" onClick={() => jump(-1)} title="Case précédente"><SkipBack size={17} /></button>
          <button className="play-btn" onClick={() => toggle()} title="Lecture / pause (Espace)">
            {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={() => jump(1)} title="Case suivante"><SkipForward size={17} /></button>
        </div>
        <span className="tc dim">{fmtTime(dur, project.fps)}</span>
        <button className={`icon-btn ${safe ? 'active' : ''}`} title="Zones de sécurité TikTok (interface de l’appli)"
          onClick={() => { pause(); setUI({ safeZones: !safe }); }} disabled={project.format !== '9:16'}>
          <ShieldCheck size={17} />
        </button>
      </div>
    </div>
  );
}
