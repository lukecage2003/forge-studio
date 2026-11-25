import type { Project } from '../types';
import { FORMATS } from '../types';
import { getImage, getVideo } from './media';
import { layoutShots, videoDuration } from './timeline';
import { resolveMotion } from './render';
import { buildSubtitles, timelineWords } from './auto';

/**
 * Pre-export check: everything that would look or sound wrong once on
 * TikTok/YouTube, each with a one-click fix when one exists.
 */
export interface Issue { level: 'error' | 'warn'; text: string; fix?: { label: string; apply: (p: Project) => Project }; at?: number }

export function checkProject(p: Project): Issue[] {
  const out: Issue[] = [];
  const { w: W, h: H } = FORMATS[p.format];
  const timed = layoutShots(p);
  const dur = videoDuration(p);

  // media actually available
  const missingPages = p.pages.filter((pg) => !pg.skip && !getImage(pg.mediaId));
  if (missingPages.length) out.push({ level: 'error', text: `${missingPages.length} page(s) introuvable(s) : réimporte les fichiers.` });
  if (p.aroll && !getVideo(p.aroll.mediaId)) out.push({ level: 'error', text: 'Le rush face caméra est introuvable : réimporte-le.' });
  if (dur <= 0) out.push({ level: 'error', text: 'La vidéo est vide.' });

  // shots too short to be read
  const short = timed.filter((t) => t.shot.pageId && t.shot.duration < 0.7 && !t.shot.match);
  if (short.length) out.push({
    level: 'warn', text: `${short.length} plan(s) de moins de 0,7 s : trop court pour être lu.`, at: short[0].start,
    fix: { label: 'Passer à 1 s', apply: (x) => ({ ...x, shots: x.shots.map((s) => (short.some((t) => t.shot.id === s.id) ? { ...s, duration: 1 } : s)) }) },
  });

  // panels enlarged beyond their resolution: blurry on screen
  const blurry = timed.filter((t) => {
    const s = t.shot;
    if (!s.pageId || s.layout !== 'full') return false;
    const pg = p.pages.find((x) => x.id === s.pageId);
    if (!pg) return false;
    const { framing } = resolveMotion(s, W / H, p.readingOrder === 'rtl');
    const vw = framing === 'fill' ? Math.min(s.rect.w, s.rect.h * (W / H)) : Math.max(s.rect.w, s.rect.h * (W / H)) * 1.08;
    const zoom = 1 - 0.24 * s.intensity;
    return W / (vw * zoom) > 2.2; // more than 2.2 screen pixels per comic pixel
  });
  if (blurry.length) out.push({
    level: 'warn', text: `${blurry.length} case(s) très agrandie(s) : l’image sera un peu floue. Une page en meilleure résolution aiderait.`, at: blurry[0].start,
    fix: { label: 'Zoomer moins', apply: (x) => ({ ...x, shots: x.shots.map((s) => (blurry.some((t) => t.shot.id === s.id) ? { ...s, intensity: Math.min(s.intensity, 0.3), framing: 'fit' } : s)) }) },
  });

  // subtitles under the TikTok/Shorts interface
  if (p.format === '9:16') {
    if (p.subtitles.length && p.subtitleStyle.on && p.subtitleStyle.y > 0.78) out.push({
      level: 'warn', text: 'Les sous-titres sont dans la zone cachée par l’interface TikTok/Shorts.',
      fix: { label: 'Remonter', apply: (x) => ({ ...x, subtitleStyle: { ...x.subtitleStyle, y: 0.7 } }) },
    });
    const low = p.shots.filter((s) => s.caption.text.trim() && s.caption.y > 0.8 && s.pageId);
    if (low.length) out.push({
      level: 'warn', text: `${low.length} texte(s) de case sous l’interface TikTok/Shorts.`,
      fix: { label: 'Remonter', apply: (x) => ({ ...x, shots: x.shots.map((s) => (low.includes(s) ? { ...s, caption: { ...s.caption, y: 0.72 } } : s)) }) },
    });
    if (dur > 180) out.push({ level: 'warn', text: `Vidéo de ${Math.round(dur)} s : au-delà de 3 min, ce n’est plus un Short sur YouTube.` });
  }

  // sound: music too loud against the voice, or overall clipping risk
  const music = p.audio.filter((c) => c.kind === 'music');
  const hasVoice = !!p.aroll || p.audio.some((c) => c.kind === 'voice');
  if (hasVoice && music.some((m) => m.volume > 0.85) && !p.ducking) out.push({
    level: 'warn', text: 'La musique risque de couvrir ta voix.',
    fix: { label: 'Baisser sous la voix', apply: (x) => ({ ...x, ducking: true, duckLevel: Math.min(x.duckLevel, 0.25) }) },
  });
  const loud = p.audio.filter((c) => c.volume > 1.2);
  if (loud.length) out.push({
    level: 'warn', text: `${loud.length} piste(s) au-dessus de 120 % : risque de saturation.`,
    fix: { label: 'Ramener à 100 %', apply: (x) => ({ ...x, audio: x.audio.map((c) => (c.volume > 1.2 ? { ...c, volume: 1 } : c)) }) },
  });

  // editing grammar: the same visible transition twice in a row, or effects everywhere
  const quiet = (tr: string) => tr === 'cut' || tr === 'glide';
  const repeats = timed.filter((t, i) => i > 0 && !quiet(t.shot.transition) && t.shot.transition === timed[i - 1].shot.transition);
  if (repeats.length) out.push({
    level: 'warn', text: `${repeats.length} transition(s) identique(s) deux fois de suite : l’effet s’use.`, at: repeats[0].start,
    fix: { label: 'Remplacer par une coupe', apply: (x) => ({ ...x, shots: x.shots.map((s) => (repeats.some((t) => t.shot.id === s.id) ? { ...s, transition: 'cut' as const, transitionDur: 0, tp: undefined } : s)) }) },
  });
  if (dur > 20) {
    const loud = timed.filter((t) => !quiet(t.shot.transition) && t.shot.transition !== 'fade').length;
    const perMin = loud / (dur / 60);
    if (perMin > 12) out.push({ level: 'warn', text: `${Math.round(perMin)} transitions marquées par minute : trop d’effets, le montage paraît amateur. Garde des coupes franches entre les temps forts (profils de direction créative).` });
  }

  // subtitles too fast to read, texts under the TikTok / Shorts buttons
  const st = subtitleStats(p);
  if (st.fast) out.push({ level: 'warn', text: `${st.fast} sous-titre(s) trop rapide(s) à lire (plus de 20 caractères par seconde).`,
    fix: p.subtitles.length && timelineWords(p).length ? { label: 'Couper plus court', apply: (x) => {
      const maxWords = Math.max(2, (x.subtitleStyle.maxWords ?? 4) - 1);
      return { ...x, subtitleStyle: { ...x.subtitleStyle, maxWords }, subtitles: buildSubtitles(timelineWords(x), maxWords) };
    } } : undefined });
  const zones = safeZoneIssues(p);
  if (zones) out.push({ level: 'warn', text: `${zones} texte(s) placé(s) sous les boutons de TikTok / Shorts.`,
    fix: { label: 'Remonter dans la zone sûre', apply: (x) => ({ ...x, subtitleStyle: { ...x.subtitleStyle, y: Math.min(0.78, Math.max(0.12, x.subtitleStyle.y)) }, shots: x.shots.map((s) => ({ ...s, caption: { ...s.caption, y: Math.min(0.78, Math.max(0.12, s.caption.y)) } })) }) } });

  // story placements still to check
  const review = p.shots.filter((s) => s.match && s.match.conf < 0.5).length;
  if (review) out.push({ level: 'warn', text: `${review} case(s) associée(s) avec peu de certitude : vérifie-les (inspecteur du projet → « À vérifier »).` });

  return out;
}

