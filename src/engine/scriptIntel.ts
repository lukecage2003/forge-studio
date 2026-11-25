/**
 * Script Intelligence: reads the narration before the edit. Splits it into
 * passages, gives each its role in the story (hook, argument, reveal, example,
 * comparison, proof, conclusion, change of pace) and finds the characters,
 * events, places, objects, concepts, dates and figures it mentions. From that
 * it proposes visuals (timeline, relation map, versus, scale, quote, keyword
 * title) built from the user's own panels. It never invents an image, an
 * event or a source: what is missing is asked for, not made up. Local, no API.
 */
import type { Project } from '../types';
import { narration, type Sentence } from './narration';
import { beatOf, type Beat } from './narrative';

export type Role = 'accroche' | 'contexte' | 'argument' | 'revelation' | 'exemple' | 'comparaison' | 'preuve' | 'conclusion' | 'transition';
export const ROLE_FR: Record<Role, string> = {
  accroche: 'Accroche', contexte: 'Contexte', argument: 'Argument', revelation: 'Révélation', exemple: 'Exemple',
  comparaison: 'Comparaison', preuve: 'Preuve', conclusion: 'Conclusion', transition: 'Changement de rythme',
};
export type EntityKind = 'personnage' | 'evenement' | 'lieu' | 'objet' | 'concept' | 'date' | 'chiffre' | 'nom';
export const KIND_FR: Record<EntityKind, string> = {
  personnage: 'Personnage', evenement: 'Événement', lieu: 'Lieu', objet: 'Objet', concept: 'Concept', date: 'Date', chiffre: 'Chiffre', nom: 'Nom propre',
};
export interface Entity { name: string; kind: EntityKind }
export interface Passage { i: number; text: string; s: number; e: number; role: Role; beat: Beat; entities: Entity[] }
export type SuggestionKind = 'chronologie' | 'reseau' | 'versus' | 'echelle' | 'citation' | 'titre' | 'carte';
export interface Suggestion { id: string; kind: SuggestionKind; passages: number[]; title: string; detail: string; items: { label: string; sub?: string }[]; needs?: string; at: number }
export interface ScriptAnalysis { passages: Passage[]; entities: { name: string; kind: EntityKind; count: number }[]; suggestions: Suggestion[]; source: 'audio' | 'script' | 'none' }

