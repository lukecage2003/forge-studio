/** Model Registry: the catalogue of each provider as its API returns it, kept between sessions (no secret inside) */
import type { Capability, ModelInfo, ProviderId } from './types';
import { ADAPTERS, INFO } from './providers';
import { keyOf } from './vault';
import { getConfig } from './config';

const KEY = 'forge.ai.models';
let cat: Partial<Record<ProviderId, { at: string; models: ModelInfo[] }>> = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } })();

export async function refreshModels(id: ProviderId, signal?: AbortSignal): Promise<ModelInfo[]> {
  const a = ADAPTERS[id];
  if (!a) return [];
  const models = await a.listModels(keyOf(id), signal);
  cat[id] = { at: new Date().toISOString(), models };
  try { localStorage.setItem(KEY, JSON.stringify(cat)); } catch { /* */ }
  return models;
}
export const modelsOf = (id: ProviderId) => cat[id]?.models ?? [];
export const catalogueDate = (id: ProviderId) => cat[id]?.at ?? null;
export function setCatalogue(id: ProviderId, models: ModelInfo[]) { cat[id] = { at: new Date().toISOString(), models }; }
export function resetCatalogue() { cat = {}; }

/** the model to use on a provider for these needs: the user's choice, else the catalogue, else the provider's hint */
export function pickModel(id: ProviderId, needs: Capability[]): ModelInfo | null {
  const s = getConfig().providers[id];
  const transcribe = needs.includes('transcribe');
  const chosen = transcribe ? s.transcribeModel : s.model;
  const list = modelsOf(id);
  const fits = (m: ModelInfo) => needs.every((n) => m.caps.includes(n) || (n === 'json' && m.caps.includes('text')));
  if (chosen) return list.find((m) => m.id === chosen) ?? { id: chosen, provider: id, caps: [...needs], price: id === 'openrouter' ? undefined : null };
  const ok = list.filter(fits);
  if (ok.length) {
    // prefer verified-free models, then larger context
    return ok.sort((a, b) => Number(isZero(b)) - Number(isZero(a)) || (b.contextK ?? 0) - (a.contextK ?? 0))[0];
  }
  const hint = transcribe ? INFO[id].transcribeHint : INFO[id].hint;
  if (!hint || list.length) return null; // the catalogue says no model fits
  return { id: hint, provider: id, caps: [...needs], price: id === 'openrouter' ? (hint === 'openrouter/free' ? { input: 0, output: 0 } : undefined) : null };
}
export const isZero = (m: ModelInfo) => !!m.price && m.price.input === 0 && m.price.output === 0;
