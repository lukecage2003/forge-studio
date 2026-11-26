import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AudioWaveform, Crosshair, FileVideo, Headphones, Languages, Play, RotateCcw, ScanLine, Sparkles, Wand2, ZoomIn, ZoomOut, Bot } from 'lucide-react';
import type { ARoll, Cut, Word } from '../types';
import { setUI, useStore } from '../store';
import { getVideo } from '../engine/media';
import { HOP, isFiller, keepSegments, keptShare, segsDuration } from '../engine/speech';
import { addManualCut, cachedAnalysis, detectFace, importRush, roughCut, setAllCuts, setFocus, toggleCut, toggleWords, transcribe, patchRoughSettings, patchAroll } from '../rush';
import { hasGoogle } from '../engine/google';
import { WHISPER_MODELS, type WhisperModel } from '../engine/whisper';
import { faceAt } from '../engine/faces';
import { useMediaVersion } from '../lib/hooks';
import { clamp } from '../lib/util';

const REASON: Record<Cut['reason'], { label: string; cls: string }> = {
  silence: { label: 'Silence', cls: 'r-silence' },
  hesitation: { label: 'Hésitation', cls: 'r-hes' },
  filler: { label: 'Euh', cls: 'r-hes' },
  retake: { label: 'Reprise', cls: 'r-retake' },
  manual: { label: 'Manuel', cls: 'r-manual' },
};

const fmt = (s: number) => {
  const m = Math.floor(s / 60), r = s - m * 60;
  return `${m}:${r.toFixed(2).padStart(5, '0')}`;
};

export function RushEditor() {
  useMediaVersion();
  const ar = useStore((s) => s.project.aroll);
  const busy = useStore((s) => s.ui.busy);
  if (!ar) return <RushEmpty />;
  return <RushWorkspace ar={ar} busy={busy} />;
}

function RushEmpty() {
  const pick = () => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'video/*';
    i.onchange = () => i.files?.[0] && void importRush(i.files[0]);
    i.click();
  };
  return (
    <div className="stage empty">
      <div className="empty-card rush-empty">
        <span className="big-ico"><FileVideo size={26} /></span>
        <h3>Ton rush face caméra</h3>
        <p>Importe la vidéo brute où tu parles. Forge coupe les silences, les « euh » et les reprises, puis alterne ton visage avec les cases.</p>
        <button className="btn primary lg" onClick={pick}><FileVideo size={17} /> Importer le rush</button>
        <span className="muted">MP4, MOV ou WebM · rien n’est envoyé sur internet</span>
      </div>
    </div>
  );
}

