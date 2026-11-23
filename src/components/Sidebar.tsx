import { useRef, useState } from 'react';
import { ImagePlus, Mic, Music2, Square, Type, Volume2, AudioLines, Trash2 } from 'lucide-react';
import { getImage } from '../engine/media';
import { useMediaVersion } from '../lib/hooks';
import { setUI, useStore } from '../store';
import { addTitleCard, importAudioFiles, importPages, removePage } from '../actions';
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
      <section className="side-section grow">
        <div className="side-head">
          <h2>Planches</h2>
          <span className="count">{pages.length}</span>
        </div>
        <button className="btn block" onClick={() => pageRef.current?.click()}>
          <ImagePlus size={16} /> Importer des planches
        </button>
        <input ref={pageRef} type="file" accept="image/*" multiple hidden
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
                className={`page-item ${active === pg.id ? 'on' : ''}`}
                onClick={() => setUI({ activePageId: pg.id, mode: 'cut', selection: { kind: 'page', id: pg.id } })}
                onKeyDown={(e) => e.key === 'Enter' && setUI({ activePageId: pg.id, mode: 'cut' })}
              >
                <div className="page-thumb">{a && <img src={a.url} alt="" draggable={false} />}</div>
                <div className="page-meta">
                  <span className="page-num">P.{String(i + 1).padStart(2, '0')}</span>
                  <span className="page-name" title={pg.name}>{pg.name}</span>
                  <span className="page-shots">{n} case{n > 1 ? 's' : ''}</span>
                </div>
                <button className="icon-btn ghost sm" title="Retirer la planche"
                  onClick={(e) => { e.stopPropagation(); if (confirm('Retirer cette planche et ses cases ?')) removePage(pg.id); }}>
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
          {!pages.length && <p className="empty-hint">Glisse tes planches (JPG, PNG, WebP) n’importe où dans la fenêtre.</p>}
        </div>
        <button className="btn ghost block" onClick={() => addTitleCard()}>
          <Type size={16} /> Ajouter un carton titre
        </button>
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
