/**
 * Quality control report: everything a careful editor checks before
 * publishing (rhythm, effects, sound, subtitles, safe zones, picture), with a
 * score, exportable as a standalone HTML page.
 */
import type { Project } from '../types';
import { FORMATS } from '../types';
import { layoutShots, videoDuration } from './timeline';
import { checkProject, safeZoneIssues, subtitleStats } from './qc';
import { sfxEvents } from './sfx';
import { voiceIntervals, type MixInfo } from './audio';
import { TRANSITION } from './effects';
import { PROFILE, type ProfileId } from './direction';
import { SEQ_FR, variety } from './director';
import { noiseReport, voiceReport } from './media';
import { voiceOf } from './audio';

function noiseRows(p: Project): Row[] {
  const vp = voiceOf(p);
  const dn = vp.denoise;
  const id = p.aroll?.mediaId ?? p.audio.find((c) => c.kind === 'voice')?.mediaId;
  if (!id) return [];
  const f1 = (v: number) => v.toFixed(1).replace('.', ',');
  const vr = voiceReport(id, vp);
  const radio: Row[] = vr ? [{ label: 'Voix radio', value: `écart phrases fortes / faibles ${f1(vr.levelSpreadBefore)} → ${f1(vr.levelSpreadAfter)} dB · « s » −${f1(vr.sibilanceCutDb)} dB · grondement −${f1(vr.rumbleCutDb)} dB`, level: 'ok' }] : [];
  if (dn === 'off') return [{ label: 'Réduction du bruit', value: 'désactivée', level: 'ok' }, ...radio];
  const r = noiseReport(id, vp);
  if (!r) return [{ label: 'Réduction du bruit', value: 'non mesurée', level: 'warn' }];
    return [
    { label: 'Bruit de fond de la prise', value: `${f1(r.noiseDb)} dBFS (voix à ${f1(r.snr)} dB au-dessus)`, level: r.snr < 15 ? 'warn' : 'ok', hint: 'Sous 15 dB d’écart, le bruit s’entend : rapproche le micro ou coupe la ventilation.' },
    { label: 'Réduction du bruit', value: r.applied ? `−${r.reductionDb} dB visés, bruit ramené à ${f1(r.noiseAfterDb)} dBFS` : 'inutile : prise propre', level: 'ok' },
    ...radio,
  ];
}

export type Level = 'ok' | 'warn' | 'error';
export interface Row { label: string; value: string; level: Level; hint?: string }
export interface Section { title: string; rows: Row[] }
export interface Report { name: string; date: string; score: number; sections: Section[]; issues: { level: 'error' | 'warn'; text: string }[] }

