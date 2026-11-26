import type { PageKind, Word } from '../types';
import { SR } from './speech';

/**
 * Google AI (Gemini API) — optional. The key lives in Forge's encrypted vault
 * (src/ai/vault) and calls go straight from the browser to Google, through
 * the orchestrator's rules: local-only projects, consent, quotas, history.
 */
import { keyOf, setKey } from '../ai/vault';
import { getConfig, setConfig } from '../ai/config';
import { coolDown, cooling, logAttempt, recordUse } from '../ai/ledger';
import { getConsentAsker } from '../ai/orchestrator';
export interface GoogleSettings { apiKey: string; model: string; language: string }

const KEY = 'forge.google';
export const DEFAULT_MODEL = 'gemini-2.5-flash';

export function getGoogle(): GoogleSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { apiKey: keyOf('gemini') || v.apiKey || '', model: v.model || DEFAULT_MODEL, language: v.language || 'fr' };
  } catch {
    return { apiKey: keyOf('gemini') || '', model: DEFAULT_MODEL, language: 'fr' };
  }
}
export function setGoogle(s: GoogleSettings) {
  // the key goes to the encrypted vault; only the model and language stay in plain settings
  void setKey('gemini', s.apiKey);
  try { localStorage.setItem(KEY, JSON.stringify({ model: s.model, language: s.language })); } catch { /* storage blocked */ }
  if (s.model && s.model !== getConfig().providers.gemini.model) setConfig((c) => ({ ...c, providers: { ...c.providers, gemini: { ...c.providers.gemini, model: s.model } } }));
}
/** older versions kept the key in clear: move it into the vault once */
export async function migrateGoogleKey() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (v.apiKey) {
      if (!keyOf('gemini')) await setKey('gemini', v.apiKey);
      localStorage.setItem(KEY, JSON.stringify({ model: v.model, language: v.language }));
    }
  } catch { /* nothing to migrate */ }
}
export const hasGoogle = () => !!getGoogle().apiKey;
let lastSources: string[] = [];

