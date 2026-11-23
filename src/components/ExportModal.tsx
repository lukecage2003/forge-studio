import { useRef, useState } from 'react';
import { Download, X, Captions, ImageDown, Loader2, CheckCircle2 } from 'lucide-react';
import { FORMATS } from '../types';
import { getState, setUI, useStore } from '../store';
import { download, exportMp4, exportSrt } from '../engine/export';
import { createRenderer, loadFonts } from '../engine/render';
import { videoDuration } from '../engine/timeline';
import { pause } from '../engine/transport';
import { fmtShort } from '../lib/util';

export function ExportModal() {
  const project = useStore((s) => s.project);
  const [quality, setQuality] = useState<'high' | 'max'>('high');
  const [fps, setFps] = useState(30);
  const [prog, setProg] = useState<{ p: number; label: string } | null>(null);
  const [result, setResult] = useState<{ url: string; size: number; blob: Blob } | null>(null);
  const [err, setErr] = useState('');
  const abort = useRef<AbortController | null>(null);
  const f = FORMATS[project.format];
  const dur = videoDuration(project);
  const busy = !!prog && !result;
  const fileBase = (project.name || 'forge').replace(/[^\w\- ]+/g, '').trim() || 'forge';

  const close = () => {
    abort.current?.abort();
    if (result) URL.revokeObjectURL(result.url);
    setUI({ exportOpen: false });
  };

  const run = async () => {
    pause();
    setErr('');
    setResult(null);
    abort.current = new AbortController();
    const t0 = performance.now();
    try {
      const blob = await exportMp4(getState().project, {
        quality, fps, signal: abort.current.signal,
        onProgress: (p, label) => setProg({ p, label }),
      });
      setResult({ url: URL.createObjectURL(blob), size: blob.size, blob });
      setProg({ p: 1, label: `Rendu en ${((performance.now() - t0) / 1000).toFixed(1)} s` });
    } catch (e) {
      setProg(null);
      if ((e as Error).name !== 'AbortError') setErr((e as Error).message);
    }
  };

  const thumb = async () => {
    await loadFonts();
    const { w, h } = f;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    createRenderer(w, h).draw(c.getContext('2d')!, getState().project, getState().ui.playhead);
    c.toBlob((b) => b && download(b, `${fileBase}-miniature.png`), 'image/png');
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && close()}>
      <div className="modal export-modal" role="dialog" aria-labelledby="exp-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><Download size={18} /></span>
            <div>
              <h2 id="exp-title">Exporter</h2>
              <p>{f.label} · {f.w}×{f.h} · {fmtShort(dur)} · {f.hint}</p>
            </div>
          </div>
          <button className="icon-btn ghost" onClick={close} aria-label="Fermer"><X size={18} /></button>
        </header>

        {!result && (
          <>
            <div className="field">
              <label>Qualité</label>
              <div className="seg full">
                <button className={quality === 'high' ? 'on' : ''} onClick={() => setQuality('high')} disabled={busy}>Haute · recommandé</button>
                <button className={quality === 'max' ? 'on' : ''} onClick={() => setQuality('max')} disabled={busy}>Maximale</button>
              </div>
            </div>
            <div className="field">
              <label>Images par seconde</label>
              <div className="seg full">
                {[24, 30, 60].map((v) => (
                  <button key={v} className={fps === v ? 'on' : ''} onClick={() => setFps(v)} disabled={busy}>{v} i/s</button>
                ))}
              </div>
            </div>
          </>
        )}

        {prog && (
          <div className="progress-wrap">
            <div className="progress"><div style={{ width: `${prog.p * 100}%` }} /></div>
            <div className="progress-label">
              {result ? <CheckCircle2 size={15} className="ok" /> : <Loader2 size={15} className="spin" />}
              <span>{prog.label}</span>
              <span className="muted">{Math.round(prog.p * 100)} %</span>
            </div>
          </div>
        )}
        {err && <p className="error-box">{err}</p>}

        {result && (
          <div className="result">
            <video src={result.url} controls playsInline className={`result-video r${project.format.replace(':', '-')}`} />
            <p className="muted">MP4 · {(result.size / 1048576).toFixed(1)} Mo — prêt pour TikTok, Shorts et YouTube.</p>
          </div>
        )}

        <footer className="modal-foot">
          <div className="foot-extra">
            <button className="btn sm ghost" onClick={() => download(new Blob([exportSrt(project)], { type: 'text/plain' }), `${fileBase}.srt`)}
              disabled={!project.shots.some((s) => s.caption.text.trim())} title="Fichier de sous-titres pour YouTube">
              <Captions size={15} /> Sous-titres .srt
            </button>
            <button className="btn sm ghost" onClick={thumb} title="Image de l’instant affiché, en pleine définition">
              <ImageDown size={15} /> Miniature .png
            </button>
          </div>
          {result ? (
            <button className="btn primary lg" onClick={() => download(result.blob, `${fileBase}-${project.format.replace(':', 'x')}.mp4`)}>
              <Download size={17} /> Télécharger le MP4
            </button>
          ) : busy ? (
            <button className="btn lg" onClick={() => abort.current?.abort()}>Annuler</button>
          ) : (
            <button className="btn primary lg" onClick={run} disabled={!project.shots.length}>
              <Download size={17} /> Exporter en MP4
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
