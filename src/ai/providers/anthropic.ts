/** Anthropic Messages API (paid, off by default; only with a real API key, never with a Claude Pro subscription) */
import { AiError, type AiAnswer, type ProviderAdapter } from '../types';
import { call } from './http';

const BASE = 'https://api.anthropic.com/v1';
const H = (key: string) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });

export const anthropic: ProviderAdapter = {
  id: 'anthropic',
  async listModels(key, signal) {
    if (!key) throw new AiError('auth', 'Anthropic : aucune clé enregistrée.');
    const d = await (await call(`${BASE}/models`, { headers: H(key), signal }, 'Anthropic')).json();
    return (d.data ?? []).map((m: { id: string; display_name?: string }) => ({ id: m.id, provider: 'anthropic' as const, label: m.display_name ?? m.id, caps: ['text', 'json', 'vision', 'long', 'stream'] as const, price: null })).map((m: { caps: readonly string[] }) => ({ ...m, caps: [...m.caps] })) as never;
  },
  async chat(key, model, task, signal): Promise<AiAnswer> {
    if (!key) throw new AiError('auth', 'Anthropic : aucune clé enregistrée.');
    const content: unknown[] = [{ type: 'text', text: task.prompt ?? '' }];
    for (const url of task.images ?? []) { const m = url.match(/^data:([^;]+);base64,(.*)$/); if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }); }
    const d = await (await call(`${BASE}/messages`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...H(key) }, body: JSON.stringify({ model, max_tokens: 4096, system: task.system, messages: [{ role: 'user', content }] }) }, 'Anthropic')).json();
    const text = (d.content ?? []).map((c: { text?: string }) => c.text ?? '').join('');
    if (!text) throw new AiError('invalid-answer', 'Anthropic : réponse vide.');
    return { text, usage: { inputTokens: d.usage?.input_tokens, outputTokens: d.usage?.output_tokens } };
  },
};