async function generate(parts: unknown[], schema?: unknown, signal?: AbortSignal, tools?: unknown[]) {
  const g = getGoogle();
  if (!g.apiKey) throw new Error('Ajoute ta clé API Google (Gemini) dans les réglages.');
  const c = getConfig();
  if (c.localOnly) throw new Error('Projet en « local uniquement » : rien n’est envoyé à Google.');
  if (!c.providers.gemini.enabled) throw new Error('Gemini est désactivé dans le centre de contrôle IA.');
  const cd = cooling('gemini');
  if (cd) throw new Error(cd.why === 'auth' ? 'Clé Google refusée : corrige-la dans le centre de contrôle IA.' : 'Google en pause (quota) : réessaie un peu plus tard.');
  const sent = [...new Set((parts as { inline_data?: { mime_type?: string } }[]).map((p) => (p.inline_data ? (p.inline_data.mime_type?.startsWith('audio') ? 'audio' : 'images') : 'texte')))];
  const have = new Set(c.consent.gemini ?? []);
  const missing = sent.filter((d) => !have.has(d));
  if (missing.length) {
    if (!(await getConsentAsker()('gemini', missing))) throw new Error('Envoi à Google refusé.');
    setConfig((x) => ({ ...x, consent: { ...x.consent, gemini: [...new Set([...(x.consent.gemini ?? []), ...missing])] } }));
  }
  const t0 = performance.now();
  const logFail = (kind: 'auth' | 'quota' | 'server' | 'network' | 'bad-request', message: string) =>
    logAttempt({ t: new Date().toISOString(), task: 'gemini.feature', provider: 'gemini', model: g.model, ok: false, error: kind, message, ms: Math.round(performance.now() - t0), sent });
  let res0: Response;
  try {
    res0 = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(g.model)}:generateContent`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': g.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      ...(tools ? { tools } : {}),
      generationConfig: { temperature: 0, ...(schema ? { responseMimeType: 'application/json', responseSchema: schema } : {}) },
    }),
  });
  } catch (e) {
    if ((e as Error).name !== 'AbortError') { coolDown('gemini', 'network', 30, 'réseau'); logFail('network', 'Google injoignable'); }
    throw e;
  }
  const res = res0;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    if (res.status === 400 && /API key/i.test(msg) || res.status === 401 || res.status === 403) { coolDown('gemini', 'auth', 24 * 3600, 'clé'); logFail('auth', 'Clé refusée'); throw new Error('Clé API Google refusée : vérifie-la dans le centre de contrôle IA.'); }
    if (res.status === 429) { coolDown('gemini', 'quota', Number(res.headers.get('retry-after')) || 60, 'quota'); logFail('quota', 'Quota atteint'); throw new Error('Quota Google atteint : réessaie dans une minute ou vérifie ta facturation.'); }
    logFail(res.status >= 500 ? 'server' : 'bad-request', String(msg).slice(0, 120));
    throw new Error('Google : ' + msg);
  }
  const tokens = (data?.usageMetadata?.promptTokenCount ?? 0) + (data?.usageMetadata?.candidatesTokenCount ?? 0);
  recordUse('gemini', tokens, 0);
  logAttempt({ t: new Date().toISOString(), task: 'gemini.feature', provider: 'gemini', model: g.model, ok: true, ms: Math.round(performance.now() - t0), sent, tokens });
  const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
  lastSources = (data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []).map((c: { web?: { uri?: string; title?: string } }) => c.web?.title || c.web?.uri).filter(Boolean);
  return text;
}

export async function testGoogle() {
  const t = await generate([{ text: 'Réponds uniquement par le mot OK.' }]);
  return t.trim();
}

export function wav16(pcm: Float32Array): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

const b64 = async (b: Blob) => {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const WORDS_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: { w: { type: 'STRING' }, s: { type: 'NUMBER' }, e: { type: 'NUMBER' }, f: { type: 'BOOLEAN' } },
    required: ['w', 's', 'e'],
  },
};

/** Verbatim transcription (with hesitations) in 2-minute chunks. */
export async function geminiTranscribe(pcm: Float32Array, onProgress: (p: number) => void, signal?: AbortSignal): Promise<Word[]> {
  const lang = getGoogle().language === 'en' ? 'anglais' : 'français';
  const CH = 120 * SR;
  const out: Word[] = [];
  const n = Math.ceil(pcm.length / CH);
  for (let k = 0; k < n; k++) {
    const part = pcm.subarray(k * CH, Math.min(pcm.length, (k + 1) * CH));
    const offset = k * 120;
    const text = await generate([
      { inline_data: { mime_type: 'audio/wav', data: await b64(wav16(part)) } },
      {
        text:
          `Transcris cet audio en ${lang}, mot par mot, de façon STRICTEMENT verbatim : garde chaque hésitation ` +
          `(euh, heu, hum, mmh, bah…), chaque répétition et chaque faux départ, sans corriger. ` +
          `Pour chaque mot donne w (le mot, ponctuation collée au mot), s et e (début et fin en secondes depuis le début de CET extrait, au centième), ` +
          `et f=true si c'est une hésitation ou un mot de remplissage. Réponds uniquement avec le JSON.`,
      },
    ], WORDS_SCHEMA, signal);
    let arr: { w: string; s: number; e: number; f?: boolean }[] = [];
    try { arr = JSON.parse(text); } catch { throw new Error('Réponse de Google illisible pour la transcription.'); }
    for (const x of arr) {
      if (typeof x.s !== 'number' || typeof x.e !== 'number' || !x.w) continue;
      out.push({ w: x.w.trim(), s: offset + x.s, e: offset + Math.max(x.e, x.s + 0.05), filler: !!x.f });
    }
    onProgress((k + 1) / n);
  }
  return out.sort((a, b) => a.s - b.s);
}

