/**
 * One adapter for every OpenAI-compatible API (Groq, OpenRouter, Agnes,
 * NVIDIA, LM Studio, Ollama, OpenAI): same messages, same /models, same
 * /audio/transcriptions. What differs (base URL, headers, how the catalogue
 * describes prices and abilities) is given per provider.
 */
import { AiError, type AiAnswer, type AiTask, type Capability, type ModelInfo, type ProviderAdapter, type ProviderId } from '../types';
import { call } from './http';

interface Opts {
  id: ProviderId;
  label: string;
  base: () => string;
  headers?: (key: string | null) => Record<string, string>;
  needsKey?: boolean;
  /** the catalogue can be read without a key (OpenRouter) */
  publicModels?: boolean;
}

type RawModel = {
  id: string; name?: string; context_length?: number; context_window?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  owned_by?: string;
};

/** abilities and price as the catalogue states them; nothing is assumed when the catalogue is silent */
export function describe(id: ProviderId, m: RawModel): ModelInfo {
  const name = m.id.toLowerCase();
  const caps = new Set<Capability>();
  const inMods = m.architecture?.input_modalities ?? [];
  const outMods = m.architecture?.output_modalities ?? ['text'];
  const transcriber = /whisper|transcri|speech-to-text|stt/.test(name) && !/tts/.test(name);
  if (transcriber) caps.add('transcribe');
  else if (outMods.includes('text')) { caps.add('text'); caps.add('json'); caps.add('stream'); }
  if (inMods.includes('image') || /vision|-vl\b|vl-|llava|gemma-3|gemma-4|pixtral|agnes-(1\.5|2\.0|2\.5)-flash/.test(name)) caps.add('vision');
  const ctx = m.context_length ?? m.context_window;
  if (ctx && ctx >= 100_000) caps.add('long');
  let price: ModelInfo['price'] = null;
  if (m.pricing && m.pricing.prompt != null && m.pricing.completion != null) {
    const pi = Number(m.pricing.prompt), po = Number(m.pricing.completion);
    if (Number.isFinite(pi) && Number.isFinite(po) && pi >= 0 && po >= 0) price = { input: pi * 1e6, output: po * 1e6 };
  }
  return { id: m.id, provider: id, label: m.name ?? m.id, caps: [...caps], contextK: ctx ? Math.round(ctx / 1000) : undefined, price };
}

function content(task: AiTask) {
  if (!task.images?.length) return task.prompt ?? '';
  return [{ type: 'text', text: task.prompt ?? '' }, ...task.images.map((url) => ({ type: 'image_url', image_url: { url } }))];
}

export function openaiCompat(o: Opts): ProviderAdapter {
  const hdr = (key: string | null) => ({ ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(o.headers?.(key) ?? {}) });
  const need = (key: string | null) => { if (o.needsKey !== false && !key) throw new AiError('auth', `${o.label} : aucune clé enregistrée.`); };
  return {
    id: o.id,
    async listModels(key, signal) {
      if (!o.publicModels) need(key);
      const res = await call(`${o.base()}/models`, { headers: hdr(key), signal }, o.label);
      const d = await res.json();
      const list: RawModel[] = Array.isArray(d) ? d : (d.data ?? d.models ?? []);
      return list.filter((m) => m && m.id).map((m) => describe(o.id, m));
    },
    async chat(key, model, task, signal): Promise<AiAnswer> {
      need(key);
      const body: Record<string, unknown> = {
        model, temperature: 0.2,
        messages: [...(task.system ? [{ role: 'system', content: task.system }] : []), { role: 'user', content: content(task) }],
      };
      if (task.json) body.response_format = { type: 'json_object' };
      const send = (b: Record<string, unknown>) => call(`${o.base()}/chat/completions`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...hdr(key) }, body: JSON.stringify(b) }, o.label);
      let res: Response;
      try { res = await send(body); }
      catch (e) {
        // some models refuse the JSON mode: ask again in plain text (the answer is still checked)
        if (e instanceof AiError && e.kind === 'bad-request' && task.json && /response_format|json/i.test(e.message)) { delete body.response_format; res = await send(body); }
        else throw e;
      }
      const d = await res.json();
      const text = d?.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new AiError('invalid-answer', `${o.label} : réponse vide.`);
      return { text, usage: { inputTokens: d?.usage?.prompt_tokens, outputTokens: d?.usage?.completion_tokens } };
    },
    async transcribe(key, model, task, signal): Promise<AiAnswer> {
      need(key);
      if (!task.audio) throw new AiError('bad-request', 'Pas d’audio à transcrire.');
      const f = new FormData();
      f.append('file', task.audio, 'voix.wav');
      f.append('model', model);
      f.append('response_format', 'verbose_json');
      f.append('timestamp_granularities[]', 'word');
      f.append('timestamp_granularities[]', 'segment');
      if (task.language) f.append('language', task.language);
      f.append('temperature', '0');
      const res = await call(`${o.base()}/audio/transcriptions`, { method: 'POST', signal, headers: hdr(key), body: f }, o.label);
      const d = await res.json();
      const words = (d.words ?? []).map((w: { word: string; start: number; end: number }) => ({ w: String(w.word).trim(), s: w.start, e: w.end })).filter((w: { w: string }) => w.w);
      if (!words.length && !d.text) throw new AiError('invalid-answer', `${o.label} : transcription vide.`);
      return { text: d.text ?? '', words, usage: { seconds: d.duration } };
    },
  };
}
