import type { Project, Shot } from '../types';
import type { Sentence } from './narration';
import { matchLocal, panelDocs, type Assignment, type Doc } from './understand';
import { cosine, embed } from './embed';
import { geminiMatchStory, hasGoogle, type SchemaIdea } from './google';

/**
 * Decide which panels illustrate which sentence. Google understands meaning
 * (theories, cosmology, recaps, translations); the local matcher uses names,
 * numbers and shared words with a reading-order alignment.
 */
export interface StoryPlan { assign: (Assignment & { more: string[] })[]; schemas: SchemaIdea[]; engine: 'local' | 'google' }

/** semantic similarity sentence × panel with the local multilingual model (null if unavailable) */
async function semantic(sentences: Sentence[], docs: Doc[], onProgress?: (l: string, p: number) => void): Promise<Float32Array[] | undefined> {
  const withText = docs.filter((d) => d.text.trim().length > 12);
  if (!withText.length) return undefined;
  try {
    const sv = await embed(sentences.map((s) => s.text), onProgress);
    const dv = await embed(docs.map((d) => d.text.slice(0, 600)), onProgress);
    return sv.map((a) => Float32Array.from(dv, (b, j) => (docs[j].text.trim().length > 12 ? cosine(a, b) : 0)));
  } catch {
    return undefined; // offline or blocked: keywords + order still work
  }
}

export async function planStory(p: Project, panels: Shot[], sentences: Sentence[], engine: 'auto' | 'local' | 'google', onProgress?: (l: string, p: number) => void): Promise<StoryPlan> {
  // matching needs to know what each panel SAYS: read the balloons now if nobody did (once; kept in the project)
  const unread = panels.filter((s) => !s.text?.trim() && !s.desc?.trim());
  if (unread.length > panels.length * 0.4) {
    try {
      const { ocrPages } = await import('./understand');
      const texts = await ocrPages({ ...p, shots: unread }, (i, n) => onProgress?.(i < 0 ? 'Lecture des bulles : chargement du lecteur…' : `Lecture des bulles ${Math.min(n, i + 1)}/${n} (une seule fois)…`, n ? 0.1 + 0.25 * (i / n) : 0.1));
      for (const s of unread) { const t = texts.get(s.id); if (t) s.text = t; }
    } catch { /* offline: names in the script and the order of the story still guide the match */ }
  }
  const useGoogle = engine === 'google' || (engine === 'auto' && hasGoogle());
  if (useGoogle) {
    // short aliases keep the request small: P1, P2…
    const alias = new Map(panels.map((s, i) => [`P${i + 1}`, s.id]));
    const catalog = panels.map((s, i) => {
      const pg = p.pages.find((x) => x.id === s.pageId);
      const bits = [s.desc, s.text && `« ${s.text.slice(0, 90)} »`, s.chars?.length ? `(${s.chars.join(', ')})` : '', !s.desc && pg?.summary ? `page : ${pg.summary.slice(0, 120)}` : ''].filter(Boolean);
      return { id: `P${i + 1}`, line: `${pg?.name ?? ''} — ${bits.join(' ') || 'case sans description'}` };
    });
    const assign: StoryPlan['assign'] = [];
    const schemas: SchemaIdea[] = [];
    for (let k = 0; k < sentences.length; k += 70) {
      const chunk = sentences.slice(k, k + 70);
      const ctx = p.research ? `CONTEXTE (recherche) : ${p.research.title}. ${p.research.summary}\n` : '';
      const r = await geminiMatchStory(chunk.map((s) => s.text), catalog, undefined, ctx);
      for (const m of r.matches) {
        const ids = m.panels.map((a) => alias.get(a)).filter((x): x is string => !!x);
        if (m.sentence < 0 || m.sentence >= chunk.length) continue;
        assign.push({ sentence: k + m.sentence, shotId: ids[0] ?? null, conf: m.conf, alts: [], more: ids.slice(1) });
      }
      for (const sc of r.schemas) schemas.push({ ...sc, sentence: k + sc.sentence, items: sc.items.map((it) => ({ ...it, panel: alias.get(it.panel) ?? '' })).filter((it) => it.panel) });
    }
    // sentences Google skipped: fill from the local matcher so nothing is left empty
    const docsG = panelDocs(p, panels);
    const local = matchLocal(sentences, docsG, await semantic(sentences, docsG, onProgress));
    for (const l of local) if (!assign.some((a) => a.sentence === l.sentence)) assign.push({ ...l, conf: Math.min(l.conf, 0.4), more: [] });
    for (const a of assign) a.alts = local[a.sentence]?.alts.filter((x) => x !== a.shotId) ?? [];
    return { assign: assign.sort((a, b) => a.sentence - b.sentence), schemas, engine: 'google' };
  }
  const docs = panelDocs(p, panels);
  const sim = await semantic(sentences, docs, onProgress);
  return { assign: matchLocal(sentences, docs, sim).map((a) => ({ ...a, more: [] })), schemas: [], engine: 'local' };
}
