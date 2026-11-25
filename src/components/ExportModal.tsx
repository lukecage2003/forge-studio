import { useRef, useState } from 'react';
import { Download, X, Captions, ImageDown, Loader2, CheckCircle2, ListOrdered } from 'lucide-react';
import { FORMATS } from '../types';
import { getState, setUI, useStore } from '../store';
import { download, exportMp4, exportSrt, youtubeChapters } from '../engine/export';
import { toast } from './Toast';
import { checkProject } from '../engine/qc';
import { update } from '../store';
import { AlertTriangle, XCircle, CheckCheck } from 'lucide-react';
import { createRenderer, loadFonts } from '../engine/render';
import { videoDuration } from '../engine/timeline';
import { pause } from '../engine/transport';
import { fmtShort } from '../lib/util';
import { exportSize, type SyncCheck } from '../engine/export';
import type { MixInfo } from '../engine/audio';
import { FileCheck2, Clapperboard } from 'lucide-react';

export function ExportModal() {
  const project = useStore((s) => s.project);
  const [quality, setQuality] = useState<'high' | 'max'>('high');
  const [fps, setFps] = useState(30);
  const [scale, setScale] = useState<1 | 2>(1);
  const [burn, setBurn] = useState(true);
  const [sync, setSync] = useState<SyncCheck | null>(null);
  const [mixInfo, setMixInfo] = useState<MixInfo | null>(null);
  const [side, setSide] = useState<string | null>(null);
  const mix = project.mix ?? { voiceClean: true, target: -14 };
  const setMix = (m: Partial<typeof mix>) => update((x) => ({ ...x, mix: { ...mix, ...m } }));
  const size = exportSize(project.format, scale);
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
        quality, fps, scale, burnSubtitles: burn, onCheck: setSync, signal: abort.current.signal, onMix: setMixInfo,
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
              <p>{f.label} · {size.W}×{size.H} · {fmtShort(dur)} · {f.hint}</p>
            </div>
          </div>
          <button className="icon-btn ghost" onClick={close} aria-label="Fermer"><X size={18} /></button>
        </header>

        {!result && !prog && <QualityCheck />}

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
              <label>Définition</label>
              <div className="seg full">
                <button className={scale === 1 ? 'on' : ''} onClick={() => setScale(1)} disabled={busy}>1080p · recommandé</button>
                <button className={scale === 2 ? 'on' : ''} onClick={() => setScale(2)} disabled={busy}>4K · rendu 4 fois plus long</button>
              </div>
            </div>
            <div className="field">
              <label>Volume</label>
              <div className="seg full">
                <button className={mix.target === -14 ? 'on' : ''} onClick={() => setMix({ target: -14 })} disabled={busy} title="Niveau de YouTube, TikTok et Instagram">−14 LUFS · réseaux</button>
                <button className={mix.target === -16 ? 'on' : ''} onClick={() => setMix({ target: -16 })} disabled={busy}>−16 LUFS · plus doux</button>
                <button className={mix.target == null ? 'on' : ''} onClick={() => setMix({ target: null })} disabled={busy}>Tel quel</button>
              </div>
            </div>
            <div className="field">
              <label>Réduction du bruit de la voix</label>
              <div className="seg full">
                {([['auto', 'Auto · selon la prise'], ['light', 'Légère'], ['strong', 'Forte'], ['off', 'Aucune']] as const).map(([v, l]) => (
                  <button key={v} className={(mix.denoise ?? 'auto') === v ? 'on' : ''} onClick={() => setMix({ denoise: v })} disabled={busy}>{l}</button>
                ))}
              </div>
            </div>
            <label className="toggle">
              <input type="checkbox" checked={mix.voiceClean} onChange={(e) => setMix({ voiceClean: e.target.checked })} disabled={busy} />
              <span className="switch" /><span>Voix prioritaire<small>Coupe les graves parasites, égalise la voix, baisse musique et bruitages quand tu parles</small></span>
            </label>
            {project.subtitles.length > 0 && (
              <label className="toggle">
                <input type="checkbox" checked={burn} onChange={(e) => setBurn(e.target.checked)} disabled={busy} />
                <span className="switch" /><span>Sous-titres incrustés dans l’image<small>Sinon, livre-les à part (.srt ou .ass ci-dessous) et ajoute-les sur la plateforme</small></span>
              </label>
            )}
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
            {sync && (
              <p className={sync.ok ? 'muted' : 'error-box'}>
                {sync.ok ? 'Son et image synchronisés' : 'Attention : son et image désynchronisés'} · image {sync.video.toFixed(2)} s{sync.audio != null ? ` · son ${sync.audio.toFixed(2)} s · décalage au départ ${(sync.startGap * 1000).toFixed(0)} ms` : ' · pas de son'}
              </p>
            )}
            {mixInfo && Number.isFinite(mixInfo.after) && (
              <p className="muted">Volume : {mixInfo.after.toFixed(1)} LUFS{mixInfo.target != null && Number.isFinite(mixInfo.before) ? ` (était ${mixInfo.before.toFixed(1)})` : ''} · crête {mixInfo.peakDb.toFixed(1)} dBFS</p>
            )}
          </div>
        )}

        <footer className="modal-foot">
          <div className="foot-extra">
            <button className="btn sm ghost" onClick={() => download(new Blob([exportSrt(project)], { type: 'text/plain' }), `${fileBase}.srt`)}
              disabled={!project.shots.some((s) => s.caption.text.trim())} title="Fichier de sous-titres pour YouTube">
              <Captions size={15} /> Sous-titres .srt
            </button>
            <button className="btn sm ghost" title="Chapitres pour la description YouTube (couvertures, schémas, cartons)"
              onClick={async () => {
                const ch = youtubeChapters(getState().project);
                if (!ch) { toast('Il faut au moins 3 chapitres espacés de 10 s (couvertures, schémas ou cartons titres).', 'error'); return; }
                try { await navigator.clipboard.writeText(ch); toast('Chapitres copiés : colle-les dans la description YouTube'); }
                catch { download(new Blob([ch], { type: 'text/plain' }), `${fileBase}-chapitres.txt`); }
              }}>
              <ListOrdered size={15} /> Chapitres YouTube
            </button>
            <button className="btn sm ghost" disabled={!project.subtitles.length} title="Sous-titres animés mot à mot (karaoké), mots-clés en couleur : DaVinci, VLC, FFmpeg"
              onClick={async () => {
                const [{ exportAss }, { keywordsOf, keyToken }] = await Promise.all([import('../engine/export'), import('../engine/scriptIntel')]);
                const pr = getState().project;
                const keys = pr.subtitleStyle.keywords === false ? undefined : keywordsOf(pr.subtitles.map((x) => x.text), pr.shots.flatMap((x) => x.chars ?? []));
                download(new Blob([exportAss(pr, keys, keyToken)], { type: 'text/plain' }), `${fileBase}.ass`);
              }}>
              <Captions size={15} /> Sous-titres .ass
            </button>
            <button className="btn sm ghost" disabled={!!side || busy} title="Rythme, effets, volume mesuré, sous-titres, zones sûres : une page à garder"
              onClick={async () => {
                setSide('Mesure du volume…');
                try {
                  const pr = getState().project;
                  const [{ buildReport, reportHtml }, { masterMix }] = await Promise.all([import('../engine/report'), import('../engine/audio')]);
                  const { ensureMedia } = await import('../engine/media');
                  await Promise.all(pr.audio.map((a) => ensureMedia(a.mediaId, 'audio')));
                  const hasSound = pr.audio.length > 0 || !!pr.aroll;
                  const info = hasSound ? (await masterMix(pr, Math.max(0.5, videoDuration(pr)))).info : null;
                  const r = buildReport(pr, info);
                  download(new Blob([reportHtml(r)], { type: 'text/html' }), `${fileBase}-controle-qualite.html`);
                  toast(`Rapport qualité : ${r.score} / 100`);
                } catch (e) { toast('Rapport impossible : ' + (e as Error).message, 'error'); }
                setSide(null);
              }}>
              {side?.startsWith('Mesure') ? <Loader2 size={15} className="spin" /> : <FileCheck2 size={15} />} Rapport qualité
            </button>
            <button className="btn sm ghost" disabled={!!side || busy || !project.shots.length} title="Timeline OpenTimelineIO + médias, à ouvrir dans DaVinci Resolve"
              onClick={async () => {
                setSide('Préparation…');
                try {
                  const pr = getState().project;
                  const { exportOtioBundle } = await import('../engine/otio');
                  download(await exportOtioBundle(pr, exportSrt(pr)), `${fileBase}-davinci.zip`);
                  toast('Montage exporté : ouvre timeline.otio dans DaVinci Resolve');
                } catch (e) { toast('Export impossible : ' + (e as Error).message, 'error'); }
                setSide(null);
              }}>
              {side?.startsWith('Prép') ? <Loader2 size={15} className="spin" /> : <Clapperboard size={15} />} DaVinci (.otio)
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

function QualityCheck() {
  const project = useStore((s) => s.project);
  const issues = checkProject(project);
  if (!issues.length) return <p className="qc-ok"><CheckCheck size={15} /> Contrôle qualité : tout est bon.</p>;
  return (
    <div className="qc">
      <span className="qc-title">Contrôle qualité · {issues.length} point{issues.length > 1 ? 's' : ''}</span>
      {issues.map((i, k) => (
        <div key={k} className={`qc-row ${i.level}`}>
          {i.level === 'error' ? <XCircle size={15} /> : <AlertTriangle size={15} />}
          <span>{i.text}</span>
          {i.fix && <button className="btn sm" onClick={() => update(i.fix!.apply)}>{i.fix.label}</button>}
        </div>
      ))}
    </div>
  );
}
