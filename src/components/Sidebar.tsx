import { useRef, useState } from 'react';
import { ImagePlus, Mic, Music2, Square, Type, Volume2, AudioLines, Trash2, FileVideo, Eye, EyeOff, Network, Orbit, ScrollText } from 'lucide-react';
import { getImage } from '../engine/media';
import { useMediaVersion } from '../lib/hooks';
import { setUI, useStore } from '../store';
import { addDiagram, addTitleCard, analyzeComics, classifyWithGoogle, researchComics, importAudioFiles, importPages, removePage, setPageKind, togglePageSkip } from '../actions';
import { PAGE_KINDS, type PageKind } from '../types';
import { hasGoogle } from '../engine/google';
import { importRush } from '../rush';
import { keepSegments, segsDuration } from '../engine/speech';
import type { AudioKind } from '../types';
import { toast } from './Toast';

export function Sidebar() {
  useMediaVersion();
  const pages = useStore((s) => s.project.pages);
  const shots = useStore((s) => s.project.shots);
  const active = useStore((s) => s.ui.activePageId);
  const pageRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const [audioKind, setAudioKind] = useState<AudioKind>('music');

  const pickAudio = (k: AudioKind) => {
    setAudioKind(k);
    setTimeout(() => audioRef.current?.click());
  };

  return (
    <aside className="sidebar">
      <RushCard />
      <section className="side-section grow">
        <div className="side-head">
          <h2>Planches</h2>
          {pages.length > 0 && hasGoogle() && (
            <button className="link-btn" onClick={() => void classifyWithGoogle()} title="Google vérifie le type de chaque page (couverture, pub, texte…)">Classer avec Google</button>
          )}
          <span className="count">{pages.length}</span>
        </div>
        <button className="btn block" onClick={() => pageRef.current?.click()}>
          <ImagePlus size={16} /> Importer des planches
        </button>
        <input ref={pageRef} type="file" accept="image/*,.pdf,.cbz,.zip,application/pdf" multiple hidden
          onChange={(e) => { void importPages([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <div className="page-list">
          {pages.map((pg, i) => {
            const a = getImage(pg.mediaId);
            const n = shots.filter((s) => s.pageId === pg.id).length;
            return (
              <div
                key={pg.id}
                role="button"
                tabIndex={0}
                className={`page-item ${active === pg.id ? 'on' : ''} ${pg.skip ? 'skipped' : ''}`}
                onClick={() => setUI({ activePageId: pg.id, mode: 'cut', selection: { kind: 'page', id: pg.id } })}
                onKeyDown={(e) => e.key === 'Enter' && setUI({ activePageId: pg.id, mode: 'cut' })}
              >
                <div className="page-thumb">{a && <img src={a.url} alt="" draggable={false} />}</div>
                <div className="page-meta">
                  <span className="page-num">P.{String(i + 1).padStart(2, '0')}</span>
                  <span className="page-name" title={pg.name}>{pg.name}</span>
                  {pg.kind && (
                    <select className={`kind-chip k-${pg.kind}`} value={pg.kind} title={`Type de page${pg.kindWhy ? ' · ' + pg.kindWhy : ''}`}
                      onClick={(e) => e.stopPropagation()} onChange={(e) => setPageKind(pg.id, e.target.value as PageKind)}>
                      {(Object.keys(PAGE_KINDS) as PageKind[]).map((k) => <option key={k} value={k}>{PAGE_KINDS[k].label}</option>)}
                    </select>
                  )}
                  <span className="page-shots">{pg.skip ? 'exclue du montage' : `${n} ${pg.cut === 'zones' ? 'zones' : pg.cut === 'splash' ? 'pleine page' : n > 1 ? 'cases' : 'case'}`}</span>
                </div>
                <button className="icon-btn ghost sm" title={pg.skip ? 'Inclure dans le montage' : 'Exclure du montage (pub, crédits…)'}
                  onClick={(e) => { e.stopPropagation(); togglePageSkip(pg.id); }}>
                  {pg.skip ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button className="icon-btn ghost sm" title="Retirer la planche"
                  onClick={(e) => { e.stopPropagation(); if (confirm('Retirer cette planche et ses cases ?')) removePage(pg.id); }}>
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
          {!pages.length && <p className="empty-hint">Glisse tes planches (PDF, CBZ, JPG, PNG) n’importe où dans la fenêtre.</p>}
        </div>
        {pages.length > 0 && (
          <div className="read-box">
            <span>Lire les comics</span>
            <button className="btn sm ghost" onClick={() => void analyzeComics('local')} title="Lit le texte des bulles sur ton ordinateur (OCR)">Bulles (local)</button>
            <button className="btn sm google" disabled={!hasGoogle()} onClick={() => void analyzeComics('google')} title="Google décrit chaque page et chaque case : personnages, action, dialogues">Google</button>
            <button className="btn sm google" disabled={!hasGoogle()} onClick={() => void researchComics()} title="Recherche web : identifie le numéro, les personnages (et leurs autres noms), le résumé">Recherche</button>
          </div>
        )}
        <div className="two-btns">
          <button className="btn ghost" onClick={() => addTitleCard()}><Type size={15} /> Carton titre</button>
          <button className="btn ghost" onClick={() => addDiagram('timeline')} title="Frise, réseau de personnages, duel ou classement, avec tes cases"><Network size={15} /> Schéma</button>
        </div>
        <button className="btn ghost block" onClick={() => setUI({ scriptOpen: true })} title="Rôles des passages, personnages, dates, lieux, concepts, et les visuels à préparer"><ScrollText size={15} /> Analyser le script</button>
        <button className="btn ghost block" onClick={() => addDiagram('orbit')} title="Tes cases dans l’espace : orbite, cosmos ou paliers de puissance (3D)"><Orbit size={15} /> Scène 3D</button>
      </section>

      <section className="side-section">
        <div className="side-head"><h2>Audio</h2></div>
        <div className="audio-grid">
          <button className="tile" onClick={() => pickAudio('music')}><Music2 size={18} /><span>Musique</span></button>
          <button className="tile" onClick={() => pickAudio('voice')}><AudioLines size={18} /><span>Voix off</span></button>
          <button className="tile" onClick={() => pickAudio('sfx')}><Volume2 size={18} /><span>Bruitage</span></button>
          <Recorder />
        </div>
        <input ref={audioRef} type="file" accept="audio/*,video/mp4" multiple hidden
          onChange={(e) => { void importAudioFiles(audioKind, [...(e.target.files ?? [])]).catch((er) => toast('Audio illisible : ' + er.message, 'error')); e.target.value = ''; }} />
      </section>
    </aside>
  );
}

function Recorder() {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [t, setT] = useState(0);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const t0 = Date.now();
      const iv = setInterval(() => setT((Date.now() - t0) / 1000), 200);
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        clearInterval(iv);
        stream.getTracks().forEach((x) => x.stop());
        setRec(null);
        setT(0);
        const blob = new Blob(chunks, { type: r.mimeType });
        await importAudioFiles('voice', [blob], [`Voix ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`]);
        toast('Voix off ajoutée à la tête de lecture');
      };
      r.start();
      setRec(r);
    } catch {
      toast('Micro inaccessible : autorise-le dans ton navigateur.', 'error');
    }
  };
  return rec ? (
    <button className="tile rec" onClick={() => rec.stop()}>
      <Square size={16} fill="currentColor" /><span>{t.toFixed(1)} s</span>
    </button>
  ) : (
    <button className="tile" onClick={start} title="Enregistre ta voix au micro, posée à la tête de lecture">
      <Mic size={18} /><span>Enregistrer</span>
    </button>
  );
}

function RushCard() {
  const ar = useStore((s) => s.project.aroll);
  const ref = useRef<HTMLInputElement>(null);
  const kept = ar ? segsDuration(keepSegments(ar)) : 0;
  const fmt = (x: number) => `${Math.floor(x / 60)}:${String(Math.round(x % 60)).padStart(2, '0')}`;
  return (
    <section className="side-section">
      <div className="side-head"><h2>Rush face caméra</h2></div>
      {ar ? (
        <button className="rush-card" onClick={() => setUI({ mode: 'rush', selection: { kind: 'aroll' } })}>
          <span className="rush-ico"><FileVideo size={18} /></span>
          <span className="page-meta">
            <span className="page-name" title={ar.name}>{ar.name}</span>
            <span className="page-shots">{fmt(ar.duration)} → <b>{fmt(kept)}</b> · {ar.cuts.filter((c) => c.on).length} coupes</span>
          </span>
        </button>
      ) : (
        <button className="btn block" onClick={() => ref.current?.click()}><FileVideo size={16} /> Importer le rush</button>
      )}
      <input ref={ref} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importRush(f); e.target.value = ''; }} />
    </section>
  );
}