const f1 = (v: number) => v.toFixed(1).replace('.', ',');
const mmss = (s: number) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, '0')} s`;

export function buildReport(p: Project, mix?: MixInfo | null): Report {
  const vr = variety(layoutShots(p).map((t) => t.shot));
  const timed = layoutShots(p);
  const dur = videoDuration(p);
  const min = Math.max(dur / 60, 1e-6);
  const panels = timed.filter((t) => t.shot.pageId);
  const lens = timed.map((t) => t.shot.duration);
  const avg = lens.length ? lens.reduce((a, b) => a + b, 0) / lens.length : 0;
  const quiet = (tr: string) => tr === 'cut' || tr === 'glide';
  // soft dissolves are not counted as « marked » (same rule as the pre-export check)
  const marked = timed.filter((t) => !quiet(t.shot.transition) && t.shot.transition !== 'fade');
  const repeats = timed.filter((t, i) => i > 0 && !quiet(t.shot.transition) && t.shot.transition === timed[i - 1].shot.transition).length;
  const hist: Record<string, number> = {};
  for (const t of timed) hist[t.shot.transition] = (hist[t.shot.transition] ?? 0) + 1;
  const prof = p.direction?.profile ? PROFILE[p.direction.profile as ProfileId] : null;
  const strong = prof ? timed.filter((t) => prof.palette.strong.includes(t.shot.transition)).length : 0;
  const sfx = sfxEvents(p);
  const voice = voiceIntervals(p).reduce((a, [s, e]) => a + Math.max(0, Math.min(e, dur) - s), 0);
  const subs = subtitleStats(p);
  const zones = safeZoneIssues(p);
  const issues = checkProject(p).map((i) => ({ level: i.level, text: i.text }));
  const lv = (bad: boolean, warn = true): Level => (bad ? (warn ? 'warn' : 'error') : 'ok');

  const sections: Section[] = [
    { title: 'Rythme', rows: [
      { label: 'Durée', value: mmss(dur), level: dur > 0 ? 'ok' : 'error' },
      { label: 'Plans', value: `${timed.length} (dont ${panels.length} cases)`, level: 'ok' },
      { label: 'Durée moyenne d’un plan', value: `${f1(avg)} s`, level: lv(avg > 0 && (avg < 1 || avg > 9)), hint: 'Entre 1 et 9 s : en dessous on ne lit pas, au-dessus l’attention retombe.' },
      { label: 'Plan le plus court', value: lens.length ? `${f1(Math.min(...lens))} s` : '–', level: lv(lens.length > 0 && Math.min(...lens) < 0.7) },
      { label: 'Changements de plan par minute', value: f1(timed.length / min), level: 'ok' },
    ] },
    { title: 'Effets et transitions', rows: [
      { label: 'Direction créative', value: prof ? prof.label : 'aucune (réglages manuels)', level: 'ok' },
      { label: 'Transitions marquées par minute', value: f1(marked.length / min), level: lv(dur > 20 && marked.length / min > 12), hint: 'Au-delà de 12 par minute, le montage paraît chargé (mesuré sur les vidéos de plus de 20 s).' },
      ...(prof ? [{ label: 'Effets forts par minute', value: `${f1(strong / min)} (budget ${prof.budget.strong})`, level: lv(dur > 30 && strong / min > Math.max(1, prof.budget.strong) + 0.5) } as Row] : []),
      { label: 'Même transition deux fois de suite', value: String(repeats), level: lv(repeats > 0) },
      { label: 'Répartition', value: Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${TRANSITION[k as 'fade']?.label ?? k} ${n}`).join(' · '), level: 'ok' },
      { label: 'Séquences du directeur créatif', value: p.direction?.sequences?.length ? p.direction.sequences.map((q) => `${SEQ_FR[q.type as keyof typeof SEQ_FR] ?? q.type} (${q.label})`).join(' → ') : 'aucune (montage manuel ou directeur désactivé)', level: 'ok' },
      { label: 'Plus longue suite du même mouvement de caméra', value: String(vr.maxMotionRun), level: lv(vr.maxMotionRun >= 4), hint: 'Au-delà de 3, le regard s’endort.' },
      { label: 'Transitions réutilisées de près', value: String(vr.closeRepeats), level: lv(vr.closeRepeats > 0), hint: 'Une même transition à moins de trois transitions d’intervalle s’use.' },
      { label: 'Variété', value: `${vr.motions} mouvements de caméra, ${vr.transitions} transitions différentes`, level: 'ok' },
    ] },
    { title: 'Son', rows: [
      ...(mix ? [
        { label: 'Volume final', value: Number.isFinite(mix.after) ? `${f1(mix.after)} LUFS` : 'silence', level: lv(mix.target != null && Number.isFinite(mix.after) && Math.abs(mix.after - mix.target) > 1), hint: 'YouTube, TikTok et Instagram jouent autour de −14 LUFS.' },
        { label: 'Volume avant normalisation', value: Number.isFinite(mix.before) ? `${f1(mix.before)} LUFS (${mix.gainDb >= 0 ? '+' : ''}${f1(mix.gainDb)} dB)` : '–', level: 'ok' as Level },
        { label: 'Crête', value: `${f1(mix.peakDb)} dBFS`, level: lv(mix.peakDb > -1, false), hint: 'Au-dessus de −1 dBFS, risque de saturation après compression par la plateforme.' },
        { label: 'Écart de volume (LRA)', value: `${f1(mix.lra)} LU`, level: lv(mix.lra > 15), hint: 'Au-delà de 15 LU, des passages seront trop faibles sur téléphone.' },
      ] : [{ label: 'Volume', value: 'non mesuré (lance le rapport depuis l’export)', level: 'warn' as Level }]),
      { label: 'Voix présente', value: dur ? `${Math.round((voice / dur) * 100)} % du temps` : '–', level: 'ok' },
      { label: 'Bruitages automatiques', value: `${sfx.length} (${f1(sfx.length / min)} par minute)`, level: lv(timed.length > 4 && sfx.length >= timed.length * 0.8), hint: 'Jamais un son sur chaque transition.' },
      { label: 'Musique baissée sous la voix', value: p.ducking ? 'oui' : 'non', level: lv(!p.ducking && p.audio.some((c) => c.kind === 'music') && voice > 0) },
      { label: 'Nettoyage de la voix', value: p.mix?.voiceClean !== false ? 'oui (coupe-bas, compresseur, présence)' : 'non', level: 'ok' },
      ...noiseRows(p),
    ] },
    { title: 'Textes et lisibilité', rows: [
      { label: 'Sous-titres', value: String(subs.count), level: 'ok' },
      { label: 'Sous-titres trop rapides (> 20 caractères/s)', value: String(subs.fast), level: lv(subs.fast > 0) },
      { label: 'Sous-titres de moins de 0,5 s', value: String(subs.short), level: lv(subs.short > 2) },
      { label: 'Textes dans les zones des boutons (9:16)', value: p.format === '9:16' ? String(zones) : 'sans objet', level: lv(zones > 0), hint: 'TikTok et Shorts couvrent le bas (description) et le bord droit (boutons).' },
    ] },
    { title: 'Image', rows: [
      { label: 'Format', value: `${FORMATS[p.format].label} · ${FORMATS[p.format].w}×${FORMATS[p.format].h} (4K possible à l’export)`, level: 'ok' },
      { label: 'Grain et textures reproductibles', value: 'oui', level: 'ok' },
      { label: 'Fond', value: 'page floutée, jamais de noir', level: 'ok' },
    ] },
  ];
  const all = sections.flatMap((s) => s.rows);
  const score = Math.max(0, Math.min(100, 100 - 12 * issues.filter((i) => i.level === 'error').length - 4 * issues.filter((i) => i.level === 'warn').length
    - 6 * all.filter((r) => r.level === 'error').length - 3 * all.filter((r) => r.level === 'warn').length));
  return { name: p.name || 'Sans titre', date: new Date().toLocaleString('fr-FR'), score, sections, issues };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** a standalone page (no external file) to keep or send */