function RushWorkspace({ ar, busy }: { ar: ARoll; busy: string | null }) {
  const vid = useRef<HTMLVideoElement>(null);
  const [srcT, setSrcT] = useState(0);
  const [stopAt, setStopAt] = useState<number | null>(null);
  const [filter, setFilter] = useState<Cut['reason'] | 'all' | 'review'>('all');
  const [model, setModel] = useState<WhisperModel>('base');
  const [focusMode, setFocusMode] = useState(false);
  const asset = getVideo(ar.mediaId);
  const segs = useMemo(() => keepSegments(ar), [ar]);
  const kept = segsDuration(segs);

  // keep the clock in sync and honour "listen" ranges
  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    let raf = 0;
    const loop = () => {
      setSrcT(v.currentTime);
      if (stopAt != null && v.currentTime >= stopAt) { v.pause(); setStopAt(null); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [stopAt]);

  const listen = (s: number, e: number) => {
    const v = vid.current;
    if (!v) return;
    v.currentTime = Math.max(0, s);
    setStopAt(e);
    void v.play();
  };
  const seekSrc = (t: number) => { if (vid.current) { vid.current.currentTime = t; setSrcT(t); } };

  const counts = (r: Cut['reason']) => ar.cuts.filter((c) => c.reason === r).length;
  const review = ar.cuts.filter((c) => !c.on && c.reason !== 'silence').length;
  const list = ar.cuts.map((c, i) => ({ c, i })).filter(({ c }) => filter === 'all' || (filter === 'review' ? !c.on : c.reason === filter || (filter === 'hesitation' && c.reason === 'filler')));

  return (
    <div className="stage rush">
      <div className="stage-toolbar">
        <button className="btn sm" onClick={() => void roughCut()} disabled={!!busy} title="Recalcule les coupes avec les réglages actuels (tes coupes manuelles sont gardées)">
          <ScanLine size={15} /> Analyser
        </button>
        <div className="split-btn">
          <button className="btn sm" disabled={!!busy} onClick={() => void transcribe('whisper', model)} title="Transcription sur ton ordinateur (Whisper)">
            <Languages size={15} /> Transcrire
          </button>
          <select className="input sm" value={model} onChange={(e) => setModel(e.target.value as WhisperModel)} aria-label="Modèle Whisper">
            {Object.entries(WHISPER_MODELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <button className="btn sm" disabled={!!busy} onClick={() => void transcribe('ai', model)}
          title="Transcription par l’orchestrateur IA : Groq ou Gemini si tu les as branchés (plus rapide), sinon Whisper sur ton ordinateur">
          <Bot size={15} /> IA auto
        </button>
        <button className="btn sm google" disabled={!!busy} onClick={() => (hasGoogle() ? void transcribe('gemini') : setUI({ settingsOpen: true }))}
          title="Transcription verbatim avec Google Gemini : garde les « euh » pour mieux les couper">
          <Sparkles size={15} /> Google
        </button>
        <div className="toolbar-spacer" />
        <div className="rush-stat">
          <span>{fmt(ar.duration).replace(/\.\d+$/, '')}</span>
          <span className="arrow">→</span>
          <b>{fmt(kept).replace(/\.\d+$/, '')}</b>
          <span className="gain">−{Math.round((1 - kept / Math.max(ar.duration, 0.01)) * 100)} %</span>
        </div>
        <button className="btn sm accent-outline" onClick={() => setUI({ mode: 'preview', playhead: 0 })}>
          <Play size={14} /> Voir le montage
        </button>
      </div>

      <div className="rush-grid">
        <div className="rush-left">
          <div className={`rush-video ${focusMode ? 'focusing' : ''}`}>
            {asset && <video ref={vid} src={asset.url} playsInline preload="auto" onClick={(e) => {
              if (!focusMode) { const v = e.currentTarget; if (v.paused) void v.play(); else v.pause(); return; }
              const r = e.currentTarget.getBoundingClientRect();
              const vw = asset.width, vh = asset.height;
              const k = Math.min(r.width / vw, r.height / vh);
              const ox = (r.width - vw * k) / 2, oy = (r.height - vh * k) / 2;
              setFocus(clamp((e.clientX - r.left - ox) / (vw * k), 0, 1), clamp((e.clientY - r.top - oy) / (vh * k), 0, 1));
              patchAroll({ faceTrack: undefined });
              setFocusMode(false);
            }} />}
            {asset && <FocusMarker ar={ar} t={srcT} />}
            <div className="rush-video-bar">
              <span className="tc">{fmt(srcT)}</span>
              <button className="btn sm ghost" onClick={() => void detectFace()} title="Repère et suit ton visage dans toute la vidéo (local)">
                <ScanLine size={14} /> {ar.faceTrack?.length ? 'Visage suivi ✓' : 'Détecter mon visage'}
              </button>
              <button className={`btn sm ghost ${focusMode ? 'on' : ''}`} onClick={() => setFocusMode(!focusMode)} title="Clique ensuite sur ton visage : les zooms et recadrages se centrent dessus">
                <Crosshair size={14} /> {focusMode ? 'Clique sur ton visage' : 'Centrer sur le visage'}
              </button>
            </div>
          </div>
          <Wave ar={ar} srcT={srcT} onSeek={seekSrc} />
        </div>

        <div className="rush-right">
          <Transcript ar={ar} srcT={srcT} onSeek={seekSrc} segs={segs} />
        </div>
      </div>

      <div className="rush-bottom">
        <div className="cut-list-head">
          <div className="chips">
            <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Tout · {ar.cuts.length}</button>
            {review > 0 && <button className={`chip warn ${filter === 'review' ? 'on' : ''}`} onClick={() => setFilter('review')}>À vérifier · {review}</button>}
            <button className={`chip ${filter === 'silence' ? 'on' : ''}`} onClick={() => setFilter('silence')}>Silences · {counts('silence')}</button>
            <button className={`chip ${filter === 'hesitation' ? 'on' : ''}`} onClick={() => setFilter('hesitation')}>Hésitations · {counts('hesitation') + counts('filler')}</button>
            <button className={`chip ${filter === 'retake' ? 'on' : ''}`} onClick={() => setFilter('retake')}>Reprises · {counts('retake')}</button>
            <button className={`chip ${filter === 'manual' ? 'on' : ''}`} onClick={() => setFilter('manual')}>Manuelles · {counts('manual')}</button>
          </div>
          {filter !== 'all' && filter !== 'review' && filter !== 'manual' && (
            <div className="row-btns">
              <button className="link-btn" onClick={() => setAllCuts(filter, true)}>Tout couper</button>
              <button className="link-btn" onClick={() => setAllCuts(filter, false)}>Tout garder</button>
            </div>
          )}
        </div>
        <div className="cut-list">
          {list.map(({ c, i }) => (
            <div key={i} className={`cut-row ${c.on ? '' : 'off'}`}>
              <span className={`reason ${REASON[c.reason].cls}`}>{REASON[c.reason].label}</span>
              <button className="tc link" onClick={() => seekSrc(c.s)}>{fmt(c.s)}</button>
              <span className="cut-len">{(c.e - c.s).toFixed(2)} s</span>
              <span className="cut-label">{c.label ?? ''}</span>
              <button className="icon-btn sm ghost" title="Écouter autour de la coupe" onClick={() => listen(c.s - 1.2, c.e + 0.8)}><Headphones size={14} /></button>
              <label className="toggle mini" title={c.on ? 'Coupé' : 'Gardé'}>
                <input type="checkbox" checked={c.on} onChange={() => toggleCut(i)} />
                <span className="switch" />
              </label>
            </div>
          ))}
          {!list.length && <p className="muted pad">Aucune coupe dans cette catégorie.</p>}
        </div>
        <RoughSettings ar={ar} />
      </div>
    </div>
  );
}

function FocusMarker({ ar, t }: { ar: ARoll; t: number }) {
  const f = faceAt(ar.faceTrack, t) ?? ar.focus;
  // the marker sits on the video's own picture area (object-fit: contain)
  return <div className="focus-marker" style={{ left: `calc(50% + (${f.x} - 0.5) * min(100%, 100cqh * ${ar.width / ar.height}))`, top: `calc(50% + (${f.y} - 0.5) * min(100%, 100cqw * ${ar.height / ar.width}))` }} aria-hidden="true" />;
}

function RoughSettings({ ar }: { ar: ARoll }) {
  const s = ar.settings;
  return (
    <details className="rough-settings">
      <summary><AudioWaveform size={14} /> Réglages de détection</summary>
      <div className="rough-grid">
        <label className="slider"><span className="slider-top"><span>Sensibilité voix</span><output>{s.threshold} dB</output></span>
          <input type="range" min={6} max={26} step={1} value={s.threshold} style={{ ['--p' as string]: ((s.threshold - 6) / 20) * 100 + '%' }} onChange={(e) => patchRoughSettings({ threshold: +e.target.value })} /></label>
        <label className="slider"><span className="slider-top"><span>Silence coupé dès</span><output>{Math.round(s.minSilence * 1000)} ms</output></span>
          <input type="range" min={0.15} max={1.5} step={0.01} value={s.minSilence} style={{ ['--p' as string]: ((s.minSilence - 0.15) / 1.35) * 100 + '%' }} onChange={(e) => patchRoughSettings({ minSilence: +e.target.value })} /></label>
        <label className="slider"><span className="slider-top"><span>Marge autour de la voix</span><output>{Math.round(s.padding * 1000)} ms</output></span>
          <input type="range" min={0.02} max={0.3} step={0.01} value={s.padding} style={{ ['--p' as string]: ((s.padding - 0.02) / 0.28) * 100 + '%' }} onChange={(e) => patchRoughSettings({ padding: +e.target.value })} /></label>
        <div className="rough-toggles">
          {([['hesitations', 'Hésitations (sons tenus)'], ['fillers', '« Euh » de la transcription'], ['retakes', 'Reprises et faux départs']] as const).map(([k, l]) => (
            <label key={k} className="toggle"><input type="checkbox" checked={s[k]} onChange={(e) => patchRoughSettings({ [k]: e.target.checked })} /><span className="switch" /><span>{l}</span></label>
          ))}
        </div>
        <button className="btn sm" onClick={() => void roughCut()}><RotateCcw size={14} /> Appliquer</button>
      </div>
    </details>
  );
}

/* ------------------------------------------------------------ waveform */

function Wave({ ar, srcT, onSeek }: { ar: ARoll; srcT: number; onSeek: (t: number) => void }) {
  const a = cachedAnalysis(ar.mediaId);
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [pps, setPps] = useState(60);
  const [scroll, setScroll] = useState(0);
  const [vw, setVw] = useState(800);
  const [drag, setDrag] = useState<{ s: number; e: number } | null>(null);
  const H = 92;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVw(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // follow the playhead
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const x = srcT * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - el.clientWidth * 0.3);
  }, [srcT, pps]);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = vw * dpr;
    c.height = H * dpr;
    const x = c.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, vw, H);
    const t0 = scroll / pps, t1 = (scroll + vw) / pps;
    const css = getComputedStyle(c);
    // cuts
    for (const k of ar.cuts) {
      if (k.e < t0 || k.s > t1) continue;
      const x0 = k.s * pps - scroll, x1 = k.e * pps - scroll;
      x.fillStyle = css.getPropertyValue(k.on ? `--cut-${k.reason}` : '--cut-off').trim() || 'rgba(255,90,31,.3)';
      x.fillRect(x0, 0, x1 - x0, H);
      if (!k.on) {
        x.strokeStyle = 'rgba(255,255,255,.35)';
        x.setLineDash([4, 3]);
        x.strokeRect(x0 + 0.5, 0.5, x1 - x0 - 1, H - 1);
        x.setLineDash([]);
      }
    }
    // envelope
    if (a) {
      const lo = a.floor - 3, hi = Math.max(a.speech + 6, lo + 20);
      x.fillStyle = css.getPropertyValue('--wave').trim() || '#bbb';
      for (let px = 0; px < vw; px++) {
        const fa = Math.floor(((px + scroll) / pps) / HOP), fb = Math.max(fa + 1, Math.floor(((px + 1 + scroll) / pps) / HOP));
        let m = -120;
        for (let f = fa; f < fb && f < a.db.length; f++) m = Math.max(m, a.db[f]);
        const v = clamp((m - lo) / (hi - lo), 0, 1);
        const h = Math.max(1, v * (H - 14));
        x.fillRect(px, H / 2 - h / 2, 1, h);
      }
    }
    // seconds
    x.fillStyle = 'rgba(255,255,255,.35)';
    x.font = '10px Inter, sans-serif';
    const step = pps > 120 ? 1 : pps > 40 ? 2 : pps > 15 ? 5 : 15;
    for (let s = Math.ceil(t0 / step) * step; s < t1; s += step) {
      const px = s * pps - scroll;
      x.fillRect(px, H - 6, 1, 6);
      x.fillText(fmt(s).replace(/\.\d+$/, ''), px + 3, H - 2);
    }
    if (drag) {
      const x0 = Math.min(drag.s, drag.e) * pps - scroll, x1 = Math.max(drag.s, drag.e) * pps - scroll;
      x.fillStyle = 'rgba(255,90,31,.35)';
      x.fillRect(x0, 0, x1 - x0, H);
    }
    // playhead
    x.fillStyle = '#fff';
    x.fillRect(srcT * pps - scroll - 0.5, 0, 1.5, H);
  }, [a, ar.cuts, pps, scroll, vw, srcT, drag]);

  const tAt = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    return clamp((clientX - r.left + scroll) / pps, 0, ar.duration);
  };
  const onDown = (e: React.PointerEvent) => {
    const t = tAt(e.clientX);
    const x0 = e.clientX;
    let moved = false;
    (e.target as Element).setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - x0) > 4) moved = true;
      if (moved) setDrag({ s: t, e: tAt(ev.clientX) });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (moved) {
        const t1 = tAt(ev.clientX);
        addManualCut(Math.min(t, t1), Math.max(t, t1));
        return;
      }
      const hit = ar.cuts.findIndex((k) => t >= k.s && t <= k.e);
      if (hit >= 0 && ev.altKey) toggleCut(hit);
      else onSeek(t);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="wave-box">
      <div className="wave-head">
        <span className="legend"><i className="lg-silence" />Silence <i className="lg-hes" />Hésitation <i className="lg-retake" />Reprise <i className="lg-manual" />Manuel <i className="lg-off" />Gardé</span>
        <span className="hint">Glisse pour couper · Alt+clic sur une zone pour la basculer</span>
        <div className="row-btns">
          <button className="icon-btn sm" onClick={() => setPps((p) => clamp(p / 1.5, 4, 600))} title="Dézoomer"><ZoomOut size={14} /></button>
          <button className="icon-btn sm" onClick={() => setPps((p) => clamp(p * 1.5, 4, 600))} title="Zoomer"><ZoomIn size={14} /></button>
        </div>
      </div>
      <div className="wave-scroll" ref={wrap} onScroll={(e) => setScroll(e.currentTarget.scrollLeft)}>
        <div style={{ width: ar.duration * pps, height: H, position: 'relative' }}>
          <canvas ref={cv} className="wave-canvas" style={{ left: scroll, width: vw, height: H }} onPointerDown={onDown} />
        </div>
      </div>
      {!a && <p className="muted pad">Analyse en cours…</p>}
    </div>
  );
}