/** subtitles too fast to read: characters per second (Netflix-style limit: 17 to 20) */
export function subtitleStats(p: Project) {
  const subs = p.subtitles.length ? p.subtitles : layoutShots(p).filter((t) => t.shot.caption.text.trim()).map((t) => ({ s: t.start, e: t.end, text: t.shot.caption.text }));
  let fast = 0, short = 0, long = 0, maxCps = 0;
  for (const s of subs) {
    const d = Math.max(0.01, s.e - s.s), chars = s.text.replace(/\s+/g, ' ').trim().length;
    const cps = chars / d;
    maxCps = Math.max(maxCps, cps);
    if (cps > 20 && chars > 12) fast++;
    if (d < 0.5) short++;
    if (chars > 42 && !p.subtitles.length) long++;
  }
  return { count: subs.length, fast, short, long, maxCps };
}

/** text placed where TikTok / Shorts draw their buttons and description */
export function safeZoneIssues(p: Project): number {
  if (p.format !== '9:16') return 0;
  const bad = (y: number) => y > 0.8 || y < 0.1;
  let n = 0;
  if (p.subtitles.length && p.subtitleStyle.on !== false && bad(p.subtitleStyle.y)) n++;
  for (const s of p.shots) if (s.caption.text.trim() && bad(s.caption.y)) n++;
  return n;
}
