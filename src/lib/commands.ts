import { getState, redo, setUI, undo, update } from '../store';
import { addDiagram, addFx, addTitleCard, classifyWithGoogle } from '../actions';
import { detectFace, transcribe } from '../rush';
import { toggle } from '../engine/transport';
import type { Format } from '../types';

/**
 * COMMANDS — the one list of things Forge can do from a menu. The command
 * palette (Ctrl K) searches it; each studio shows the commands tagged with it.
 * A command always runs the real action: no entry without an implementation.
 */
export type StudioId = 'production' | 'script' | 'visual' | 'editing' | 'audio' | 'motion' | 'finishing' | 'publishing';
export interface Cmd { id: string; label: string; group: string; keys?: string; run: () => void; when?: () => boolean; /** workspaces that show this command */ studios?: StudioId[] }

/* installing Forge as an app: the browser offers it once its install conditions are met (manifest.webmanifest) */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let installEvt: InstallEvent | null = null;
if (typeof window !== 'undefined') window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e as InstallEvent; });
const canInstall = () => !!installEvt && !matchMedia('(display-mode: standalone)').matches;
async function installApp() {
  if (!installEvt) return;
  await installEvt.prompt();
  const r = await installEvt.userChoice.catch(() => ({ outcome: 'dismissed' }));
  if (r.outcome === 'accepted') installEvt = null;
}

export const pick = (accept: string, multiple: boolean, fn: (f: File[]) => void) => {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = accept; i.multiple = multiple;
  i.onchange = () => fn([...(i.files ?? [])]);
  i.click();
};