/* ---------------------------------------------------------- transcript */

function Transcript({ ar, srcT, onSeek, segs }: { ar: ARoll; srcT: number; onSeek: (t: number) => void; segs: ReturnType<typeof keepSegments> }) {
  const [anchor, setAnchor] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const cutAt = (w: Word) => {
    if (keptShare(segs, w.s, w.e) >= 0.4) return undefined;
    const m = (w.s + w.e) / 2;
    const hit = ar.cuts.find((c) => c.on && m >= c.s && m <= c.e);
    if (hit?.reason === 'silence') return undefined; // timing drift, the word itself is kept
    let best: Cut | undefined, bo = 0;
    for (const c of ar.cuts) {
      if (!c.on) continue;
      const o = Math.min(c.e, w.e) - Math.max(c.s, w.s);
      if (o > bo) { bo = o; best = c; }
    }
    return best;
  };
  const activeIdx = ar.words.findIndex((w) => srcT >= w.s && srcT < w.e);

  useEffect(() => {
    const el = box.current?.querySelector('.w.now') as HTMLElement | null;
    if (el && box.current) {
      const b = box.current.getBoundingClientRect(), r = el.getBoundingClientRect();
      if (r.top < b.top || r.bottom > b.bottom) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeIdx]);

  if (!ar.words.length) {
    return (
      <div className="transcript empty">
        <Wand2 size={20} />
        <p><b>Transcris le rush</b> pour éditer au mot près : un clic sur un mot le coupe, Maj+clic coupe une phrase entière.</p>
        <p className="muted">Les silences et les hésitations sont déjà détectés au son, sans transcription.</p>
      </div>
    );
  }
  const click = (i: number, e: React.MouseEvent) => {
    if (e.altKey) { onSeek(ar.words[i].s); return; }
    if (e.shiftKey && anchor != null) {
      const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
      toggleWords(ar.words.slice(a, b + 1));
      setAnchor(null);
      return;
    }
    setAnchor(i);
    toggleWords([ar.words[i]]);
  };
  return (
    <div className="transcript" ref={box}>
      <div className="transcript-head">
        <span>Transcription · {ar.transcriptSource === 'gemini' ? 'Google Gemini' : 'Whisper (local)'}</span>
        <span className="hint">Clic : couper/garder · Maj+clic : plage · Alt+clic : écouter</span>
      </div>
      <p className="words">
        {ar.words.map((w, i) => {
          const c = cutAt(w);
          const filler = w.filler || isFiller(w.w);
          return (
            <span key={i}
              className={`w ${c ? 'cut ' + REASON[c.reason].cls : ''} ${filler ? 'filler' : ''} ${i === activeIdx ? 'now' : ''} ${anchor === i ? 'anchor' : ''}`}
              onClick={(e) => click(i, e)} title={`${fmt(w.s)} → ${fmt(w.e)}`}>
              {w.w}{' '}
            </span>
          );
        })}
      </p>
    </div>
  );
}
