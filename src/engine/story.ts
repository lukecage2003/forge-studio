import type { Project, Shot } from '../types';
import type { Sentence } from './narration';
import { matchLocal, panelDocs, type Assignment } from './understand';
import { geminiMatchStory, hasGoogle, type SchemaIdea } from './google';

/**
 * Decide which panels illustrate which sentence. Google understands meaning
 * (theories, cosmology, recaps, translations); the local matcher uses names,
 * numbers and shared words with a reading-order alignment.
 */
export interface StoryPlan { assign: (Assignment & { more: string[] })[]; schemas: SchemaIdea[]; engine: 'local' | 'google' }

export async function planStory(p: Project, panels: Shot[], sentences: Sentence[], engine: 'auto' | 'local' | 'google'): Promise<StoryPlan> {
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
      const r = await geminiMatchStory(chunk.map((s) => s.text), catalog);
      for (const m of r.matches) {
        const ids = m.panels.map((a) => alias.get(a)).filter((x): x is string => !!x);
        if (m.sentence < 0 || m.sentence >= chunk.length) continue;
        assign.push({ sentence: k + m.sentence, shotId: ids[0] ?? null, conf: m.conf, alts: [], more: ids.slice(1) });
      }
      for (const sc of r.schemas) schemas.push({ ...sc, sentence: k + sc.sentence, items: sc.items.map((it) => ({ ...it, panel: alias.get(it.panel) ?? '' })).filter((it) => it.panel) });
    }
    // sentences Google skipped: fill from the local matcher so nothing is left empty
    const local = matchLocal(sentences, panelDocs(p, panels));
    for (const l of local) if (!assign.some((a) => a.sentence === l.sentence)) assign.push({ ...l, conf: Math.min(l.conf, 0.4), more: [] });
    for (const a of assign) a.alts = local[a.sentence]?.alts.filter((x) => x !== a.shotId) ?? [];
    return { assign: assign.sort((a, b) => a.sentence - b.sentence), schemas, engine: 'google' };
  }
  return { assign: matchLocal(sentences, panelDocs(p, panels)).map((a) => ({ ...a, more: [] })), schemas: [], engine: 'local' };
}
