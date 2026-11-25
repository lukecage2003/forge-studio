import type { Project, Word } from '../types';

/**
 * Names of the comic (characters, places, teams) gathered from everything
 * Forge knows: the web research, the panels' characters, the user's script,
 * and words that recur across pages. Used to fix names that speech
 * recognition misspells ("Janie" → "Janey") and to tag panels with characters.
 */
const COMMON = new Set(('about after again against all also always another around because been before being between both came come could does down each even every first from going good great have here into just know like little long look made make many more most much must never only other over said same should since some still such take than that their them then there these they thing think this those through time under very want well were what when where which while will with would your yeah okay right something nothing everything anything people world never really cette leurs alors avant après encore toujours jamais rien tout tous aussi comme quand puis parce quelque chose monde temps').split(' '));

const norm = (w: string) => w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

export interface Name { name: string; aliases: string[]; strong: boolean }

export function comicNames(p: Project): Name[] {
  const map = new Map<string, Name>();
  const add = (name: string, strong: boolean, aliases: string[] = []) => {
    const k = norm(name);
    if (k.length < 3 || COMMON.has(k)) return;
    const cur = map.get(k);
    if (cur) { cur.strong ||= strong; cur.aliases.push(...aliases); } else map.set(k, { name, aliases, strong });
  };
  for (const c of p.research?.characters ?? []) add(c.name, true, c.aliases ?? []);
  for (const s of p.shots) for (const c of s.chars ?? []) add(c, true);
  // capitalised words of the script (not after a full stop)
  for (const m of (p.script ?? '').matchAll(/(?<![.!?]\s)(?<!^)\b(\p{Lu}[\p{L}'’-]{3,})/gu)) add(m[1], true);
  // words recurring on several pages of the comic
  const pagesOf = new Map<string, Set<string>>();
  for (const s of p.shots) {
    for (const t of (s.text ?? '').split(/\s+/)) {
      const k = norm(t);
      if (k.length < 5 || COMMON.has(k)) continue;
      (pagesOf.get(k) ?? pagesOf.set(k, new Set()).get(k)!).add(s.pageId ?? '');
    }
  }
  for (const [k, pg] of pagesOf) if (pg.size >= 3 && !map.has(k)) add(k.charAt(0).toUpperCase() + k.slice(1), false);
  return [...map.values()];
}

function lev(a: string, b: string) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}

/** rough phonetic key (French + English): how a name sounds, not how it's spelt */
function phon(k: string) {
  return k
    .replace(/ph/g, 'f').replace(/[ckq]+/g, 'k').replace(/z/g, 's').replace(/dt\b|d\b/g, 't')
    .replace(/(ey|ie|y|ee|ea)/g, 'i').replace(/(ou|oo|w)/g, 'u').replace(/(eau|au|o)/g, 'o')
    .replace(/h/g, '').replace(/(.)\1+/g, '$1').replace(/e\b/g, '');
}

/** fix misspelt names in a transcript; returns the corrected words and how many changed */
export function correctNames(words: Word[], names: Name[]): { words: Word[]; fixed: number } {
  // every part of a multi-word name is a form of its own ("Janey Slater" → Janey, Slater)
  const forms = names.flatMap((n) => [n.name, ...n.aliases].flatMap((f) => [f, ...f.split(/\s+/)]).map((f) => ({ f, k: norm(f), strong: n.strong })))
    .filter((x) => x.k.length >= 4);
  let fixed = 0;
  const out = words.map((w) => {
    const m = /^([^\p{L}]*)([\p{L}'’-]+)([^\p{L}]*)$/u.exec(w.w);
    if (!m || !/^\p{Lu}/u.test(m[2])) return w;
    const k = norm(m[2]);
    if (k.length < 4 || COMMON.has(k)) return w;
    let best: { f: string; sim: number } | null = null;
    for (const x of forms) {
      if (Math.abs(x.k.length - k.length) > 3) continue;
      const a = phon(k), b = phon(x.k);
      const sim = Math.max(1 - lev(k, x.k) / Math.max(k.length, x.k.length), 1 - lev(a, b) / Math.max(a.length, b.length, 1));
      if (sim >= (x.strong ? 0.75 : 0.84) && norm(x.f) !== k && (!best || sim > best.sim)) best = { f: x.f, sim };
    }
    if (!best) return w;
    fixed++;
    return { ...w, w: m[1] + best.f + m[3] };
  });
  return { words: out, fixed };
}

/** add characters to panels whose text mentions them (local, after OCR) */
export function tagCharacters(p: Project): Project {
  const names = comicNames(p).filter((n) => n.strong);
  if (!names.length) return p;
  return {
    ...p,
    shots: p.shots.map((s) => {
      if (!s.text) return s;
      const t = ' ' + norm(s.text.replace(/\s+/g, ' ')).replace(/\s/g, '') + ' ';
      const raw = ' ' + s.text.toLowerCase() + ' ';
      const hits = names.filter((n) => [n.name, ...n.aliases].some((f) => f.length >= 3 && (raw.includes(' ' + f.toLowerCase()) || t.includes(norm(f)))));
      if (!hits.length) return s;
      return { ...s, chars: [...new Set([...(s.chars ?? []), ...hits.map((h) => h.name)])] };
    }),
  };
}