/* A small lexicon of the Marvel and DC universes (names as they are written in French). */
const LEX: Record<Exclude<EntityKind, 'date' | 'chiffre' | 'nom'>, string[]> = {
  personnage: ['Thor', 'Odin', 'Loki', 'Zeus', 'Hercule', 'Hulk', 'Iron Man', 'Tony Stark', 'Captain America', 'Steve Rogers', 'Black Panther', "T'Challa", 'Shuri', 'Storm', 'Tornade',
    'Wolverine', 'Magneto', 'Professeur X', 'Xavier', 'Jean Grey', 'Cyclope', 'Phénix', 'Dr Strange', 'Docteur Strange', 'Doctor Doom', 'Fatalis', 'Galactus', 'Silver Surfer', 'Surfer d’Argent', "Surfer d'Argent",
    'Thanos', 'Adam Warlock', 'Captain Marvel', 'Carol Danvers', 'Spider-Man', 'Peter Parker', 'Miles Morales', 'Daredevil', 'Punisher', 'Deadpool', 'Venom', 'Carnage', 'Namor', 'Sentry',
    'Scarlet Witch', 'Sorcière Rouge', 'Wanda', 'Vision', 'Mephisto', 'Dormammu', 'Knull', 'Living Tribunal', 'Tribunal Vivant', 'One Above All', 'Celestials', 'Célestes', 'Eternity', 'Éternité', 'Beyonder',
    'Superman', 'Clark Kent', 'Batman', 'Bruce Wayne', 'Wonder Woman', 'Diana', 'Flash', 'Barry Allen', 'Wally West', 'Green Lantern', 'Hal Jordan', 'Aquaman', 'Cyborg', 'Martian Manhunter', 'Shazam',
    'Darkseid', 'Lex Luthor', 'Joker', 'Docteur Manhattan', 'Dr Manhattan', 'Rorschach', 'Ozymandias', 'Le Comédien', 'Le Hibou', 'Spectre', 'Anti-Monitor', 'Monitor', 'Doomsday', 'Brainiac', 'Sinestro',
    'Black Adam', 'Constantine', 'Lucifer', 'The Presence', 'Perpetua', 'Barbatos', 'Supergirl', 'Zatanna', 'Nightwing', 'Robin', 'Harley Quinn', 'Gorr', 'Jane Foster', 'Valkyrie', 'Sif', 'Beta Ray Bill'],
  evenement: ['Civil War', 'Secret Wars', 'Secret Invasion', 'Infinity War', 'Infinity Gauntlet', 'House of M', 'Age of Apocalypse', 'Crisis on Infinite Earths', 'Crise sur les Terres Infinies', 'Infinite Crisis',
    'Final Crisis', 'Flashpoint', 'Dark Nights Metal', 'Death of Superman', 'Mort de Superman', 'Knightfall', 'Blackest Night', 'Ragnarok', 'Ragnarök', 'Annihilation', 'Fear Itself', 'Siege', 'Avengers vs X-Men', 'King in Black', 'War of the Realms', 'Watchmen', 'Doomsday Clock'],
  lieu: ['Wakanda', 'Asgard', 'Midgard', 'Olympe', 'Krypton', 'Gotham', 'Metropolis', 'Latvérie', 'Latveria', 'Oa', 'Apokolips', 'New Genesis', 'Themyscira', 'Atlantis', 'Atlantide', 'Knowhere', 'Sakaar',
    'Xandar', 'Hala', 'Titan', 'Mars', 'Terre', 'Lune', 'Antarctique', 'New York', 'Multivers', 'Microvers', 'Dimension Noire', 'Limbo', 'Les Limbes', 'Enfer', 'Mojoworld', 'Genosha'],
  objet: ['Mjolnir', 'Stormbreaker', 'Jarnbjorn', 'Gungnir', 'Gant de l’Infini', "Gant de l'Infini", 'Gemmes de l’Infini', "Gemmes de l'Infini", 'Gemme', 'Tesseract', 'Cosmic Cube', 'Cube Cosmique', 'anneau', 'Anneau de pouvoir',
    'bouclier', 'Vibranium', 'Adamantium', 'Uru', 'Kryptonite', 'Lasso de vérité', 'Œil d’Agamotto', "Œil d'Agamotto", 'Nécronomicon', 'Darkhold', 'Bâton de vibranium', 'Armure', 'Nanites'],
  concept: ['Odinforce', 'Thorforce', 'Force Phénix', 'Phoenix Force', 'Speed Force', 'Force Véloce', 'Pouvoir Cosmique', 'Power Cosmic', 'Source Wall', 'Mur de la Source', 'Anti-Life Equation', 'Équation Anti-Vie',
    'multivers', 'omnivers', 'Lumière Émeraude', 'Emotional Spectrum', 'Spectre émotionnel', 'magie', 'mutation', 'gène X', 'Hiérarchie cosmique', 'Panthéon', 'Dieu Panthère', 'Bast', 'Herbe-cœur', 'Herbe cœur', 'Empire Intergalactique'],
};
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");
/** proper nouns that are not characters (publishers, franchises, platforms) */
const NOT_PEOPLE = new Set(['marvel', 'dc', 'dc comics', 'comics', 'disney', 'star wars', 'netflix', 'youtube', 'tiktok', 'mcu', 'image comics', 'vertigo']);
const STOP = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'il', 'elle', 'ils', 'elles', 'on', 'et', 'mais', 'donc', 'or', 'ni', 'car', 'au', 'aux', 'en', 'dans', 'sur', 'pour', 'par', 'avec', 'sans',
  'ce', 'cet', 'cette', 'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'qui', 'que', 'quoi', 'dont', 'ou', 'oui', 'non', 'puis', 'alors', 'ensuite', 'enfin', 'bref', 'voila', 'pourtant', 'premier', 'premiere', 'ici',
  'aujourd', 'tout', 'tous', 'toute', 'toutes', 'quand', 'comment', 'pourquoi', 'parce', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'notre', 'votre', 'cela', 'ceci', 'ça', 'ca', 'si', 'meme', 'bon', 'au-dela', 'apres', 'avant', 'abonne', 'abonnez', 'regarde', 'regardez']);

