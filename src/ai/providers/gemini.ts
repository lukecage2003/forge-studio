/** Google Gemini, native API (generateContent). The key is the one of the Gemini API, not the Gemini app subscription. */
import { AiError, type AiAnswer, type ModelInfo, type ProviderAdapter } from '../types';
import { call } from './http';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const gemini: ProviderAdapter = {
  id: 'gemini',
  async listModels(key, signal) {
    if (!key) throw new AiError('auth', 'Gemini : aucune clé enregistrée.');
    const res = await call(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal }, 'Gemini');
    const d = await res.json();
    return (d.models ?? [])
      .filter((m: { supportedGenerationMethods?: string[] }) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: { name: string; displayName?: string; inputTokenLimit?: number }): ModelInfo => {
        const id = m.name.replace(/^models\//, '');
        const multimodal = /gemini/.test(id) && !/embedding|aqa|imagen|tts/.test(id);
        return {
          id, provider: 'gemini', label: m.displayName ?? id,
          caps: ['text', 'json', 'stream', ...(multimodal ? ['vision', 'transcribe'] as const : []), ...((m.inputTokenLimit ?? 0) >= 100_000 ? ['long'] as const : [])],
          contextK: m.inputTokenLimit ? Math.round(m.inputTokenLimit / 1000) : undefined,
          price: null,
        };
      });
  },
  async chat(key, model, task, signal): Promise<AiAnswer> {
    if (!key) throw new AiError('auth', 'Gemini : aucune clé enregistrée.');
    const parts: unknown[] = [{ text: (task.system ? task.system + '\n\n' : '') + (task.prompt ?? '') }];
    for (const url of task.images ?? []) {
      const m = url.match(/^data:([^;]+);base64,(.*)$/);
      if (m) parts.push({ inline_data: { mime_type: m[1], data: m[2] } });
    }
    const res = await call(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.2, ...(task.json ? { responseMimeType: 'application/json' } : {}) } }),
    }, 'Gemini');
    const d = await res.json();
    const text = d?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
    if (!text) throw new AiError('invalid-answer', 'Gemini : réponse vide (contenu filtré ?).');
    return { text, usage: { inputTokens: d?.usageMetadata?.promptTokenCount, outputTokens: d?.usageMetadata?.candidatesTokenCount } };
  },
};
