import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, SkipBack, SkipForward, ShieldCheck, Maximize, Repeat } from 'lucide-react';
import { FORMATS } from '../types';
import { createRenderer, loadFonts } from '../engine/render';
import { useMediaVersion } from '../lib/hooks';
import { ensure3D, has3D } from '../engine/scene3d';
import { advise, detectHardware } from '../engine/hardware';
import { DIAGRAM_3D } from '../types';
import { setUI, useStore } from '../store';
import { pause, seek, toggle } from '../engine/transport';
import { layoutShots, segmentsOf, videoDuration } from '../engine/timeline';
import { arollPlayer } from '../engine/video';
import { toSource } from '../engine/speech';
import { fmtTime } from '../lib/util';
import { loadSegmenter, segmenterReady } from '../engine/segment';
import { notifyMedia } from '../engine/media';
import { ensureLayers } from '../engine/layers';
import { shotAt } from '../engine/timeline';

/** preview resolution: set from this computer's profile, lowered on the fly while playing if frames come too slowly */
let baseScale = 0.5;
void detectHardware().then((h) => { baseScale = advise(h).previewScale; });

export function Preview() {
  const mv = useMediaVersion();
  const project = useStore((s) => s.project);
  const t = useStore((s) => s.ui.playhead);
  const playing = useStore((s) => s.ui.playing);
  const safe = useStore((s) => s.ui.safeZones);
  const loop = useStore((s) => s.ui.loop);
  const screenRef = useRef<HTMLDivElement>(null);
  const { w, h } = FORMATS[project.format];
  const [liveScale, setLiveScale] = useState(baseScale);
  const scale = playing ? liveScale : Math.max(liveScale, baseScale);
  const W = Math.round(w * scale), H = Math.round(h * scale);
  const drawMs = useRef<number[]>([]);
  const renderer = useMemo(() => createRenderer(W, H), [W, H]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fontsReady, setFontsReady] = useState(false);
  const dur = videoDuration(project);

  useEffect(() => { void loadFonts().then(() => setFontsReady(true)); }, []);
  // the cleaned voice is prepared in the background so the preview sounds like the export
  const denoise = project.mix?.denoise ?? 'auto';
  const voiceIds = [project.aroll?.mediaId, ...project.audio.filter((a) => a.kind === 'voice').map((a) => a.mediaId)].filter(Boolean).join(',');
  const voiceMode = `${denoise}:${project.mix?.voice ?? ''}:${project.mix?.voiceClean}`;
  useEffect(() => { if (voiceIds) void import('../engine/audio').then((m) => m.prepareVoices(project)); }, [voiceIds, voiceMode]); // eslint-disable-line react-hooks/exhaustive-deps
  // three.js is loaded only when the project has a 3D scene
  const needs3D = project.shots.some((s) => s.diagram && DIAGRAM_3D.includes(s.diagram.kind));
  const [ready3D, setReady3D] = useState(has3D());
  useEffect(() => { if (needs3D && !ready3D) void ensure3D().then((m) => setReady3D(!!m)); }, [needs3D, ready3D]);
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
    if (!ctx) return;
    const t0 = performance.now();
    renderer.draw(ctx, project, t, face);
    if (playing) {
      // keep playback fluid: average draw time over 12 frames, step the resolution down (never below 35 %)
      const a = drawMs.current; a.push(performance.now() - t0); if (a.length > 12) a.shift();
      const avg = a.reduce((x, y) => x + y, 0) / a.length;
      if (a.length >= 12 && avg > 45 && liveScale > 0.36) { drawMs.current = []; setLiveScale(Math.max(0.35, +(liveScale * 0.8).toFixed(2))); }
    }
  }, [renderer, project, t, mv, fontsReady, playing, ready3D]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!playing) { drawMs.current = []; setLiveScale(baseScale); } }, [playing]);

  // 2.5D layers of the shot on screen (and the next one) are prepared on the fly
  useEffect(() => {
    if (project.look?.parallax === false) return;
    const tl = layoutShots(project);
    const cur = shotAt(tl, t, !!project.aroll);
    const i = cur ? tl.indexOf(cur) : -1;
    for (const ts of [cur, tl[i + 1]]) if (ts?.shot.pageId && !ts.shot.zone && ts.shot.layout === 'full') void ensureLayers(project, ts.shot);
  }, [project, Math.floor(t)]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="screen" ref={screenRef} style={{ width: size.w, height: size.h }}>
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
        <button className={`icon-btn ${loop ? 'active' : ''}`} title="Lecture en boucle" onClick={() => setUI({ loop: !loop })}><Repeat size={17} /></button>
        <button className="icon-btn" title="Plein écran" onClick={() => void screenRef.current?.requestFullscreen?.().catch(() => {})}><Maximize size={17} /></button>
        <button className={`icon-btn ${safe ? 'active' : ''}`} title="Zones de sécurité TikTok (interface de l’appli)"
          onClick={() => { pause(); setUI({ safeZones: !safe }); }} disabled={project.format !== '9:16'}>
          <ShieldCheck size={17} />
        </button>
      </div>
    </div>
  );
}
