import { useEffect, useRef, useState } from 'react';
import { Music2, X, Play, Square, Trash2, Plus, Loader2, Wand2 } from 'lucide-react';
import { getState, setUI, update, useStore } from '../store';
import { analyseTrack, deleteTrack, listTracks, MOOD_FR, pickTrack, saveTrack, withMusic, type Mood, type Track } from '../engine/library';
import { importAudio, mediaBlob } from '../engine/media';
import { videoDuration } from '../engine/timeline';
import { uid } from '../lib/util';
import { toast } from './Toast';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** the user's music, analysed once, mixed into the edit at the right level */
export function LibraryModal() {
  const [tracks, setTracks] = useState<Track[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const profile = useStore((s) => s.project.direction?.profile);
  const current = useStore((s) => s.project.audio.find((c) => c.kind === 'music')?.mediaId);
  const reload = () => listTracks().then(setTracks).catch(() => setTracks([]));
  useEffect(() => { void reload(); return () => audio.current?.pause(); }, []);
  const close = () => { audio.current?.pause(); setUI({ libraryOpen: false }); };

  const add = async (files: File[]) => {
    for (const [i, f] of files.entries()) {
      setBusy(`Analyse ${i + 1}/${files.length} : ${f.name}`);
      try {
        const { id, buffer } = await importAudio(f);
        const a = analyseTrack(buffer);
        await saveTrack({ id: uid('t_'), name: f.name.replace(/\.[^.]+$/, ''), mediaId: id, tags: [], added: new Date().toISOString(), ...a });
      } catch (e) { toast(`${f.name} : ${(e as Error).message}`, 'error'); }
    }
    setBusy(null);
    void reload();
  };
  const listen = async (t: Track) => {
    audio.current?.pause();
    if (playing === t.id) { setPlaying(null); return; }
    const b = await mediaBlob(t.mediaId);
    if (!b) return toast('Fichier introuvable', 'error');
    audio.current = new Audio(URL.createObjectURL(b));
    audio.current.currentTime = Math.min(30, t.duration * 0.3);
    void audio.current.play();
    setPlaying(t.id);
  };
  const use = (t: Track) => {
    const len = videoDuration(getState().project);
    if (len <= 0) return toast('Monte d’abord la vidéo : la musique se cale sur sa durée.', 'error');
    update((p) => withMusic(p, t, len), 'music');
    toast(`« ${t.name} » mixée : niveau calé sur sa mesure (${t.lufs.toFixed(1)} LUFS), baissée sous la voix, ${t.duration < len ? 'bouclée sur les mesures, ' : ''}fondu final.`);
  };
  const setMood = (t: Track, mood: Mood) => { void saveTrack({ ...t, mood }).then(reload); };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal library-modal" role="dialog" aria-labelledby="lib-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><Music2 size={18} /></span>
            <div><h2 id="lib-title">Bibliothèque musicale</h2><p>Tes musiques, gardées d’un projet à l’autre. Volume, tempo et ambiance mesurés à l’ajout.</p></div>
          </div>
          <button className="icon-btn ghost" onClick={close} aria-label="Fermer"><X size={18} /></button>
        </header>
        <input ref={input} type="file" accept="audio/*" multiple hidden onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <div className="row-btns gap">
          <button className="btn sm primary" onClick={() => input.current?.click()} disabled={!!busy}><Plus size={14} /> Ajouter des musiques</button>
          <button className="btn sm" disabled={!tracks?.length || !!busy} onClick={() => { const t = pickTrack(tracks!, profile, videoDuration(getState().project)); if (t) use(t); }}><Wand2 size={14} /> Choisir pour ce montage</button>
          {busy && <span className="muted"><Loader2 size={13} className="spin" /> {busy}</span>}
        </div>
        {!tracks ? <p className="muted">Chargement…</p> : !tracks.length ? <p className="muted">Aucune musique : ajoute tes fichiers (MP3, WAV, M4A, OGG). Utilise des musiques dont tu as les droits (bibliothèque de la plateforme, libres de droits).</p> : (
          <table className="ai-table">
            <thead><tr><th></th><th>Titre</th><th>Ambiance</th><th>Tempo</th><th>Volume</th><th>Durée</th><th></th></tr></thead>
            <tbody>
              {tracks.map((t) => (
                <tr key={t.id} className={current === t.mediaId ? 'on' : ''}>
                  <td><button className="icon-btn sm ghost" onClick={() => void listen(t)} aria-label="Écouter">{playing === t.id ? <Square size={13} /> : <Play size={13} />}</button></td>
                  <td><b>{t.name}</b>{current === t.mediaId && <small>dans ce montage</small>}</td>
                  <td><select className="input sm" value={t.mood} onChange={(e) => setMood(t, e.target.value as Mood)}>{(Object.keys(MOOD_FR) as Mood[]).map((m) => <option key={m} value={m}>{MOOD_FR[m]}</option>)}</select></td>
                  <td>{t.bpm ? `${t.bpm} BPM` : '—'}</td>
                  <td>{t.lufs.toFixed(1)} LUFS</td>
                  <td>{fmt(t.duration)}</td>
                  <td className="row-btns"><button className="btn sm" onClick={() => use(t)}>Utiliser</button><button className="icon-btn sm ghost danger" onClick={() => { void deleteTrack(t.id).then(reload); }} aria-label="Retirer"><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