/** Ask Gemini which panel illustrates which sentence. Returns panelId → sentence index. */
export async function geminiMatchPanels(
  panels: { id: string; jpeg: string }[],
  sentences: string[],
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const parts: unknown[] = [{
    text:
      `Tu es monteur vidéo pour une chaîne qui explique des comics. Voici le script découpé en phrases numérotées, ` +
      `puis des cases de BD identifiées. Associe chaque case à la phrase qu'elle illustre le mieux. ` +
      `Respecte l'ordre de lecture quand c'est plausible. Une phrase peut recevoir plusieurs cases.\n\n` +
      sentences.map((s, i) => `[${i}] ${s}`).join('\n'),
  }];
  for (const p of panels) {
    parts.push({ text: `Case ${p.id} :` });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: p.jpeg } });
  }
  const text = await generate(parts, {
    type: 'ARRAY',
    items: { type: 'OBJECT', properties: { panel: { type: 'STRING' }, sentence: { type: 'INTEGER' } }, required: ['panel', 'sentence'] },
  }, signal);
  const map: Record<string, number> = {};
  try {
    for (const m of JSON.parse(text)) if (typeof m.sentence === 'number') map[m.panel] = m.sentence;
  } catch { /* ignore */ }
  return map;
}

/** Hook / title suggestions from the transcript. */
export async function geminiHooks(transcript: string, signal?: AbortSignal): Promise<string[]> {
  const text = await generate([{
    text: `Voici le script d'une vidéo qui explique un comics :\n\n${transcript.slice(0, 12000)}\n\n` +
      `Propose 5 accroches courtes (max 8 mots) pour les 2 premières secondes d'un TikTok/Short, percutantes, sans clickbait mensonger.`,
  }], { type: 'ARRAY', items: { type: 'STRING' } }, signal);
  try { return JSON.parse(text); } catch { return []; }
}

/**
 * Panel boxes on a comic page with Gemini's object detection
 * (box_2d = [ymin, xmin, ymax, xmax] normalised to 0–1000), in reading order.
 */
export async function geminiPanels(jpegB64: string, rtl: boolean, signal?: AbortSignal): Promise<{ y0: number; x0: number; y1: number; x1: number }[]> {
  const text = await generate([
    { inline_data: { mime_type: 'image/jpeg', data: jpegB64 } },
    {
      text:
        `Détecte chaque case (panel) de cette page de bande dessinée. Une case = un cadre d'image distinct, ` +
        `pas une bulle ni un récitatif. Si la page est une seule illustration, renvoie une seule case. ` +
        `Donne box_2d = [ymin, xmin, ymax, xmax] normalisés de 0 à 1000, dans l'ordre de lecture ` +
        `(${rtl ? 'manga : de droite à gauche' : 'de gauche à droite'}, de haut en bas).`,
    },
  ], {
    type: 'ARRAY',
    items: { type: 'OBJECT', properties: { box_2d: { type: 'ARRAY', items: { type: 'NUMBER' } } }, required: ['box_2d'] },
  }, signal);
  let arr: { box_2d: number[] }[] = [];
  try { arr = JSON.parse(text); } catch { throw new Error('Réponse de Google illisible pour la détection des cases.'); }
  return arr
    .filter((b) => Array.isArray(b.box_2d) && b.box_2d.length === 4)
    .map(({ box_2d: [y0, x0, y1, x1] }) => ({ y0: y0 / 1000, x0: x0 / 1000, y1: y1 / 1000, x1: x1 / 1000 }))
    .filter((b) => b.x1 - b.x0 > 0.05 && b.y1 - b.y0 > 0.03);
}

const KINDS: PageKind[] = ['story', 'cover', 'variant', 'splash', 'spread', 'text', 'ad', 'blank'];

