/**
 * Local language model on the graphics card (WebLLM, Apache 2.0): runs in the
 * browser through WebGPU, offline once downloaded, nothing leaves the computer.
 * The model is downloaded once (hundreds of MB to a few GB), only when the user
 * turns this provider on.
 */
import { AiError, type AiAnswer, type ModelInfo, type ProviderAdapter } from '../types';
import { onRelease } from '../../engine/jobs';

type Engine = { chat: { completions: { create: (r: unknown) => Promise<{ choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } }> } }; unload: () => Promise<void> };
let engine: Engine | null = null;
let loadedModel = '';
let loading: Promise<Engine> | null = null;
const progressSubs = new Set<(text: string, p: number) => void>();
export const onWebllmProgress = (f: (text: string, p: number) => void) => (progressSubs.add(f), () => { progressSubs.delete(f); });
export const webllmLoaded = () => loadedModel;

onRelease('llm', () => { void engine?.unload(); engine = null; loadedModel = ''; });

/** the prebuilt models of WebLLM that Forge offers (instruction models, 4-bit), with their real VRAM needs */
export async function webllmModels(): Promise<ModelInfo[]> {
  const w = await import('@mlc-ai/web-llm');
  const list = (w.prebuiltAppConfig.model_list as { model_id: string; vram_required_MB?: number; low_resource_required?: boolean }[])
    .filter((m) => /^(Qwen2\.5-(0\.5|1\.5|3|7)B|Llama-3\.[12]-(3|8)B|SmolLM2-360M)-Instruct-q4f16_1-MLC$/.test(m.model_id));
  return list.map((m) => ({ id: m.model_id, provider: 'webllm', label: `${m.model_id.replace(/-q4f16_1-MLC$/, '')} · ${m.vram_required_MB ? Math.round(m.vram_required_MB / 100) / 10 + ' Go de mémoire vidéo' : ''}`, caps: ['text', 'json'], contextK: 4, price: { input: 0, output: 0 } }));
}

async function load(model: string): Promise<Engine> {
  if (engine && loadedModel === model) return engine;
  if (loading) return loading;
  if (!(navigator as Navigator & { gpu?: unknown }).gpu) throw new AiError('unsupported', 'IA locale : ce navigateur n’a pas accès à la carte graphique (WebGPU).');
  loading = (async () => {
    if (engine) { await engine.unload(); engine = null; }
    const w = await import('@mlc-ai/web-llm');
    // graphics cards without 16-bit shaders take the 32-bit build of the same model
    const ad = await (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<{ features: Set<string> } | null> } }).gpu?.requestAdapter();
    const id = ad && !ad.features.has('shader-f16') ? model.replace('q4f16_1', 'q4f32_1') : model;
    const e = (await w.CreateMLCEngine(id, { initProgressCallback: (r: { text: string; progress: number }) => progressSubs.forEach((f) => f(r.text, r.progress)) })) as unknown as Engine;
    engine = e; loadedModel = model;
    return e;
  })();
  try { return await loading; } catch (e) { throw new AiError('server', `IA locale : chargement impossible (${(e as Error).message}).`); } finally { loading = null; }
}

export const webllm: ProviderAdapter = {
  id: 'webllm',
  listModels: () => webllmModels(),
  async chat(_key, model, task): Promise<AiAnswer> {
    const { heavy } = await import('../../engine/jobs');
    return heavy('llm', async () => {
      const e = await load(model);
      const r = await e.chat.completions.create({
        messages: [...(task.system ? [{ role: 'system', content: task.system }] : []), { role: 'user', content: task.prompt ?? '' }],
        // WebLLM's forced-JSON mode fails without a schema (0.2.87): the prompt asks for JSON, the orchestrator checks it
        temperature: 0.2, max_tokens: 2048,
      });
      const text = r.choices?.[0]?.message?.content ?? '';
      if (!text) throw new AiError('invalid-answer', 'IA locale : réponse vide.');
      return { text, usage: { inputTokens: r.usage?.prompt_tokens, outputTokens: r.usage?.completion_tokens } };
    });
  },
};
