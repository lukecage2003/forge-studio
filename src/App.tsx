import { useEffect, useState } from 'react';
import { Scissors, MonitorPlay, Upload, Wand2, ImagePlus, Download } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { PageEditor } from './components/PageEditor';
import { Preview } from './components/Preview';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
import { ExportModal } from './components/ExportModal';
import { AutoModal } from './components/AutoModal';
import { Toasts, toast } from './components/Toast';
import { getState, loadProject, redo, setUI, undo, useStore } from './store';
import { deleteSelection, importAudioFiles, importPages } from './actions';
import { idb } from './lib/db';
import { ensureMedia } from './engine/media';
import { seek, toggle } from './engine/transport';
import type { Project } from './types';
import { Mark } from './brand/Logo';

export default function App() {
  const mode = useStore((s) => s.ui.mode);
  const exportOpen = useStore((s) => s.ui.exportOpen);
  const autoOpen = useStore((s) => s.ui.autoOpen);
  const hasPages = useStore((s) => s.project.pages.length > 0);
  const [dragging, setDragging] = useState(false);
  const [booted, setBooted] = useState(false);

  // restore last session
  useEffect(() => {
    (async () => {
      try {
        const p = await idb.get<Project>('projects', 'current');
        if (p?.pages) {
          await Promise.allSettled([
            ...p.pages.map((x) => ensureMedia(x.mediaId, 'image')),
            ...p.audio.map((x) => ensureMedia(x.mediaId, 'audio')),
          ]);
          loadProject(p);
        }
      } catch { /* first run */ }
      setBooted(true);
    })();
  }, []);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      const { ui, project } = getState();
      if (ui.exportOpen || ui.autoOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.code === 'Space') { e.preventDefault(); toggle(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(ui.playhead - (e.shiftKey ? 1 : 1 / project.fps)); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(ui.playhead + (e.shiftKey ? 1 : 1 / project.fps)); return; }
      if (e.key === 'Escape') setUI({ selection: null });
      if (e.key.toLowerCase() === 'a' && !mod) setUI({ autoOpen: true });
      if (e.key === '1') setUI({ mode: 'cut' });
      if (e.key === '2') setUI({ mode: 'preview' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // drag & drop anywhere
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { depth++; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (e: DragEvent) => e.preventDefault();
    const dropH = async (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      const imgs = files.filter((f) => f.type.startsWith('image/'));
      const auds = files.filter((f) => f.type.startsWith('audio/'));
      if (imgs.length) await importPages(imgs);
      const voices = auds.filter((f) => /voix|voice|vo[ _-]|narr|record|enreg/i.test(f.name));
      const music = auds.filter((f) => !voices.includes(f));
      try {
        if (voices.length) await importAudioFiles('voice', voices);
        if (music.length) await importAudioFiles('music', music);
      } catch (er) {
        toast('Audio illisible : ' + (er as Error).message, 'error');
      }
      if (!imgs.length && !auds.length && files.length) toast('Format non pris en charge : images ou audio uniquement.', 'error');
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', dropH);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', dropH);
    };
  }, []);

  if (!booted) {
    return <div className="boot"><Mark size={56} /></div>;
  }

  return (
    <div className="app">
      <TopBar />
      <div className="workspace">
        <Sidebar />
        <main className="center">
          <div className="mode-tabs" role="tablist">
            <button role="tab" aria-selected={mode === 'cut'} className={mode === 'cut' ? 'on' : ''} onClick={() => setUI({ mode: 'cut' })}>
              <Scissors size={15} /> Découpe
            </button>
            <button role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'on' : ''} onClick={() => setUI({ mode: 'preview' })}>
              <MonitorPlay size={15} /> Aperçu
            </button>
          </div>
          {!hasPages ? <Welcome /> : mode === 'cut' ? <PageEditor /> : <Preview />}
        </main>
        <Inspector />
      </div>
      <Timeline />
      {exportOpen && <ExportModal />}
      {autoOpen && <AutoModal onClose={() => setUI({ autoOpen: false })} />}
      {dragging && (
        <div className="drop-overlay">
          <div><Upload size={36} /><strong>Dépose tes fichiers</strong><span>Planches → cases détectées · Audio → musique ou voix off</span></div>
        </div>
      )}
      <Toasts />
    </div>
  );
}

function Welcome() {
  const pick = () => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = 'image/*';
    i.multiple = true;
    i.onchange = () => void importPages([...(i.files ?? [])]);
    i.click();
  };
  return (
    <div className="stage welcome">
      <div className="welcome-card">
        <Mark size={64} />
        <h1>Tes comics, en vidéos qui retiennent.</h1>
        <p>Forge transforme tes planches en vidéos rythmées pour TikTok, Shorts et YouTube : découpe des cases, caméra, sous-titres, musique, export MP4.</p>
        <button className="btn primary lg" onClick={pick}><ImagePlus size={18} /> Importer des planches</button>
        <span className="muted">ou glisse-les n’importe où dans la fenêtre</span>
        <ol className="steps">
          <li><span><ImagePlus size={16} /></span><div><b>Importe</b><small>Les cases sont détectées automatiquement</small></div></li>
          <li><span><Wand2 size={16} /></span><div><b>Montage auto</b><small>Caméra, rythme, transitions, calage sur le beat</small></div></li>
          <li><span><Download size={16} /></span><div><b>Exporte</b><small>MP4 9:16 ou 16:9, sous-titres .srt</small></div></li>
        </ol>
      </div>
    </div>
  );
}
