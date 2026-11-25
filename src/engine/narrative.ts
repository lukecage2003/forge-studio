/**
 * Narrative analysis: what a sentence of the narration is doing, so the edit
 * can answer it (a reveal earns an accent, a date a clean informational wipe,
 * an emotional beat a slow dissolve, plain explanation a simple cut).
 * Local, rule-based, French and English.
 */
export type Beat = 'hook' | 'reveal' | 'action' | 'cosmic' | 'date' | 'compare' | 'emotion' | 'list' | 'plain';

export const BEAT_FR: Record<Beat, string> = {
  hook: 'accroche', reveal: 'révélation', action: 'action', cosmic: 'cosmique', date: 'date / chronologie',
  compare: 'comparaison', emotion: 'émotion', list: 'énumération', plain: 'explication',
};

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const RULES: [Beat, RegExp][] = [
  ['date', /\b(1[89]\d\d|20\d\d|annees? ?\d0|siecle|en \d{4}|decennie|epoque|des annees|plus tard|ans plus tard|years? later|back in|century|timeline|chronolog)/],
  ['compare', /\b(plus (fort|puissant|rapide)|moins (fort|puissant)|contre|versus|vs\.?|face a|compar|battre|bat |superieur|inferieur|stronger|weaker|faster than|than|beats?)\b/],
  ['cosmic', /\b(univers|multivers|cosmi|galax|etoile|dimension|infini|celeste|eternit|planete|soleil|trou noir|big bang|realites (alternatives|paralleles)|omnipoten|divin|dieu|space|cosmos|universe|galaxy|alternate realit|infinity)/],
  ['action', /\b(combat|frappe|frapper|coup|explos|detrui|tue|tuer|assassin|meurtr|attaque|bataille|guerre|ecrase|arrach|cogne|fight|punch|blast|destroy|kill|attack|battle|war|smash|crush)/],
  ['reveal', /\b(en fait|en realite|mais|pourtant|cependant|sauf que|or,|en verite|secret|reveal|revel|decouvr|personne ne sait|surprise|incroyable|vraiment|le pire|le plus fou|actually|but|however|turns out|twist|truth|nobody knows)\b/],
  ['emotion', /\b(mort\b|meurt\b|mourir|pleur|perd|perte|deuil|seul|tristesse|souffr|sacrifi|amour|aime|famille|regret|died|dies|death|cry|lost|loss|alone|love|grief|sacrifice)/],
  ['list', /\b(premier|premierement|deuxieme|troisieme|ensuite|enfin|d'abord|puis|first|second|third|then|finally|next)\b/],
];

/** the beat of a sentence; `index` 0 is the opening of the video */
export function beatOf(text: string, index = 1): Beat {
  if (index === 0) return 'hook';
  const t = norm(text || '');
  if (!t.trim()) return 'plain';
  const hits = RULES.filter(([, re]) => re.test(t)).map(([b]) => b);
  if (!hits.length) return /[!?]\s*$/.test(t) ? 'reveal' : 'plain';
  // order of RULES = priority; a reveal keeps the richer action/cosmic beat (both are strong), but wins over the others
  if (hits.includes('reveal')) return hits.find((b) => b === 'action' || b === 'cosmic') ?? 'reveal';
  return hits[0];
}

/** how much the edit should mark this beat: 0 calm, 1 accent, 2 strong */
export function beatWeight(b: Beat): 0 | 1 | 2 {
  if (b === 'hook' || b === 'reveal' || b === 'action' || b === 'cosmic') return 2;
  if (b === 'date' || b === 'compare' || b === 'list') return 1;
  return 0;
}
