import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { getState, redo, setUI, undo, update } from '../store';
import { addDiagram, addFx, addTitleCard, classifyWithGoogle } from '../actions';
import { detectFace, transcribe } from '../rush';
import { toggle } from '../engine/transport';
import type { Format } from '../types';

interface Cmd { id: string; label: string; group: string; keys?: string; run: () => void; when?: () => boolean }

const pick = (accept: string, multiple: boolean, fn: (f: File[]) => void) => {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = accept; i.multiple = multiple;
  i.onchange = () => fn([...(i.files ?? [])]);
  i.click();
};

function commands(): Cmd[] {
  const hasFace = () => !!getState().project.aroll;
  const fmt = (f: Format) => () => update((p) => ({ ...p, format: f }));
  return [
    { id: 'auto', label: 'Lancer le montage automatique', group: 'Montage', keys: 'A', run: () => setUI({ autoOpen: true }) },
    { id: 'export', label: 'Exporter la vidéo', group: 'Montage', run: () => setUI({ exportOpen: true }) },
    { id: 'play', label: 'Lecture / pause', group: 'Montage', keys: 'Espace', run: toggle },
    { id: 'undo', label: 'Annuler', group: 'Montage', keys: 'Ctrl Z', run: undo },
    { id: 'redo', label: 'Rétablir', group: 'Montage', keys: 'Ctrl Maj Z', run: redo },
    { id: 'pages', label: 'Importer des planches (PDF, CBZ, images)', group: 'Importer', run: () => pick('image/*,.pdf,.cbz,.zip', true, (f) => void import('../actions').then((m) => m.importPages(f))) },
    { id: 'rush', label: 'Importer le rush face caméra', group: 'Importer', run: () => pick('video/*', false, (f) => f[0] && void import('../rush').then((m) => m.importRush(f[0]))) },
    { id: 'tab-rush', label: 'Aller à l’onglet Rush', group: 'Navigation', keys: '1', run: () => setUI({ mode: 'rush' }) },
    { id: 'tab-cut', label: 'Aller à l’onglet Découpe', group: 'Navigation', keys: '2', run: () => setUI({ mode: 'cut' }) },
    { id: 'tab-prev', label: 'Aller à l’onglet Aperçu', group: 'Navigation', keys: '3', run: () => setUI({ mode: 'preview' }) },
    { id: 'title', label: 'Ajouter un carton titre', group: 'Ajouter', run: () => addTitleCard() },
    { id: 'd-time', label: 'Ajouter une frise chronologique', group: 'Ajouter', run: () => addDiagram('timeline') },
    { id: 'd-net', label: 'Ajouter un réseau de personnages', group: 'Ajouter', run: () => addDiagram('network') },
    { id: 'd-vs', label: 'Ajouter un duel (VS)', group: 'Ajouter', run: () => addDiagram('versus') },
    { id: 'd-rank', label: 'Ajouter un classement', group: 'Ajouter', run: () => addDiagram('ranking') },
    { id: 'd-scale', label: 'Ajouter une échelle de puissance (barres)', group: 'Ajouter', run: () => addDiagram('scale') },
    { id: 'd-orbit', label: 'Ajouter une scène 3D : orbite de cases', group: 'Ajouter', run: () => addDiagram('orbit') },
    { id: 'd-cosmos', label: 'Ajouter une scène 3D : cosmos', group: 'Ajouter', run: () => addDiagram('cosmos') },
    { id: 'd-tiers', label: 'Ajouter une scène 3D : paliers de puissance', group: 'Ajouter', run: () => addDiagram('tiers') },
    { id: 'fx-tb', label: 'Effet : texte derrière moi', group: 'Effets', run: () => addFx('textBehind'), when: hasFace },
    { id: 'fx-pb', label: 'Effet : case derrière moi', group: 'Effets', run: () => addFx('panelBehind'), when: hasFace },
    { id: 'fx-co', label: 'Effet : mot choc', group: 'Effets', run: () => addFx('callout') },
    { id: 'fx-bl', label: 'Effet : fond flou', group: 'Effets', run: () => addFx('bgBlur'), when: hasFace },
    { id: 'fx-ht', label: 'Effet : fond trame', group: 'Effets', run: () => addFx('bgHalftone'), when: hasFace },
    { id: 'face', label: 'Détecter mon visage', group: 'Rush', run: () => void detectFace(), when: hasFace },
    { id: 'whisper', label: 'Transcrire le rush (local)', group: 'Rush', run: () => void transcribe('whisper'), when: hasFace },
    { id: 'gemini', label: 'Transcrire le rush (Google)', group: 'Rush', run: () => void transcribe('gemini'), when: hasFace },
    { id: 'classify', label: 'Classer les pages avec Google', group: 'Planches', run: () => void classifyWithGoogle() },
    { id: 'f916', label: 'Format 9:16 (TikTok, Shorts)', group: 'Format', run: fmt('9:16') },
    { id: 'f169', label: 'Format 16:9 (YouTube)', group: 'Format', run: fmt('16:9') },
    { id: 'f11', label: 'Format 1:1', group: 'Format', run: fmt('1:1') },
    { id: 'f45', label: 'Format 4:5', group: 'Format', run: fmt('4:5') },
    { id: 'safe', label: 'Afficher / masquer les zones de sécurité', group: 'Affichage', run: () => setUI({ safeZones: !getState().ui.safeZones }) },
    { id: 'loop', label: 'Lecture en boucle', group: 'Affichage', run: () => setUI({ loop: !getState().ui.loop }) },
    { id: 'settings', label: 'Réglages (Google, apprentissage)', group: 'Affichage', run: () => setUI({ settingsOpen: true }) },
    { id: 'channel', label: 'Ma chaîne : identité, intro, écran de fin', group: 'Chaîne', run: () => setUI({ channelOpen: true }) },
    { id: 'thumb', label: 'Créer une miniature YouTube', group: 'Chaîne', run: () => setUI({ channelOpen: true }) },
    { id: 'chapter', label: 'Ajouter un carton de chapitre (charte)', group: 'Ajouter', run: () => { addTitleCard('CHAPITRE'); const st = getState(); const sel = st.ui.selection; if (sel?.kind === 'shot') update((p) => ({ ...p, shots: p.shots.map((x) => (x.id === sel.id ? { ...x, titleBg: 'brand' } : x)) })); } },
  ];
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return commands().filter((c) => (!c.when || c.when()) && words.every((w) => norm(c.label + ' ' + c.group).includes(w)));
  }, [q]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setI(0); }, [q]);
  const run = (c?: Cmd) => { if (!c) return; onClose(); setTimeout(c.run, 0); };
  return (
    <div className="modal-back palette-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Commandes">
        <div className="palette-search">
          <Search size={16} />
          <input ref={input} value={q} placeholder="Que veux-tu faire ?" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(list.length - 1, x + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              if (e.key === 'Enter') run(list[i]);
              if (e.key === 'Escape') onClose();
            }} />
          <kbd>Échap</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {list.map((c, k) => (
            <li key={c.id} role="option" aria-selected={k === i} className={k === i ? 'on' : ''} onMouseEnter={() => setI(k)} onClick={() => run(c)}>
              <span className="pg">{c.group}</span>
              <span className="pl">{c.label}</span>
              {c.keys && <kbd>{c.keys}</kbd>}
            </li>
          ))}
          {!list.length && <li className="empty">Aucune commande</li>}
        </ul>
      </div>
    </div>
  );
}
