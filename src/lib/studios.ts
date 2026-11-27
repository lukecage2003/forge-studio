import type { Project } from '../types';
import { videoDuration } from '../engine/timeline';
import { PLATFORMS } from '../engine/delivery';
import type { StudioId } from './commands';

/**
 * STUDIOS — eight workspaces over the same project, the same store and the
 * same engines. A studio is not a separate app: it is a view on one stage of
 * the production, showing what that stage needs (read from the project, never
 * guessed) and the real commands that do it (lib/commands).
 */

export type CheckState = 'ok' | 'todo' | 'warn' | 'info';
export interface Check { label: string; state: CheckState; detail?: string; /** command that does it (lib/commands id) */ cmd?: string }
export interface Studio { id: StudioId; label: string; short: string; hint: string; /** main area shown when entering it */ mode?: 'rush' | 'cut' | 'preview' }

export const STUDIOS: Studio[] = [
  { id: 'production', label: 'Production', short: 'Prod.', hint: 'Projets, avancement, tâches, versions' },
  { id: 'script', label: 'Recherche et script', short: 'Script', hint: 'Documentation, script, voix off' },
  { id: 'visual', label: 'Visuel', short: 'Visuel', hint: 'Planches, cases, médiathèque, storyboard', mode: 'cut' },
  { id: 'editing', label: 'Montage', short: 'Montage', hint: 'Plans, rush, montage automatique', mode: 'cut' },
  { id: 'audio', label: 'Son', short: 'Son', hint: 'Voix, musique, nettoyage, niveaux' },
  { id: 'motion', label: 'Animation et sous-titres', short: 'Animation', hint: 'Mouvements, schémas, effets, sous-titres', mode: 'preview' },
  { id: 'finishing', label: 'Finition', short: 'Finition', hint: 'Direction artistique, couleur, contrôle qualité', mode: 'preview' },
  { id: 'publishing', label: 'Publication', short: 'Publier', hint: 'Export, plateformes, chaîne, miniature', mode: 'preview' },
];

const plural = (n: number, one: string, many = one + 's') => `${n} ${n > 1 ? many : one}`;