export function commands(): Cmd[] {
  const hasFace = () => !!getState().project.aroll;
  const fmt = (f: Format) => () => update((p) => ({ ...p, format: f }));
  return [
    { id: 'auto', studios: ['editing'], label: 'Lancer le montage automatique', group: 'Montage', keys: 'A', run: () => setUI({ autoOpen: true }) },
    { id: 'export', studios: ['publishing','finishing'], label: 'Exporter la vidéo', group: 'Montage', run: () => setUI({ exportOpen: true }) },
    { id: 'play', label: 'Lecture / pause', group: 'Montage', keys: 'Espace', run: toggle },
    { id: 'undo', label: 'Annuler', group: 'Montage', keys: 'Ctrl Z', run: undo },
    { id: 'redo', label: 'Rétablir', group: 'Montage', keys: 'Ctrl Maj Z', run: redo },
    { id: 'pages', studios: ['visual'], label: 'Importer des planches (PDF, CBZ, images)', group: 'Importer', run: () => pick('image/*,.pdf,.cbz,.zip', true, (f) => void import('../actions').then((m) => m.importPages(f))) },
    { id: 'rush', studios: ['editing','script'], label: 'Importer le rush face caméra', group: 'Importer', run: () => pick('video/*', false, (f) => f[0] && void import('../rush').then((m) => m.importRush(f[0]))) },
    { id: 'tab-rush', studios: ['editing'], label: 'Aller à l’onglet Rush', group: 'Navigation', keys: '1', run: () => setUI({ mode: 'rush' }) },
    { id: 'tab-cut', studios: ['visual','editing'], label: 'Aller à l’onglet Découpe', group: 'Navigation', keys: '2', run: () => setUI({ mode: 'cut' }) },
    { id: 'tab-prev', studios: ['finishing'], label: 'Aller à l’onglet Aperçu', group: 'Navigation', keys: '3', run: () => setUI({ mode: 'preview' }) },
    { id: 'title', studios: ['motion'], label: 'Ajouter un carton titre', group: 'Ajouter', run: () => addTitleCard() },
    { id: 'd-time', studios: ['motion'], label: 'Ajouter une frise chronologique', group: 'Ajouter', run: () => addDiagram('timeline') },
    { id: 'd-net', studios: ['motion'], label: 'Ajouter un réseau de personnages', group: 'Ajouter', run: () => addDiagram('network') },
    { id: 'd-vs', studios: ['motion'], label: 'Ajouter un duel (VS)', group: 'Ajouter', run: () => addDiagram('versus') },
    { id: 'd-rank', studios: ['motion'], label: 'Ajouter un classement', group: 'Ajouter', run: () => addDiagram('ranking') },
    { id: 'script', studios: ['script'], label: 'Analyser le script (rôles, personnages, visuels proposés)', group: 'Ajouter', run: () => setUI({ scriptOpen: true }) },
    { id: 'd-scale', studios: ['motion'], label: 'Ajouter une échelle de puissance (barres)', group: 'Ajouter', run: () => addDiagram('scale') },
    { id: 'd-orbit', studios: ['motion'], label: 'Ajouter une scène 3D : orbite de cases', group: 'Ajouter', run: () => addDiagram('orbit') },
    { id: 'd-cosmos', studios: ['motion'], label: 'Ajouter une scène 3D : cosmos', group: 'Ajouter', run: () => addDiagram('cosmos') },
    { id: 'd-map', studios: ['motion'], label: 'Ajouter une carte animée (lieux, trajet)', group: 'Ajouter', run: () => addDiagram('map') },
    { id: 'd-tiers', studios: ['motion'], label: 'Ajouter une scène 3D : paliers de puissance', group: 'Ajouter', run: () => addDiagram('tiers') },
    { id: 'fx-tb', studios: ['motion'], label: 'Effet : texte derrière moi', group: 'Effets', run: () => addFx('textBehind'), when: hasFace },
    { id: 'fx-pb', studios: ['motion'], label: 'Effet : case derrière moi', group: 'Effets', run: () => addFx('panelBehind'), when: hasFace },
    { id: 'fx-co', studios: ['motion'], label: 'Effet : mot choc', group: 'Effets', run: () => addFx('callout') },
    { id: 'fx-bl', studios: ['motion'], label: 'Effet : fond flou', group: 'Effets', run: () => addFx('bgBlur'), when: hasFace },
    { id: 'fx-ht', studios: ['motion'], label: 'Effet : fond trame', group: 'Effets', run: () => addFx('bgHalftone'), when: hasFace },
    { id: 'face', studios: ['editing'], label: 'Détecter mon visage', group: 'Rush', run: () => void detectFace(), when: hasFace },
    { id: 'whisper', studios: ['audio','motion'], label: 'Transcrire le rush (local)', group: 'Rush', run: () => void transcribe('whisper'), when: hasFace },
    { id: 'gemini', studios: ['audio'], label: 'Transcrire le rush (Google)', group: 'Rush', run: () => void transcribe('gemini'), when: hasFace },
    { id: 'ai-tr', studios: ['audio'], label: 'Transcrire le rush (IA auto : Groq, Gemini ou local)', group: 'Rush', run: () => void transcribe('ai'), when: hasFace },
    { id: 'ai-center', studios: ['production'], label: 'Centre de contrôle IA (fournisseurs, clés, coûts)', group: 'IA', run: () => setUI({ aiOpen: true }) },
    { id: 'ai-assist', studios: ['editing','script'], label: 'Assistant de montage', group: 'IA', run: () => setUI({ assistantOpen: true }) },
    { id: 'classify', studios: ['visual'], label: 'Classer les pages avec Google', group: 'Planches', run: () => void classifyWithGoogle() },
    { id: 'f916', label: 'Format 9:16 (TikTok, Shorts)', group: 'Format', run: fmt('9:16') },
    { id: 'f169', label: 'Format 16:9 (YouTube)', group: 'Format', run: fmt('16:9') },
    { id: 'f11', label: 'Format 1:1', group: 'Format', run: fmt('1:1') },
    { id: 'f45', label: 'Format 4:5', group: 'Format', run: fmt('4:5') },
    { id: 'safe', label: 'Afficher / masquer les zones de sécurité', group: 'Affichage', run: () => setUI({ safeZones: !getState().ui.safeZones }) },
    { id: 'loop', label: 'Lecture en boucle', group: 'Affichage', run: () => setUI({ loop: !getState().ui.loop }) },
    { id: 'settings', label: 'Réglages (Google, apprentissage)', group: 'Affichage', run: () => setUI({ settingsOpen: true }) },
    { id: 'channel', studios: ['publishing'], label: 'Ma chaîne : identité, intro, écran de fin', group: 'Chaîne', run: () => setUI({ channelOpen: true }) },
    { id: 'thumb', studios: ['publishing'], label: 'Créer une miniature YouTube', group: 'Chaîne', run: () => setUI({ channelOpen: true }) },
    { id: 'chapter', studios: ['motion'], label: 'Ajouter un carton de chapitre (charte)', group: 'Ajouter', run: () => { addTitleCard('CHAPITRE'); const st = getState(); const sel = st.ui.selection; if (sel?.kind === 'shot') update((p) => ({ ...p, shots: p.shots.map((x) => (x.id === sel.id ? { ...x, titleBg: 'brand' } : x)) })); } },
    { id: 'projects', studios: ['production'], label: 'Projets : liste, avancement, versions, espace disque', group: 'Production', run: () => setUI({ projectsOpen: true }) },
    { id: 'tasks', studios: ['production'], label: 'File de tâches : progression, pause, relance', group: 'Production', run: () => setUI({ tasksOpen: true }) },
    { id: 'script-write', studios: ['script'], label: 'Écrire ou coller le script, recherche documentaire', group: 'Script', run: () => setUI({ scriptOpen: true }) },
    { id: 'research', studios: ['script'], label: 'Recherche documentaire sur les comics importés (IA)', group: 'Script', run: () => void import('../actions').then((m) => m.researchComics()) },
    { id: 'voice', studios: ['script','audio'], label: 'Importer la voix off', group: 'Importer', run: () => pick('audio/*', true, (f) => void import('../actions').then((m) => m.importAudioFiles('voice', f))) },
    { id: 'music', studios: ['audio'], label: 'Bibliothèque musicale', group: 'Son', run: () => setUI({ libraryOpen: true }) },
    { id: 'music-file', studios: ['audio'], label: 'Importer une musique', group: 'Importer', run: () => pick('audio/*', true, (f) => void import('../actions').then((m) => m.importAudioFiles('music', f))) },
    { id: 'media', studios: ['visual','production'], label: 'Médiathèque : médias de tous les projets', group: 'Visuel', run: () => setUI({ mediaOpen: true }) },
    { id: 'storyboard', studios: ['visual','script'], label: 'Storyboard : une image par phrase', group: 'Visuel', run: () => setUI({ storyboardOpen: true }) },
    { id: 'review', studios: ['editing'], label: 'Correction express des placements douteux', group: 'Montage', run: () => setUI({ reviewOpen: true }) },
    { id: 'live', studios: ['editing'], label: 'Montage en direct', group: 'Montage', run: () => setUI({ liveOpen: true }) },
    { id: 'roughcut', studios: ['editing','audio'], label: 'Couper silences et hésitations du rush', group: 'Rush', run: () => void import('../rush').then((m) => m.roughCut()), when: hasFace },
    { id: 'subs', studios: ['motion'], label: 'Recréer les sous-titres depuis la transcription', group: 'Sous-titres', run: () => void import('../rush').then((m) => m.rebuildSubtitles()) },
    { id: 'subs-style', studios: ['motion'], label: 'Appliquer le style de sous-titre à tous les plans', group: 'Sous-titres', run: () => void import('../actions').then((m) => m.applyDefaultCaptionToAll()) },
    { id: 'motion-prep', studios: ['motion'], label: 'Préparer les mouvements (profondeur, détourage)', group: 'Animation', run: () => void import('../actions').then((m) => m.prepareMotion()) },
    { id: 'ov-suggest', studios: ['editing', 'motion'], label: 'Proposer des calques d’après le script (à valider)', group: 'Superposition', run: () => setUI({ assistantOpen: true, assistantAsk: 'Propose des calques d’après le script' }) },
    { id: 'split', studios: ['editing'], label: 'Couper la sélection au curseur', group: 'Montage', keys: 'S', run: () => void import('../actions').then((m) => m.splitAtPlayhead()) },
    { id: 'trim-in', studios: ['editing'], label: 'Début de la sélection au curseur', group: 'Montage', keys: '[', run: () => void import('../actions').then((m) => m.trimToPlayhead('start')) },
    { id: 'trim-out', studios: ['editing'], label: 'Fin de la sélection au curseur', group: 'Montage', keys: ']', run: () => void import('../actions').then((m) => m.trimToPlayhead('end')) },
    { id: 'install', studios: ['production'], label: 'Installer Forge comme application (fenêtre à part, plus de place)', group: 'Production', run: () => void installApp(), when: canInstall },
    { id: 'ov-file', studios: ['editing', 'motion'], label: 'Superposer une image ou une vidéo (au curseur)', group: 'Superposition', run: () => pick('image/*,video/*', true, (f) => void import('../actions').then((m) => m.importOverlayFiles(f))) },
    { id: 'ov-panel', studios: ['editing', 'motion'], label: 'Superposer la case sélectionnée (au curseur)', group: 'Superposition', run: () => void import('../actions').then((m) => m.overlaySelectedPanel()) },
    { id: 'qc', studios: ['finishing'], label: 'Contrôle qualité et export', group: 'Finition', run: () => setUI({ exportOpen: true }) },
  ];
}

