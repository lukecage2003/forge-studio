import type { Project } from '../types';
import { comicNames } from './lexicon';
import { PLATFORMS, type PlatformId } from './delivery';

/**
 * PUBLICATION KIT — the text that goes with the video on each platform,
 * written locally from what the project knows (no AI, no invention):
 * the hook of the script, the series named in the imported files, the
 * characters found in the script and in the panels. Each field says where
 * it comes from; everything is a proposal the user edits before posting.
 * Posting itself stays manual: official upload APIs need a developer account
 * per platform, and nothing is sent anywhere from here.
 */

export interface Post {
  platform: PlatformId;
  title: string;
  description: string;
  hashtags: string[];
  /** where each part comes from, shown to the user */
  sources: string[];
}

const words = (s: string) => s.replace(/\s+/g, ' ').trim();
const tag = (s: string) => '#' + s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+(\p{L})?/gu, (_, c: string | undefined) => (c ? c.toUpperCase() : '')).replace(/^\p{L}/u, (c) => c.toUpperCase());

/** series named in the imported files: « The Ultimates (2015) 001.pdf » → The Ultimates */
export function seriesOf(p: Project): string[] {
  const out = new Map<string, number>();
  for (const pg of p.pages) {
    // loose pictures have no series: their « source » is only the word « images »
    if (!pg.source || pg.source === 'images') continue;
    const src = pg.source.replace(/\.[a-z0-9]{2,4}$/i, '');
    const name = words(src.replace(/[_.]/g, ' ').replace(/\(?\b(19|20)\d{2}\b\)?/g, ' ').replace(/#?\b\d{1,4}\b.*$/, ' ').replace(/\b(vol|v|n°|no|tome|issue)\.?\s*$/i, ''));
    if (name.length >= 3 && /\p{L}{3}/u.test(name)) out.set(name, (out.get(name) ?? 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
}

/** the first sentence of the script: the hook */
export function hookOf(p: Project): string {
  const s = (p.script ?? '').split(/(?<=[.!?…])\s+/).map(words).find((x) => x.length > 12);
  return s ?? '';
}

export function buildPost(p: Project, id: PlatformId): Post {
  const pf = PLATFORMS[id];
  const sources: string[] = [];
  const series = seriesOf(p);
  const names = comicNames(p).filter((n) => n.strong).map((n) => n.name).slice(0, 6);
  const hook = hookOf(p);
  const title = words(p.name && !/^nouveau projet|sans titre/i.test(p.name) ? p.name : hook || series[0] || 'Vidéo comics').slice(0, id === 'shorts' ? 100 : 150);
  sources.push(p.name ? 'titre : nom du projet' : hook ? 'titre : première phrase du script' : 'titre : série importée');
  const lines = [hook, series.length ? `📚 ${series.slice(0, 2).join(' · ')}` : '', names.length ? `Noms cités : ${names.slice(0, 4).join(', ')}.` : ''].filter(Boolean);
  if (hook) sources.push('description : accroche du script');
  if (series.length) sources.push(`série : nom des fichiers importés (${series[0]})`);
  if (names.length) sources.push(`noms cités : trouvés dans le script et les cases (${names.slice(0, 3).join(', ')})`);
  const pool = [...series.slice(0, 1).map(tag), ...names.slice(0, 3).map(tag), '#comics', id === 'shorts' ? '#shorts' : id === 'tiktok' ? '#comicstok' : '#bd'];
  const hashtags = [...new Set(pool.filter((h) => h.length > 2))].slice(0, pf.hashtagsMax);
  const description = words(lines.join('\n')) ? lines.join('\n') + `\n\n${hashtags.join(' ')}` : hashtags.join(' ');
  return { platform: id, title, description, hashtags, sources };
}

/** the text file of a post, ready to paste */
export function postText(post: Post) {
  return `${PLATFORMS[post.platform].label}\n\nTITRE\n${post.title}\n\nDESCRIPTION\n${post.description}\n\nHASHTAGS\n${post.hashtags.join(' ')}\n\nD’OÙ VIENT CE TEXTE\n- ${post.sources.join('\n- ')}\n\nÀ relire avant de publier : rien n’a été envoyé.\n`;
}