/** One request for up to 40 page thumbnails: what each page is. */
export async function geminiClassify(thumbs: string[], signal?: AbortSignal): Promise<(PageKind | null)[]> {
  const parts: unknown[] = [{
    text:
      `Voici ${thumbs.length} pages d'un comics, dans l'ordre. Pour chacune, donne son type : ` +
      `story (planche avec des cases), cover (couverture principale du numéro), variant (couverture variante, dos, illustration bonus), ` +
      `splash (illustration pleine page dans l'histoire), spread (double page), text (crédits, résumé, texte, courrier), ` +
      `ad (publicité, page d'un site de scans, annonce), blank (page vide). Réponds par un tableau de ${thumbs.length} types.`,
  }];
  thumbs.forEach((t, i) => { parts.push({ text: `Page ${i + 1} :` }); parts.push({ inline_data: { mime_type: 'image/jpeg', data: t } }); });
  const text = await generate(parts, { type: 'ARRAY', items: { type: 'STRING', enum: KINDS } }, signal);
  try {
    const arr = JSON.parse(text) as string[];
    return thumbs.map((_, i) => (KINDS.includes(arr[i] as PageKind) ? (arr[i] as PageKind) : null));
  } catch {
    return thumbs.map(() => null);
  }
}

/* ------------------------------------------------- comics understanding */

export interface PageReading {
  summary: string;
  panels: { box: { y0: number; x0: number; y1: number; x1: number }; desc: string; dialogue: string; characters: string[] }[];
}

/** Gemini reads up to 4 pages per request: summary, and every panel with what it shows and says. */
export async function geminiReadPages(jpegs: string[], signal?: AbortSignal): Promise<PageReading[]> {
  const parts: unknown[] = [{
    text:
      `Tu es documentaliste de comics. Pour chacune des ${jpegs.length} pages suivantes, donne : ` +
      `summary (2 phrases en français : ce qui se passe, qui, où, quand), et panels : chaque case dans l'ordre de lecture avec ` +
      `box_2d [ymin, xmin, ymax, xmax] normalisé 0-1000, desc (ce que montre la case, en français, précis : personnages, action, objets, lieu, concepts), ` +
      `dialogue (texte des bulles et récitatifs, dans la langue d'origine), characters (noms des personnages visibles ou nommés).`,
  }];
  jpegs.forEach((j, i) => { parts.push({ text: `Page ${i + 1} :` }); parts.push({ inline_data: { mime_type: 'image/jpeg', data: j } }); });
  const text = await generate(parts, {
    type: 'ARRAY',
    items: {
      type: 'OBJECT',
      properties: {
        summary: { type: 'STRING' },
        panels: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: { box_2d: { type: 'ARRAY', items: { type: 'NUMBER' } }, desc: { type: 'STRING' }, dialogue: { type: 'STRING' }, characters: { type: 'ARRAY', items: { type: 'STRING' } } },
            required: ['box_2d', 'desc'],
          },
        },
      },
      required: ['summary', 'panels'],
    },
  }, signal);
  let arr: { summary: string; panels: { box_2d: number[]; desc: string; dialogue?: string; characters?: string[] }[] }[] = [];
  try { arr = JSON.parse(text); } catch { throw new Error('Réponse de Google illisible pour la lecture des pages.'); }
  return jpegs.map((_, i) => {
    const r = arr[i] ?? { summary: '', panels: [] };
    return {
      summary: r.summary ?? '',
      panels: (r.panels ?? []).filter((p) => p.box_2d?.length === 4).map((p) => ({
        box: { y0: p.box_2d[0] / 1000, x0: p.box_2d[1] / 1000, y1: p.box_2d[2] / 1000, x1: p.box_2d[3] / 1000 },
        desc: p.desc ?? '', dialogue: p.dialogue ?? '', characters: p.characters ?? [],
      })),
    };
  });
}

export interface StoryMatch { sentence: number; panels: string[]; conf: number }
export interface SchemaIdea { kind: 'timeline' | 'network' | 'versus' | 'ranking'; title: string; sentence: number; items: { panel: string; label: string; sub?: string }[] }

