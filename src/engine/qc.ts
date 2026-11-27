import type { Project } from '../types';
import { FORMATS } from '../types';
import { getAudio, getImage, getVideo } from './media';
import { harmonize, measurePage } from './color';
import { sourceAudio } from './audioCheck';
import { layoutShots, videoDuration } from './timeline';
import { cameraAt, resolveMotion } from './render';
import { directSequences, motionClash, variety } from './director';
import { holdFor, HOLD_KIND_FR } from './hold';
import type { SeqType } from './director';
import { narration } from './narration';
import { buildSubtitles, timelineWords } from './auto';
import { applyNameFixes, hookCandidate, nameFixes, openWith, repeatedPanels } from './polish';

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
  // overlay tracks: a picture that can't be read would leave a hole in the export
  const lostOv = (p.overlays ?? []).filter((o) => (o.source.kind === 'image' && !getImage(o.source.mediaId)) || (o.source.kind === 'video' && !getVideo(o.source.mediaId)) || (o.source.kind === 'panel' && !p.pages.some((pg) => pg.id === (o.source as { pageId: string }).pageId)));
  if (lostOv.length) out.push({ level: 'error', text: `${lostOv.length} superposition(s) sans média lisible : réimporte le fichier ou supprime-la.`, at: lostOv[0].start, fix: { label: 'Retirer ces superpositions', apply: (x) => ({ ...x, overlays: (x.overlays ?? []).filter((o) => !lostOv.some((l) => l.id === o.id)) }) } });
  const longOv = (p.overlays ?? []).filter((o) => o.start + o.duration > dur + 0.05);
  if (longOv.length && dur > 0) out.push({ level: 'warn', text: `${longOv.length} superposition(s) dépasse(nt) la fin de la vidéo (${dur.toFixed(1)} s) : la fin ne sera pas exportée.`, at: longOv[0].start });
  if (dur <= 0) out.push({ level: 'error', text: 'La vidéo est vide.' });

  // colour: story pages of one comic that stand out (darker, greyer, faded scans)
  try {
    const measured = p.pages.filter((pg) => !pg.skip && !pg.tone && getImage(pg.mediaId)).map((pg) => { const a = getImage(pg.mediaId)!; return { id: pg.id, source: pg.source, kind: pg.kind, stats: measurePage(pg.mediaId, a.img, a.width, a.height) }; });
    const fixes = harmonize(measured);
    if (fixes.length) {
      const names = fixes.slice(0, 3).map((f) => `${p.pages.find((pg) => pg.id === f.id)?.name} (${f.why})`).join(', ');
      out.push({ level: 'warn', text: `${fixes.length} page${fixes.length > 1 ? 's' : ''} ne ressemble${fixes.length > 1 ? 'nt' : ''} pas aux autres du même numéro : ${names}${fixes.length > 3 ? '…' : ''}.`,
        fix: { label: 'Harmoniser les couleurs', apply: (x) => ({ ...x, pages: x.pages.map((pg) => { const f = fixes.find((y) => y.id === pg.id); return f ? { ...pg, tone: f.tone } : pg; }) }) } });
    }
  } catch { /* no picture decoded (tests, headless) */ }
  // sound at the source: a saturated or noisy recording can't be repaired by the mix
  for (const src of [...(p.aroll ? [{ id: p.aroll.mediaId, name: 'le rush' }] : []), ...p.audio.filter((a) => a.kind === 'voice').map((a) => ({ id: a.mediaId, name: `la voix « ${a.name} »` }))]) {
    const a = sourceAudio(src.id, getAudio(src.id));
    if (!a) continue;
    if (a.clippedRuns > 0) out.push({ level: a.clippedSec > 0.2 ? 'error' : 'warn', text: `Son saturé à l’enregistrement dans ${src.name} (${a.clippedRuns} passage${a.clippedRuns > 1 ? 's' : ''}, ${(a.clippedSec * 1000).toFixed(0)} ms) : le mixage ne peut pas le réparer ; réenregistre ces phrases ou baisse le gain du micro.` });
    if (a.lowLevel) out.push({ level: 'warn', text: `Voix enregistrée bas dans ${src.name} (${a.speechDb.toFixed(0)} dB) : le nettoyage la remonte, mais le souffle monte avec.` });
    if (a.noisy) out.push({ level: 'warn', text: `Bruit de fond élevé dans ${src.name} (voix ${(a.speechDb - a.noiseDb).toFixed(0)} dB au-dessus du fond) : active la réduction de bruit (Export → Voix).` });
  }

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

  /* ---------------- editorial review (recommendations only, never silent changes) */
  const ordered = timed.map((t) => t.shot);
  const v = variety(ordered);
  const redirect = { label: 'Laisser le directeur corriger', apply: (x: Project) => {
    const tt = layoutShots(x).map((t) => t.shot);
    const d = directSequences(tt, W / H, { transitions: true, camera: true, sequences: false }, x.readingOrder === 'rtl');
    const by = new Map(d.shots.map((s) => [s.id, s]));
    return { ...x, shots: x.shots.map((s) => by.get(s.id) ?? s) };
  } };
  if (v.maxMotionRun >= 4) out.push({ level: 'warn', text: `${v.maxMotionRun} cases de suite avec le même mouvement de caméra : le regard s’endort.`, fix: redirect });
  if (v.zoomChains >= 2) out.push({ level: 'warn', text: `Zooms enchaînés (${v.zoomChains} fois trois zooms avant d’affilée) : varie avec un plan tenu, un recul ou un travelling.`, fix: redirect });
  if (v.closeRepeats) out.push({ level: 'warn', text: `${v.closeRepeats} transition(s) réutilisée(s) à moins de trois transitions d’intervalle.`, fix: redirect });
  if (dur > 20) {
    const shakes = timed.filter((t) => t.shot.shake > 0.2).length / (dur / 60);
    if (shakes > 8) out.push({ level: 'warn', text: `${Math.round(shakes)} secousses par minute : trop de mouvement, garde-les pour les vrais impacts.` });
  }
  // how long each image stays, against what is in it (hold engine: balloons, reading time, kind, sequence)
  const voiced = !!p.aroll || p.audio.some((c) => c.kind === 'voice');
  const seqAt = (t: number) => p.direction?.sequences?.filter((q) => q.start <= t + 1e-3).pop()?.type as SeqType | undefined;
  const holds = timed.filter((t) => t.shot.pageId && !t.shot.diagram).map((t) => ({ t, h: holdFor(t.shot, { seq: seqAt(t.start), ranges: p.holds, pace: voiced ? 0.6 : 0.75, narrated: voiced }) }));
  const brief = holds.filter(({ t, h }) => t.shot.duration < h.min * 0.6 && (h.kind !== 'simple' || t.shot.duration < 1));
  if (brief.length) {
    const ex = brief[0];
    out.push({ level: 'warn', at: ex.t.start,
      text: `${brief.length} image(s) qui disparaissent avant d’être comprises (ex. ${ex.t.shot.duration.toFixed(1)} s pour ${HOLD_KIND_FR[ex.h.kind]} : ${ex.h.why}, il faut au moins ${ex.h.min.toFixed(1)} s).${voiced ? ' La voix décide ici : garde la case sur toute la phrase ou montre-la deux fois.' : ''}`,
      fix: voiced ? undefined : { label: 'Allonger jusqu’au temps de lecture', apply: (x) => ({ ...x, shots: x.shots.map((s) => { const m = brief.find((b) => b.t.shot.id === s.id); return m ? { ...s, duration: +m.h.min.toFixed(2) } : s; }) }) } });
  }
  // held for nothing: a long still image with a single framing
  const idle = holds.filter(({ t, h }) => t.shot.duration > h.max * 1.3 && !['tour', 'read'].includes(t.shot.motion) && t.shot.layout === 'full');
  if (idle.length) out.push({ level: 'warn', at: idle[0].t.start,
    text: `${idle.length} image(s) tenue(s) plus longtemps qu’un seul cadrage ne le supporte (ex. ${idle[0].t.shot.duration.toFixed(1)} s, au-delà de ${idle[0].h.max.toFixed(1)} s) : le regard décroche.`,
    fix: { label: 'Explorer l’image en étapes', apply: (x) => ({ ...x, shots: x.shots.map((s) => (idle.some((i) => i.t.shot.id === s.id) ? { ...s, motion: 'tour' as const } : s)) }) } });
  // transitions that fight the movement around them
  const clashes = timed.map((t, i) => (i ? { t, why: motionClash(timed[i - 1].shot, t.shot, t.shot.transition, seqAt(t.start)) } : null)).filter((x): x is { t: typeof timed[number]; why: string } => !!x?.why);
  if (clashes.length) out.push({ level: 'warn', at: clashes[0].t.start,
    text: `${clashes.length} transition(s) qui contredisent le mouvement (ex. ${clashes[0].why}) : une coupe franche passe mieux.`,
    fix: { label: 'Remplacer par des coupes', apply: (x) => ({ ...x, shots: x.shots.map((s) => (clashes.some((c) => c.t.shot.id === s.id) ? { ...s, transition: 'cut' as const, transitionDur: 0, tp: undefined } : s)) }) } });
  // too much animation overall
  if (dur > 20) {
    const moving = timed.filter((t) => ['whip', 'smear', 'slide', 'zoom', 'crosszoom', 'warp', 'warpspeed', 'impact', 'glitch', 'glitchdisplace'].includes(t.shot.transition)).length / (dur / 60);
    const shakes = timed.filter((t) => t.shot.shake > 0.2).length / (dur / 60);
    const strong = timed.filter((t) => t.shot.pageId).reduce((a, t) => a + t.shot.intensity, 0) / Math.max(1, timed.filter((t) => t.shot.pageId).length);
    const load = moving / 8 + shakes / 8 + Math.max(0, strong - 0.6) * 2 + (p.look?.handheld ?? 0);
    if (load > 2) out.push({ level: 'warn',
      text: `Animation excessive : ${Math.round(moving)} transitions de mouvement et ${Math.round(shakes)} secousses par minute, caméra à ${Math.round(strong * 100)} %. Le spectateur regarde l’effet, plus l’histoire.`,
      fix: { label: 'Calmer le montage', apply: (x) => ({ ...x, look: { ...x.look, handheld: Math.min(x.look.handheld ?? 0, 0.2) }, shots: x.shots.map((s) => ({ ...s, intensity: Math.min(s.intensity, 0.55), shake: Math.min(s.shake, 0.3) })) }) } });
  }
  // subtitles hard to read: too small, or white text without stroke or box on a light page
  if (p.subtitleStyle.on && p.subtitles.length) {
    const light = p.background === 'paper' || (p.background === 'color' && /^#?([c-f][0-9a-f]){3}/i.test(p.bgColor.replace('#', '')));
    const bare = p.subtitleStyle.preset === 'cinema' || p.subtitleStyle.preset === 'neon';
    if (p.subtitleStyle.size < 0.7) out.push({ level: 'warn', text: `Sous-titres trop petits pour un téléphone (taille ${Math.round(p.subtitleStyle.size * 100)} %).`, fix: { label: 'Agrandir', apply: (x) => ({ ...x, subtitleStyle: { ...x.subtitleStyle, size: 0.9 } }) } });
    if (light && bare) out.push({ level: 'warn', text: 'Sous-titres clairs sans contour sur un fond clair : ils se lisent mal.', fix: { label: 'Style « Propre » (fond sombre)', apply: (x) => ({ ...x, subtitleStyle: { ...x.subtitleStyle, preset: 'clean' as const } }) } });
  }
  // pages that are not story (variant cover, credits, ad) used in the edit
  const offStory = timed.filter((t) => { const pg = p.pages.find((x) => x.id === t.shot.pageId); return pg && pg.skip && pg.kind !== 'cover'; });
  if (offStory.length) out.push({ level: 'warn', at: offStory[0].start,
    text: `${offStory.length} plan(s) montrent une page hors récit (${[...new Set(offStory.map((t) => p.pages.find((x) => x.id === t.shot.pageId)?.kind))].join(', ')}) : elle n’illustre pas l’histoire.`,
    fix: { label: 'Retirer ces plans', apply: (x) => ({ ...x, shots: x.shots.filter((s) => !offStory.some((t) => t.shot.id === s.id)) }) } });
  // a panel placed for a sentence, but shown at another moment
  if (voiced) {
    const sents = narration(p).sentences;
    const drift = timed.filter((t) => { if (!t.shot.match) return false; const se = sents.find((x) => x.text === t.shot.match!.sentence); return se && (t.end < se.s - 0.5 || t.start > se.e + 0.5); });
    if (drift.length) out.push({ level: 'warn', at: drift[0].start, text: `${drift.length} case(s) montrée(s) à un autre moment que la phrase qu’elles illustrent (« ${drift[0].shot.match!.sentence.slice(0, 50)}… »). Recale-les ou relance le montage qui suit la narration.` });
  }
  // monotone stretch: same layout and only plain cuts for a long time
  let runStart = 0;
  for (let i = 1; i <= timed.length; i++) {
    const same = i < timed.length && timed[i].shot.layout === timed[i - 1].shot.layout && timed[i].shot.transition === 'cut' && timed[i].shot.motion === timed[i - 1].shot.motion;
    if (!same) {
      const span = timed[i - 1].end - timed[runStart].start;
      if (span > 25 && i - runStart >= 6) { out.push({ level: 'warn', at: timed[runStart].start, text: `Séquence monotone de ${Math.round(span)} s (même mise en page, même mouvement, rien que des coupes) : change de traitement au milieu.`, fix: redirect }); break; }
      runStart = i;
    }
  }
  // what is said with names or dates, while only the face is on screen
  if (p.aroll) {
    const sents = narration(p).sentences;
    const named = sents.filter((se) => /\b\p{Lu}\p{L}{2,}|\b(1[89]|20)\d{2}\b/u.test(se.text.slice(1)));
    const bare = named.filter((se) => !timed.some((t) => t.shot.pageId && t.start < se.e - 0.2 && t.end > se.s + 0.2));
    if (bare.length >= 2) out.push({ level: 'warn', at: bare[0].s, text: `${bare.length} phrase(s) qui citent un nom ou une date sans case à l’écran (ex. « ${bare[0].text.slice(0, 50)}… ») : une case ou un schéma aiderait.` });
  }
  // subtitles over the balloons of the panel on screen
  if (p.subtitleStyle.on && p.subtitles.length) {
    const band = [p.subtitleStyle.y - 0.06, p.subtitleStyle.y + 0.06];
    let covered = 0;
    for (const t of timed) {
      const s = t.shot;
      if (!s.balloons?.length || !s.pageId || s.layout !== 'full') continue;
      const vw = cameraAt(s, 0.5, W / H, p.readingOrder === 'rtl');
      const k = W / vw.vw;
      const hit = s.balloons.some((b) => {
        const y0 = (H / 2 + (b.y - vw.cy) * k) / H, y1 = (H / 2 + (b.y + b.h - vw.cy) * k) / H;
        return y1 > band[0] && y0 < band[1] && p.subtitles.some((sub) => sub.s < t.end && sub.e > t.start);
      });
      if (hit) covered++;
    }
    if (covered) out.push({ level: 'warn', text: `${covered} plan(s) où les sous-titres passent sur une bulle de la case.`,
      fix: { label: p.subtitleStyle.y > 0.5 ? 'Monter les sous-titres' : 'Descendre les sous-titres', apply: (x) => ({ ...x, subtitleStyle: { ...x.subtitleStyle, y: x.subtitleStyle.y > 0.5 ? 0.62 : 0.3 } }) } });
  }

  // pages whose reading order is a guess, used in the edit: ask, don't assume
  const doubtful = p.pages.filter((pg) => pg.orderDoubt && !pg.skip && p.shots.some((s) => s.pageId === pg.id));
  if (doubtful.length) out.push({ level: 'warn', text: `${doubtful.length} page(s) dont l’ordre de lecture est incertain (ex. ${doubtful[0].name} : ${doubtful[0].orderDoubt}). Vérifie l’ordre des cases dans l’éditeur de planche (« plus tôt / plus tard »).` });

  // story placements still to check
  const review = p.shots.filter((s) => s.match && s.match.conf < 0.5).length;
  if (review) out.push({ level: 'warn', text: `${review} case(s) associée(s) avec peu de certitude : vérifie-les (inspecteur du projet → « À vérifier »).` });

  // editorial polish (engine/polish): the opening, panels shown again and again, names in the subtitles
  const hook = hookCandidate(p);
  if (hook && p.shots[0]?.auto && hook.auto) out.push({ level: 'warn', text: 'Accroche : une case plus forte existe pour les 3 premières secondes (pleine page ou grande case d’action).', at: 0, fix: { label: 'Ouvrir sur la case la plus forte', apply: (x) => openWith(x, hook.id) } });
  for (const r of repeatedPanels(p).slice(0, 3)) out.push({ level: 'warn', text: `La même case revient ${r.shots.length} fois (${r.times.map((t) => t.toFixed(0) + ' s').join(', ')}) : le public la reconnaît, varie avec une autre case.`, at: r.times[1] ?? r.times[0] });
  const names = nameFixes(p);
  if (names.length) out.push({ level: 'warn', text: `Noms mal orthographiés dans les sous-titres : ${names.slice(0, 4).map((f) => `« ${f.from} » → « ${f.to} »`).join(', ')}.`, fix: { label: 'Corriger les noms', apply: (x) => ({ ...x, subtitles: applyNameFixes(x.subtitles, nameFixes(x)) }) } });
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
