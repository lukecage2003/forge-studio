import type { OverlayPlace, Project, Rect } from '../types';
import { FORMATS } from '../types';
import { narration } from './narration';
import { layoutShots } from './timeline';

/**
 * Overlay proposals read in the script, laid on the voice's timing: a comparison
 * asks for two panels side by side, « meanwhile » for another place in a corner,
 * a reminder for an earlier panel. Only the user's own panels are proposed, and
 * nothing is applied before the user accepts it (AssistantModal).
 */
export interface OverlayProposal { type: 'overlay.add'; at: number; duration: number; pageId: string; rect: Rect; place: OverlayPlace; raison: string }

const CUES: { re: RegExp; kind: 'compare' | 'meanwhile' | 'recall'; why: string }[] = [
  { re: /\b(alors que|tandis que|contrairement à|face à|comparé à|par rapport à|à l[’']inverse|versus|vs\.?)\b/i, kind: 'compare', why: 'comparaison : les deux côte à côte' },
  { re: /\b(pendant ce temps|au même moment|en parallèle|simultanément|ailleurs)\b/i, kind: 'meanwhile', why: 'action simultanée : l’autre lieu en incrustation' },
  { re: /\b(plus tôt|souviens|rappelez-vous|rappel|auparavant|déjà vu|flash-?back)\b/i, kind: 'recall', why: 'rappel : la case d’avant en incrustation' },
];

export function suggestOverlays(p: Project): OverlayProposal[] {
  const { sentences } = narration(p);
  const timed = layoutShots(p).filter((t) => t.shot.pageId);
  if (!sentences.length || timed.length < 2) return [];
  const vertical = FORMATS[p.format].h > FORMATS[p.format].w;
  const out: OverlayProposal[] = [];
  for (const s of sentences) {
    const cue = CUES.find((c) => c.re.test(s.text));
    if (!cue) continue;
    const at = s.s, duration = Math.max(1.5, Math.min(6, s.e - s.s));
    // never on top of an overlay the user already placed
    if ((p.overlays ?? []).some((o) => o.start < at + duration && at < o.start + o.duration)) continue;
    const i = timed.findIndex((t) => at >= t.start && at < t.end);
    const cur = timed[Math.max(0, i)];
    // the other panel: a later one of another page (compare, meanwhile), an earlier one (recall)
    const pick = cue.kind === 'recall'
      ? [...timed.slice(0, Math.max(0, i))].reverse().find((t) => t.shot.pageId !== cur.shot.pageId) ?? timed[Math.max(0, i - 1)]
      : timed.slice(i + 1).find((t) => t.shot.pageId !== cur.shot.pageId) ?? timed[i + 1];
    if (!pick || pick.shot.id === cur.shot.id || !pick.shot.pageId) continue;
    const place: OverlayPlace = cue.kind === 'compare' ? (vertical ? 'bottom' : 'right') : 'pip';
    out.push({ type: 'overlay.add', at: +at.toFixed(2), duration: +duration.toFixed(2), pageId: pick.shot.pageId, rect: pick.shot.rect, place, raison: `« ${s.text.slice(0, 70)}${s.text.length > 70 ? '…' : ''} » — ${cue.why}` });
  }
  return out.slice(0, 8);
}
