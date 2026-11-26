import { lazy, Suspense, useEffect, useState } from 'react';
import { Scissors, MonitorPlay, Upload, Wand2, ImagePlus, Download, FileVideo, Loader2 } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { Sidebar } from './components/Sidebar';
import { PageEditor } from './components/PageEditor';
import { Preview } from './components/Preview';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/Timeline';
const ExportModal = lazy(() => import('./components/ExportModal').then((m) => ({ default: m.ExportModal })));
const AutoModal = lazy(() => import('./components/AutoModal').then((m) => ({ default: m.AutoModal })));
const SettingsModal = lazy(() => import('./components/SettingsModal').then((m) => ({ default: m.SettingsModal })));
import { CommandPalette } from './components/CommandPalette';
const ChannelModal = lazy(() => import('./components/ChannelModal').then((m) => ({ default: m.ChannelModal })));
const ScriptModal = lazy(() => import('./components/ScriptModal').then((m) => ({ default: m.ScriptModal })));
const AiCenter = lazy(() => import('./components/AiCenter').then((m) => ({ default: m.AiCenter })));
const AssistantModal = lazy(() => import('./components/AssistantModal').then((m) => ({ default: m.AssistantModal })));
import { ConsentDialog } from './components/ConsentDialog';
const LibraryModal = lazy(() => import('./components/LibraryModal').then((m) => ({ default: m.LibraryModal })));
const LiveModal = lazy(() => import('./components/LiveModal').then((m) => ({ default: m.LiveModal })));
const LiveLog = lazy(() => import('./components/LiveModal').then((m) => ({ default: m.LiveLog })));
import { RushEditor } from './components/RushEditor';
import { importRush, analysisOf } from './rush';
import { Toasts, toast } from './components/Toast';
import { getState, loadProject, redo, setUI, undo, useStore } from './store';
import { deleteSelection, importAudioFiles, importPages } from './actions';
import { idb } from './lib/db';
import { isComicFile } from './engine/importers';
import { ensureMedia, ensureVideo } from './engine/media';
import { seek, toggle } from './engine/transport';
import type { Project } from './types';
import { Mark } from './brand/Logo';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installGlobalHandlers } from './lib/errors';