function findEntities(text: string, extra: string[]): Entity[] {
  const t = ' ' + norm(text) + ' ';
  const out: Entity[] = [];
  const seen = new Set<string>();
  const push = (name: string, kind: EntityKind) => { const k = norm(name); if (!seen.has(k)) { seen.add(k); out.push({ name, kind }); } };
  for (const [kind, list] of Object.entries(LEX) as [EntityKind, string[]][]) {
    for (const n of [...list].sort((a, b) => b.length - a.length)) {
      const k = norm(n);
      const re = new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
      if (re.test(t) && ![...seen].some((s) => s.includes(k))) push(n, kind);
    }
  }
  for (const n of extra) { const k = norm(n); if (k.length > 2 && t.includes(' ' + k) && ![...seen].some((s) => s.includes(k))) push(n, 'personnage'); }
  // years, decades, issue numbers
  for (const m of text.matchAll(/\b(1[89]\d\d|20\d\d)\b|\bann[ée]es\s+(\d0)\b/g)) push(m[1] ?? `années ${m[2]}`, 'date');
  for (const m of text.matchAll(/\b(\d[\d\s.,]*\d|\d)\s*(%|millions?|milliards?|fois|tonnes?|km|kilom[eè]tres?|années-lumière|ans)\b/gi)) push(`${m[1].trim()} ${m[2]}`, 'chiffre');
  // other proper nouns not at the start of a sentence
  for (const m of text.matchAll(/(?<=[a-zà-ÿ,;:]\s)(\p{Lu}[\p{L}’'-]{2,}(?:\s\p{Lu}[\p{L}’'-]{2,})?)/gu)) {
    const k = norm(m[1]);
    if (!STOP.has(k) && !NOT_PEOPLE.has(k) && ![...seen].some((s) => s.includes(k) || k.includes(s))) push(m[1], 'nom');
  }
  return out;
}