export function reportHtml(r: Report): string {
  const tag = (l: Level) => ({ ok: '<span class="t ok">OK</span>', warn: '<span class="t warn">À voir</span>', error: '<span class="t err">Problème</span>' }[l]);
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Contrôle qualité · ${esc(r.name)}</title><style>
:root{--bg:#0e0e11;--card:#17171c;--line:#2a2a31;--fg:#f1f1f3;--mut:#9a9aa4;--ok:#4ade80;--warn:#fbbf24;--err:#f87171;--acc:#ff5a1f}
@media (prefers-color-scheme:light){:root{--bg:#f6f6f4;--card:#fff;--line:#e3e3df;--fg:#16161a;--mut:#62626b;--ok:#15803d;--warn:#b45309;--err:#b91c1c}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:32px 16px}
main{max-width:860px;margin:auto;display:flex;flex-direction:column;gap:20px}h1{margin:0;font-size:26px}h2{margin:0 0 8px;font-size:17px}
.head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}.score{font-size:44px;font-weight:800;color:var(--acc)}.score small{font-size:16px;color:var(--mut)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px 18px}table{width:100%;border-collapse:collapse}
td{padding:7px 6px;border-top:1px solid var(--line);vertical-align:top}tr:first-child td{border-top:0}td:nth-child(2){font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
td:last-child{width:84px;text-align:right}.h{display:block;color:var(--mut);font-size:12.5px}.t{font-size:12px;font-weight:700;padding:3px 7px;border-radius:99px;border:1px solid currentColor}
.ok{color:var(--ok)}.warn{color:var(--warn)}.err{color:var(--err)}ul{margin:0;padding-left:18px}.mut{color:var(--mut)}
@media (max-width:560px){td:nth-child(2){white-space:normal}}
</style></head><body><main>
<div class="head"><div><h1>Contrôle qualité</h1><div class="mut">${esc(r.name)} · ${esc(r.date)} · Forge</div></div><div class="score">${r.score}<small> / 100</small></div></div>
${r.issues.length ? `<div class="card"><h2>À corriger avant de publier</h2><ul>${r.issues.map((i) => `<li class="${i.level === 'error' ? 'err' : 'warn'}"><span style="color:var(--fg)">${esc(i.text)}</span></li>`).join('')}</ul></div>` : '<div class="card ok">Aucun point bloquant.</div>'}
${r.sections.map((s) => `<div class="card"><h2>${esc(s.title)}</h2><table>${s.rows.map((row) => `<tr><td>${esc(row.label)}${row.hint ? `<span class="h">${esc(row.hint)}</span>` : ''}</td><td>${esc(row.value)}</td><td>${tag(row.level)}</td></tr>`).join('')}</table></div>`).join('')}
</main></body></html>`;
}