export default function App() {
  const mode = useStore((s) => s.ui.mode);
  const exportOpen = useStore((s) => s.ui.exportOpen);
  const autoOpen = useStore((s) => s.ui.autoOpen);
  const settingsOpen = useStore((s) => s.ui.settingsOpen);
  const paletteOpen = useStore((s) => s.ui.paletteOpen);
  const channelOpen = useStore((s) => s.ui.channelOpen);
  const scriptOpen = useStore((s) => !!s.ui.scriptOpen);
  const aiOpen = useStore((s) => !!s.ui.aiOpen);
  const assistantOpen = useStore((s) => !!s.ui.assistantOpen);
  const libraryOpen = useStore((s) => !!s.ui.libraryOpen);
  const liveOpen = useStore((s) => !!s.ui.liveOpen);
  const liveLog = useStore((s) => !!s.ui.liveLog);
  const busy = useStore((s) => s.ui.busy);
  const hasPages = useStore((s) => s.project.pages.length > 0);
  const hasRush = useStore((s) => !!s.project.aroll);
  const [dragging, setDragging] = useState(false);
  const [booted, setBooted] = useState(false);

  useEffect(() => installGlobalHandlers((m) => toast(m, 'error')), []);

  // restore last session
  useEffect(() => {
    (async () => {
      try {
        const p = await idb.get<Project>('projects', 'current');
        if (p?.pages) {
          await Promise.allSettled([
            ...p.pages.map((x) => ensureMedia(x.mediaId, 'image')),
            ...p.audio.map((x) => ensureMedia(x.mediaId, 'audio')),
            ...(p.aroll ? [ensureVideo(p.aroll.mediaId)] : []),
          ]);
          loadProject(p);
          if (p.aroll) void analysisOf(p.aroll).catch(() => {});
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
      if (ui.exportOpen || ui.autoOpen || ui.settingsOpen || ui.paletteOpen || ui.channelOpen || ui.scriptOpen || ui.aiOpen || ui.assistantOpen || ui.libraryOpen || ui.liveOpen) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); setUI({ paletteOpen: true }); return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.code === 'Space') { e.preventDefault(); toggle(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(ui.playhead - (e.shiftKey ? 1 : 1 / project.fps)); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); seek(ui.playhead + (e.shiftKey ? 1 : 1 / project.fps)); return; }
      if (e.key === 'Escape') setUI({ selection: null });
      if (e.key.toLowerCase() === 'a' && !mod) setUI({ autoOpen: true });
      if (e.key === '1') setUI({ mode: 'rush' });
      if (e.key === '2') setUI({ mode: 'cut' });
      if (e.key === '3') setUI({ mode: 'preview' });
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
      const imgs = files.filter(isComicFile);
      const auds = files.filter((f) => f.type.startsWith('audio/'));
      const vids = files.filter((f) => f.type.startsWith('video/'));
      if (vids.length) await importRush(vids[0]);
      if (imgs.length) await importPages(imgs);
      const voices = auds.filter((f) => /voix|voice|vo[ _-]|narr|record|enreg/i.test(f.name));
      const music = auds.filter((f) => !voices.includes(f));
      try {
        if (voices.length) await importAudioFiles('voice', voices);
        if (music.length) await importAudioFiles('music', music);
      } catch (er) {
        toast('Audio illisible : ' + (er as Error).message, 'error');
      }
      if (!imgs.length && !auds.length && !vids.length && files.length) toast('Format non pris en charge : images, vidéo ou audio uniquement.', 'error');
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
        <ErrorBoundary area="planches"><Sidebar /></ErrorBoundary>
        <main className="center">
          <div className="mode-tabs" role="tablist">
            <button role="tab" aria-selected={mode === 'rush'} className={mode === 'rush' ? 'on' : ''} onClick={() => setUI({ mode: 'rush' })}>
              <FileVideo size={15} /> Rush
            </button>
            <button role="tab" aria-selected={mode === 'cut'} className={mode === 'cut' ? 'on' : ''} onClick={() => setUI({ mode: 'cut' })}>
              <Scissors size={15} /> Découpe
            </button>
            <button role="tab" aria-selected={mode === 'preview'} className={mode === 'preview' ? 'on' : ''} onClick={() => setUI({ mode: 'preview' })}>
              <MonitorPlay size={15} /> Aperçu
            </button>
          </div>
          <ErrorBoundary area={mode}>{mode === 'rush' ? <RushEditor /> : !hasPages && !hasRush ? <Welcome /> : mode === 'cut' ? <PageEditor /> : <Preview />}</ErrorBoundary>
        </main>
        <ErrorBoundary area="inspecteur"><Inspector /></ErrorBoundary>
      </div>
      <ErrorBoundary area="timeline"><Timeline /></ErrorBoundary>
      <Suspense fallback={null}>
      {exportOpen && <ErrorBoundary area="fenêtre"><ExportModal /></ErrorBoundary>}
      {autoOpen && <ErrorBoundary area="fenêtre"><AutoModal onClose={() => setUI({ autoOpen: false })} /></ErrorBoundary>}
      {settingsOpen && <ErrorBoundary area="fenêtre"><SettingsModal /></ErrorBoundary>}
      {paletteOpen && <CommandPalette onClose={() => setUI({ paletteOpen: false })} />}
      {channelOpen && <ErrorBoundary area="fenêtre"><ChannelModal /></ErrorBoundary>}
      {scriptOpen && <ErrorBoundary area="fenêtre"><ScriptModal /></ErrorBoundary>}
      {aiOpen && <ErrorBoundary area="fenêtre"><AiCenter /></ErrorBoundary>}
      {assistantOpen && <ErrorBoundary area="fenêtre"><AssistantModal /></ErrorBoundary>}
      {libraryOpen && <ErrorBoundary area="fenêtre"><LibraryModal /></ErrorBoundary>}
      {liveOpen && <ErrorBoundary area="fenêtre"><LiveModal /></ErrorBoundary>}
      {liveLog && !liveOpen && <ErrorBoundary area="journal"><LiveLog /></ErrorBoundary>}
      </Suspense>
      <ConsentDialog />
      {busy && <div className="busy-pill" role="status"><Loader2 size={15} className="spin" /> {busy}</div>}
      {dragging && (
        <div className="drop-overlay">
          <div><Upload size={36} /><strong>Dépose tes fichiers</strong><span>Vidéo → rush face caméra · Images, PDF, CBZ → cases détectées · Audio → musique ou voix off</span></div>
        </div>
      )}
      <Toasts />
    </div>
  );
}

function Welcome() {
  const pick = (accept: string, multiple: boolean, fn: (f: File[]) => void) => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    i.multiple = multiple;
    i.onchange = () => fn([...(i.files ?? [])]);
    i.click();
  };
  return (
    <div className="stage welcome">
      <div className="welcome-card">
        <Mark size={64} />
        <h1>Tes comics expliqués, montés comme un pro.</h1>
        <p>Importe ton rush face caméra et tes planches. Forge coupe les silences et les « euh », alterne ton visage avec les cases, sous-titre et exporte pour TikTok, Shorts et YouTube.</p>
        <div className="welcome-actions">
          <button className="btn primary lg" onClick={() => pick('video/*', false, (f) => f[0] && void importRush(f[0]))}><FileVideo size={18} /> Importer mon rush</button>
          <button className="btn lg" onClick={() => pick('image/*,.pdf,.cbz,.zip,application/pdf', true, (f) => void importPages(f))}><ImagePlus size={18} /> Importer des planches</button>
        </div>
        <span className="muted">ou glisse tes fichiers n’importe où dans la fenêtre</span>
        <ol className="steps">
          <li><span><FileVideo size={16} /></span><div><b>Dérushage</b><small>Silences, hésitations et reprises coupés au mot près</small></div></li>
          <li><span><Wand2 size={16} /></span><div><b>Montage auto</b><small>Visage et cases en alternance, zooms, sous-titres</small></div></li>
          <li><span><Download size={16} /></span><div><b>Export</b><small>MP4 9:16 ou 16:9, sous-titres .srt, miniature</small></div></li>
        </ol>
      </div>
    </div>
  );
}