const RX = {
  conclusion: /\b(en conclusion|au final|finalement|au fond|bref|voila pourquoi|c'est pour ca que|en resume|pour conclure|abonne)/,
  preuve: /(#\s?\d+|\bnumero\s?\d+|\bissue\b|\bpage\s?\d+|\bla preuve|\bprouve|\bon le voit|\bon voit|\bcomme le montre|\bselon\b|\bd'apres\b|\bofficiellement|\bcanon\b|\bconfirme)/,
  exemple: /\b(par exemple|comme quand|notamment|prenons|l'exemple|exemple)\b/,
  transition: /^(mais bon|passons|maintenant|revenons|ensuite|bon,|alors,|du coup)/,
  argument: /\b(parce que|car|puisque|c'est pour ca|ce qui explique|ce qui veut dire|cela signifie|autrement dit|en effet|donc)\b/,
  question: /\?\s*$/,
};

function roleOf(text: string, i: number, n: number, beat: Beat): Role {
  const t = norm(text);
  if (i === 0 || (i === 1 && RX.question.test(norm(text)))) return 'accroche';
  if (i >= n - 2 && (RX.conclusion.test(t) || i === n - 1)) return 'conclusion';
  if (RX.preuve.test(t)) return 'preuve';
  if (beat === 'compare') return 'comparaison';
  if (beat === 'reveal') return 'revelation';
  if (RX.exemple.test(t)) return 'exemple';
  if (RX.transition.test(t)) return 'transition';
  if (RX.argument.test(t)) return 'argument';
  return beat === 'cosmic' || beat === 'action' ? 'revelation' : 'contexte';
}

/** « 10 millions » → 10000000, « 2,5 milliards » → 2500000000 */
export function figureValue(s: string): number {
  const m = s.replace(/\s/g, '').match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return 0;
  const v = parseFloat(m[1].replace(',', '.'));
  const t = norm(s);
  return v * (/milliard/.test(t) ? 1e9 : /million/.test(t) ? 1e6 : 1);
}

let sid = 0;
const mk = (s: Omit<Suggestion, 'id'>): Suggestion => ({ id: `sg${++sid}`, ...s });

export function analyseScript(p: Project): ScriptAnalysis {
  const { sentences, source } = narration(p);
  const extra = [...new Set([...(p.research?.characters ?? []).flatMap((c) => [c.name, ...(c.aliases ?? [])]), ...p.shots.flatMap((s) => s.chars ?? [])])];
  const passages: Passage[] = sentences.map((s: Sentence, i) => {
    const beat = beatOf(s.text, i);
    return { i, text: s.text, s: s.s, e: s.e, beat, role: roleOf(s.text, i, sentences.length, beat), entities: findEntities(s.text, extra) };
  });
  const tally = new Map<string, { name: string; kind: EntityKind; count: number }>();
  for (const ps of passages) for (const e of ps.entities) {
    const k = norm(e.name);
    const cur = tally.get(k);
    if (cur) cur.count++; else tally.set(k, { ...e, count: 1 });
  }
  const entities = [...tally.values()].sort((a, b) => b.count - a.count);
  const suggestions: Suggestion[] = [];
  const of = (kind: EntityKind) => entities.filter((e) => e.kind === kind);

  // timeline: passages that carry dates
  const dated = passages.filter((ps) => ps.entities.some((e) => e.kind === 'date'));
  if (dated.length >= 2) suggestions.push(mk({
    kind: 'chronologie', passages: dated.map((d) => d.i), at: dated[0].s, title: 'Chronologie',
    detail: `${dated.length} dates dans le script : une frise les remet dans l'ordre.`,
    items: dated.slice(0, 6).map((d) => ({ label: d.entities.find((e) => e.kind === 'date')!.name, sub: (d.entities.find((e) => e.kind !== 'date')?.name ?? d.text.slice(0, 32)) })),
  }));
  // relation map: the most present characters
  // names next to a character, outside author credits, count as people
  const credit = /\b(raconte|ecrit|scenariste|dessine|dessinateur|auteur|signe|cree par)\b/;
  const nearPeople = new Set(passages.filter((ps) => !credit.test(norm(ps.text)) && ps.entities.filter((e) => e.kind === 'personnage' || e.kind === 'nom').length >= 2)
    .flatMap((ps) => ps.entities.filter((e) => e.kind === 'nom').map((e) => norm(e.name))));
  const people = of('personnage').concat(of('nom').filter((n) => n.count >= 2 || nearPeople.has(norm(n.name))));
  if (people.length >= 3) {
    const first = passages.find((ps) => ps.entities.some((e) => norm(e.name) === norm(people[0].name)))!;
    suggestions.push(mk({
      kind: 'reseau', passages: passages.filter((ps) => ps.entities.filter((e) => e.kind === 'personnage' || e.kind === 'nom').length >= 2).map((x) => x.i), at: first.s,
      title: 'Qui est lié à qui', detail: `${Math.min(6, people.length)} personnages reviennent : une carte des relations aide à suivre.`,
      items: people.slice(0, 6).map((e) => ({ label: e.name })),
    }));
  }
  // comparisons: versus between two names, or a scale when there are figures
  for (const ps of passages.filter((x) => x.role === 'comparaison' || x.beat === 'compare')) {
    const names = ps.entities.filter((e) => e.kind === 'personnage' || e.kind === 'nom');
    const figs = ps.entities.filter((e) => e.kind === 'chiffre');
    if (figs.length >= 2) suggestions.push(mk({ kind: 'echelle', passages: [ps.i], at: ps.s, title: 'Échelle', detail: 'Des chiffres comparés : des barres les rendent lisibles d’un coup d’œil.', items: figs.slice(0, 5).map((f) => ({ label: f.name, sub: String(figureValue(f.name)) })) }));
    else if (names.length >= 2) suggestions.push(mk({ kind: 'versus', passages: [ps.i], at: ps.s, title: `${names[0].name} contre ${names[1].name}`, detail: 'Une comparaison directe : un duel face à face.', items: names.slice(0, 2).map((e) => ({ label: e.name })) }));
  }
  // quotes from the comics
  for (const ps of passages) {
    const q = ps.text.match(/[«“"]\s*([^»”"]{8,140})\s*[»”"]/);
    if (q) suggestions.push(mk({ kind: 'citation', passages: [ps.i], at: ps.s, title: 'Citation', detail: 'Une réplique citée : en grand, avec sa source.', items: [{ label: q[1].trim(), sub: ps.entities.find((e) => e.kind === 'personnage')?.name ?? '' }],
      needs: 'Vérifie la source exacte (numéro, page) avant de publier.' }));
  }
  // places: a map needs a real map image from the user
  const places = of('lieu');
  if (places.length >= 2) {
    const first = passages.find((ps) => ps.entities.some((e) => e.kind === 'lieu'))!;
    suggestions.push(mk({ kind: 'carte', passages: passages.filter((ps) => ps.entities.some((e) => e.kind === 'lieu')).map((x) => x.i), at: first.s, title: 'Les lieux',
      detail: `${places.length} lieux cités (${places.slice(0, 4).map((x) => x.name).join(', ')}).`, items: places.slice(0, 6).map((e) => ({ label: e.name })),
      needs: 'Importe une case ou une carte tirée des comics pour chaque lieu : Forge n’en invente pas.' }));
  }
  // key concepts on reveals: the word itself, big, once
  const doneConcept = new Set<string>();
  for (const ps of passages.filter((x) => x.role === 'revelation' || x.role === 'accroche')) {
    const c = ps.entities.find((e) => (e.kind === 'concept' || e.kind === 'objet' || e.kind === 'evenement') && !doneConcept.has(norm(e.name)));
    if (!c) continue;
    doneConcept.add(norm(c.name));
    suggestions.push(mk({ kind: 'titre', passages: [ps.i], at: ps.s, title: c.name, detail: `Mot-clé à faire apparaître en grand (${KIND_FR[c.kind].toLowerCase()}).`, items: [{ label: c.name }] }));
  }
  suggestions.sort((a, b) => a.at - b.at);
  return { passages, entities, suggestions, source };
}

/** words to make stand out in subtitles: names, places, concepts, objects, events, figures (normalised, accents removed) */
export function keywordsOf(texts: string[], extra: string[] = []): Set<string> {
  const out = new Set<string>();
  const all = texts.join(' . ');
  for (const e of findEntities(all, extra)) {
    if (e.kind === 'date' || e.kind === 'chiffre') { for (const w of e.name.split(/\s+/)) if (/\d/.test(w)) out.add(norm(w)); continue; }
    for (const w of e.name.split(/\s+/)) if (w.length > 2) out.add(norm(w).replace(/[^a-z0-9'-]/g, ''));
  }
  for (const m of all.matchAll(/\b\d[\d.,]*\b/g)) out.add(m[0]);
  return out;
}
export const keyToken = (w: string) => norm(w).replace(/[^a-z0-9'-]/g, '').replace(/^(l|d|qu|j|n|s|c)'/, '');