/** what each studio still needs, from the project only (pure: tested) */
export function studioChecks(p: Project, id: StudioId): Check[] {
  const story = p.pages.filter((pg) => !pg.skip);
  const voices = p.audio.filter((a) => a.kind === 'voice');
  const music = p.audio.filter((a) => a.kind === 'music');
  const hasVoice = voices.length > 0 || !!p.aroll;
  const words = (p.script ?? '').trim().split(/\s+/).filter(Boolean).length;
  const dur = videoDuration(p);
  switch (id) {
    case 'script': return [
      { label: 'Script', state: words >= 30 ? 'ok' : words ? 'warn' : 'todo', detail: words ? plural(words, 'mot') : 'pas encore écrit', cmd: 'script-write' },
      { label: 'Recherche documentaire', state: p.research ? 'ok' : 'info', detail: p.research ? p.research.title : 'facultative', cmd: 'research' },
      { label: 'Voix off ou face caméra', state: hasVoice ? 'ok' : 'todo', detail: p.aroll ? 'rush face caméra' : voices.length ? plural(voices.length, 'piste') : 'à importer', cmd: p.aroll ? undefined : 'voice' },
    ];
    case 'visual': {
      const analysing = p.pages.filter((pg) => pg.analysing).length;
      const cut = story.filter((pg) => pg.cut).length;
      const doubts = p.pages.filter((pg) => pg.orderDoubt && !pg.skip).length;
      const dups = p.pages.filter((pg) => pg.dupOf).length;
      const out: Check[] = [
        { label: 'Planches', state: story.length ? 'ok' : 'todo', detail: story.length ? `${plural(story.length, 'page')} utilisée${story.length > 1 ? 's' : ''}${p.pages.length > story.length ? `, ${p.pages.length - story.length} écartée${p.pages.length - story.length > 1 ? 's' : ''}` : ''}` : 'à importer', cmd: 'pages' },
        { label: 'Cases découpées', state: analysing ? 'info' : !story.length ? 'todo' : cut === story.length ? 'ok' : 'warn', detail: analysing ? `lecture en cours (${analysing})` : story.length ? `${cut} / ${story.length}` : undefined, cmd: 'tab-cut' },
      ];
      if (doubts) out.push({ label: 'Ordre de lecture à vérifier', state: 'warn', detail: plural(doubts, 'page'), cmd: 'tab-cut' });
      if (dups) out.push({ label: 'Pages en double', state: 'info', detail: plural(dups, 'page'), cmd: 'media' });
      out.push({ label: 'Storyboard', state: !words ? 'info' : p.shots.length ? 'ok' : 'todo', detail: words ? 'une image par phrase du script' : 'demande un script', cmd: 'storyboard' });
      return out;
    }
    case 'editing': {
      const limit = p.format === '9:16' ? PLATFORMS.shorts.maxSec : 0;
      const cuts = p.aroll?.cuts.filter((c) => c.on).length ?? 0;
      const out: Check[] = [
        { label: 'Plans', state: p.shots.length ? 'ok' : 'todo', detail: p.shots.length ? `${plural(p.shots.length, 'plan')}, ${dur.toFixed(0)} s` : 'lance le montage automatique', cmd: 'auto' },
      ];
      if (p.aroll) out.push({ label: 'Rush nettoyé', state: cuts ? 'ok' : 'todo', detail: cuts ? plural(cuts, 'coupe') : 'silences et hésitations à couper', cmd: 'roughcut' });
      if (limit && dur > limit) out.push({ label: 'Durée', state: 'warn', detail: `${dur.toFixed(0)} s : au-delà des ${limit / 60} min de Shorts et Reels`, cmd: 'tab-cut' });
      return out;
    }
    case 'audio': return [
      { label: 'Voix', state: hasVoice ? 'ok' : 'todo', detail: hasVoice ? (p.mix?.voiceClean ? 'nettoyage activé' : 'sans nettoyage') : 'à importer', cmd: hasVoice ? undefined : 'voice' },
      { label: 'Musique', state: music.length ? 'ok' : 'info', detail: music.length ? `${plural(music.length, 'piste')}${p.ducking ? ', baissée sous la voix' : ''}` : 'facultative', cmd: 'music' },
      { label: 'Niveau final', state: p.mix?.target != null ? 'ok' : 'info', detail: p.mix?.target != null ? `${p.mix.target} LUFS` : 'non normalisé', cmd: 'qc' },
    ];
    case 'motion': {
      const moving = p.shots.filter((s) => s.motion !== 'static').length;
      const graphics = p.shots.filter((s) => s.diagram).length + p.fx.length;
      return [
        { label: 'Sous-titres', state: !p.subtitleStyle.on ? 'info' : p.subtitles.length ? 'ok' : hasVoice ? 'todo' : 'info', detail: !p.subtitleStyle.on ? 'désactivés' : p.subtitles.length ? plural(p.subtitles.length, 'ligne') : hasVoice ? 'transcription à faire' : 'demande une voix', cmd: 'subs' },
        { label: 'Mouvements de caméra', state: !p.shots.length ? 'todo' : 'ok', detail: p.shots.length ? `${moving} / ${p.shots.length} plans animés` : 'aucun plan', cmd: 'motion-prep' },
        { label: 'Schémas, cartons et effets', state: graphics ? 'ok' : 'info', detail: graphics ? String(graphics) : 'facultatifs', cmd: 'd-time' },
      ];
    }
    case 'finishing': {
      const toned = p.pages.filter((pg) => pg.tone).length;
      return [
        { label: 'Direction artistique', state: p.art || p.shots.length ? 'ok' : 'info', detail: p.art ? p.art.base : 'par défaut', cmd: 'auto' },
        { label: 'Couleur des scans', state: toned ? 'ok' : 'info', detail: toned ? `${plural(toned, 'planche')} harmonisée${toned > 1 ? 's' : ''}` : 'vérifiée au contrôle qualité', cmd: 'qc' },
        { label: 'Contrôle qualité', state: 'info', detail: p.shots.length ? 'à relire avant chaque export' : 'demande un montage', cmd: 'qc' },
      ];
    }
    case 'publishing': return [
      { label: 'Titre', state: p.name && !/^(sans titre|nouveau projet)$/i.test(p.name.trim()) ? 'ok' : 'todo', detail: p.name },
      { label: 'Format', state: 'ok', detail: p.format },
      { label: 'Identité de la chaîne', state: p.brand ? 'ok' : 'info', detail: p.brand ? 'intro, fin, couleurs' : 'facultative', cmd: 'channel' },
      { label: 'Vidéo et kit de publication', state: p.shots.length ? 'todo' : 'info', detail: p.shots.length ? 'export, puis texte pour TikTok, Shorts et Reels' : 'demande un montage', cmd: 'export' },
    ];
    case 'production': {
      const others = STUDIOS.filter((s) => s.id !== 'production');
      const ready = others.filter((s) => !studioChecks(p, s.id).some((c) => c.state === 'todo' || c.state === 'warn'));
      const st = p.production?.status;
      const tasks = p.production?.tasks ?? [];
      return [
        { label: 'Étapes prêtes', state: ready.length === others.length ? 'ok' : 'info', detail: `${ready.length} / ${others.length}${ready.length < others.length ? ` — prochaine : ${others.find((s) => !ready.includes(s))!.label}` : ''}` },
        { label: 'Statut du projet', state: 'info', detail: st ?? 'idée', cmd: 'projects' },
        { label: 'Tâches du projet', state: tasks.length && tasks.every((t) => t.done) ? 'ok' : 'info', detail: tasks.length ? `${tasks.filter((t) => t.done).length} / ${tasks.length} faites` : 'aucune', cmd: 'projects' },
      ];
    }
  }
}

/** a studio is done when nothing in it is still to do or to check, and something in it was actually done */
export function studioReady(p: Project, id: StudioId) {
  const c = studioChecks(p, id);
  return !c.some((x) => x.state === 'todo' || x.state === 'warn') && c.some((x) => x.state === 'ok');
}
/** the first stage (in production order) that still needs something */
export const nextStudio = (p: Project): StudioId | null => STUDIOS.find((s) => s.id !== 'production' && !studioReady(p, s.id))?.id ?? null;