/**
 * Semantic matching: which panels best illustrate each sentence of the narration
 * (explanations, theories, cosmology, recaps: meaning, not just shared words),
 * plus a few schema ideas when the narration lists dates, relations or a duel.
 */
export async function geminiMatchStory(sentences: string[], catalog: { id: string; line: string }[], signal?: AbortSignal, context = ''): Promise<{ matches: StoryMatch[]; schemas: SchemaIdea[] }> {
  const text = await generate([{
    text:
      `Tu es monteur pour une chaîne YouTube qui explique les comics (histoire, théories, cosmologie, personnages). ` +
      `Voici la narration découpée en phrases numérotées, puis le catalogue des cases disponibles (id : description). ` +
      `Pour CHAQUE phrase, choisis 1 à 3 cases qui l'illustrent le mieux (sens, pas seulement les mots ; la narration peut être en français et les comics en anglais), ` +
      `dans l'ordre où les montrer, et une confiance entre 0 et 1 (bas si aucune case ne convient vraiment). ` +
      `Respecte autant que possible l'ordre de l'histoire. Propose aussi 0 à 3 schémas utiles (frise si des dates/époques s'enchaînent, réseau si des liens entre personnages, ` +
      `versus si une opposition, ranking si un classement), avec les cases à utiliser.\n\n${context}PHRASES :\n` +
      sentences.map((s, i) => `[${i}] ${s}`).join('\n') +
      `\n\nCASES :\n` + catalog.map((c) => `${c.id} : ${c.line}`).join('\n'),
  }], {
    type: 'OBJECT',
    properties: {
      matches: { type: 'ARRAY', items: { type: 'OBJECT', properties: { sentence: { type: 'INTEGER' }, panels: { type: 'ARRAY', items: { type: 'STRING' } }, conf: { type: 'NUMBER' } }, required: ['sentence', 'panels', 'conf'] } },
      schemas: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            kind: { type: 'STRING', enum: ['timeline', 'network', 'versus', 'ranking'] }, title: { type: 'STRING' }, sentence: { type: 'INTEGER' },
            items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { panel: { type: 'STRING' }, label: { type: 'STRING' }, sub: { type: 'STRING' } }, required: ['panel', 'label'] } },
          },
          required: ['kind', 'title', 'sentence', 'items'],
        },
      },
    },
    required: ['matches'],
  }, signal);
  try {
    const o = JSON.parse(text);
    return { matches: o.matches ?? [], schemas: o.schemas ?? [] };
  } catch {
    throw new Error('Réponse de Google illisible pour l’association script ↔ cases.');
  }
}

/**
 * Background research with Google Search grounding: identifies the comics from
 * their titles and cover text and returns the cast (with aliases), a summary
 * and key facts. Feeds name correction, character tags and the matcher.
 */
export async function geminiResearch(titles: string[], hints: string, signal?: AbortSignal) {
  const text = await generate([{
    text:
      `Recherche sur le web ces comics : ${titles.join(' ; ')}.\nIndices (texte lu dans les pages) : ${hints.slice(0, 1500)}\n\n` +
      `Réponds UNIQUEMENT par un JSON : {"title": "...", "summary": "résumé en français (5-8 phrases : intrigue, époque, enjeux)", ` +
      `"characters": [{"name": "nom principal", "aliases": ["autres noms, identité civile, surnoms"], "role": "rôle en quelques mots"}], ` +
      `"facts": ["faits clés utiles pour une vidéo explicative : dates, auteurs, événements, concepts"]}`,
  }], undefined, signal, [{ google_search: {} }]);
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const o = JSON.parse(json);
    return { title: o.title ?? titles[0], summary: o.summary ?? '', characters: o.characters ?? [], facts: o.facts ?? [], sources: lastSources.slice(0, 8) };
  } catch {
    throw new Error('La recherche Google n’a pas renvoyé de résultat exploitable.');
  }
}
