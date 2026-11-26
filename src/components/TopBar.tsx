import { useRef } from 'react';
import { Download, Wand2, FolderOpen, FilePlus2, Redo2, Save, Undo2, Settings2, Crown, Bot, MessageSquareText } from 'lucide-react';
import { Wordmark } from '../brand/Logo';
import { FORMATS, type Format } from '../types';
import { getState, loadProject, newProject, redo, setUI, undo, update, useHistory, useStore } from '../store';
import { openProjectFile, saveProjectFile } from '../lib/projectFile';
import { download } from '../engine/export';
import { toast } from './Toast';

export function TopBar() {
  const name = useStore((s) => s.project.name);
  const format = useStore((s) => s.project.format);
  const saved = useStore((s) => s.ui.saved);
  const { canUndo, canRedo } = useHistory();
  const openRef = useRef<HTMLInputElement>(null);

  const saveFile = async () => {
    const p = getState().project;
    download(await saveProjectFile(p), `${p.name || 'projet'}.forge`);
    toast('Projet enregistré sur ton ordinateur');
  };
  const openFile = async (f?: File) => {
    if (!f) return;
    try {
      loadProject(await openProjectFile(f));
      toast(`Projet « ${getState().project.name} » ouvert`);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const fresh = () => {
    if (getState().project.shots.length && !confirm('Créer un nouveau projet ? Pense à enregistrer le projet actuel (.forge).')) return;
    loadProject(newProject());
  };

  return (
    <header className="topbar">
      <Wordmark size={30} />
      <div className="topbar-sep" />
      <div className="file-actions">
        <button className="icon-btn" title="Nouveau projet" onClick={fresh}><FilePlus2 size={17} /></button>
        <button className="icon-btn" title="Ouvrir un projet .forge" onClick={() => openRef.current?.click()}><FolderOpen size={17} /></button>
        <button className="icon-btn" title="Enregistrer le projet (.forge)" onClick={saveFile}><Save size={17} /></button>
        <input ref={openRef} type="file" accept=".forge,application/json" hidden onChange={(e) => { void openFile(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      <input
        className="project-name"
        value={name}
        aria-label="Nom du projet"
        onChange={(e) => update((p) => ({ ...p, name: e.target.value }), 'name')}
      />
      <span className={`save-dot ${saved}`} title={saved === 'saved' ? 'Sauvegardé localement' : 'Sauvegarde…'} />

      <div className="topbar-center">
        <div className="seg" role="radiogroup" aria-label="Format">
          {(Object.keys(FORMATS) as Format[]).map((f) => (
            <button
              key={f}
              role="radio"
              aria-checked={format === f}
              className={format === f ? 'on' : ''}
              title={FORMATS[f].hint}
              onClick={() => update((p) => ({ ...p, format: f }))}
            >
              <span className={`ratio-ico r${f.replace(':', '-')}`} />
              {f}
            </button>
          ))}
        </div>
        <span className="format-hint">{FORMATS[format].hint} · {FORMATS[format].w}×{FORMATS[format].h}</span>
      </div>

      <div className="topbar-right">
        <button className="icon-btn" disabled={!canUndo} onClick={undo} title="Annuler (Ctrl+Z)"><Undo2 size={17} /></button>
        <button className="icon-btn" disabled={!canRedo} onClick={redo} title="Rétablir (Ctrl+Maj+Z)"><Redo2 size={17} /></button>
        <button className="cmd-btn" onClick={() => setUI({ paletteOpen: true })} title="Toutes les commandes">
          <span>Commandes</span><kbd>Ctrl K</kbd>
        </button>
        <button className="icon-btn" onClick={() => setUI({ assistantOpen: true })} title="Assistant de montage : demande, il propose, tu valides"><MessageSquareText size={17} /></button>
        <button className="icon-btn" onClick={() => setUI({ aiOpen: true })} title="Centre de contrôle IA : fournisseurs, clés, coûts, confidentialité"><Bot size={17} /></button>
        <button className="icon-btn" onClick={() => setUI({ channelOpen: true })} title="Ma chaîne : identité, intro, fin, miniatures"><Crown size={17} /></button>
        <button className="icon-btn" onClick={() => setUI({ settingsOpen: true })} title="Réglages : Google AI, apprentissage"><Settings2 size={17} /></button>
        <button className="btn accent-outline" onClick={() => setUI({ autoOpen: true })} title="Montage automatique (A)">
          <Wand2 size={16} /> Montage auto
        </button>
        <button className="btn primary" onClick={() => setUI({ exportOpen: true })}>
          <Download size={16} /> Exporter
        </button>
      </div>
    </header>
  );
}
