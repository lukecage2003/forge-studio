/**
 * Forge AI Orchestrator: runs one task on the best allowed provider, falls
 * back in order, and accounts for every attempt.
 *
 *  Task Router      order = user's route for the task, filtered by capability,
 *                   cost mode, privacy, key, cooldown; local always last
 *  Cost Manager     zero mode: local, free tiers and verified-free models only
 *  Quota Manager    429 → wait what the provider says; bad key → stop using it
 *  Fallback         next candidate on any failure; never a model that can't do the task
 *  Privacy          « local only » sends nothing; first send of a data type asks consent
 *  Cache, History   same input twice = no second call; every attempt logged, without keys
 */
import { AiError, type AiAnswer, type AiTask, type AttemptLog, type ModelInfo, type ProviderId } from './types';
import { getConfig, routeFor, setConfig } from './config';
import { ADAPTERS, INFO } from './providers';
import { isZero, modelsOf, pickModel, refreshModels } from './models';
import { hasKey, keyOf, scrub } from './vault';
import { lastHardware } from '../engine/hardware';
import { cacheGet, cachePut, clearCool, coolDown, cooling, hashOf, logAttempt, monthCost, recordUse, slot } from './ledger';

const LOCALS: ProviderId[] = ['local', 'webllm', 'ollama', 'lmstudio'];

export type ConsentAsker = (p: ProviderId, data: string[]) => Promise<boolean>;
let asker: ConsentAsker = async () => false;
/** the UI plugs a dialog here; until then nothing leaves without consent */
export const setConsentAsker = (f: ConsentAsker) => { asker = f; };
export const getConsentAsker = () => asker;

/** why a provider is not used for a task, or null when it can be */
export function refusal(p: ProviderId, task: AiTask, model: ModelInfo | null): string | null {
  const c = getConfig();
  const s = c.providers[p];
  if (!s?.enabled) return 'désactivé';
  if (p !== 'local' && !ADAPTERS[p]) return 'pas d’adaptateur';
  if (c.localOnly && !LOCALS.includes(p)) return 'projet en « local uniquement »';
  if (INFO[p].needsKey && !hasKey(p)) return 'pas de clé';
  if (!INFO[p].direct && !c.bridge.token) return 'Forge Bridge non configuré';
  const cd = cooling(p);
  if (cd) return cd.why === 'auth' ? 'clé refusée' : `en pause (${cd.why})`;
  if (p === 'local') return null;
  if (p === 'webllm' && lastHardware && !lastHardware.webgpu) return 'pas de vraie carte graphique accessible (WebGPU)';
  if (!model) return 'aucun modèle adapté à cette tâche';
  if (task.needs.includes('transcribe') && !model.caps.includes('transcribe')) return 'ce modèle ne transcrit pas';
  if (task.needs.includes('vision') && !model.caps.includes('vision')) return 'ce modèle ne lit pas les images';
  return costRefusal(p, model);
}

/** the cost rules alone (mode Zéro coût, monthly budget): also used by the features that call a provider directly */
export function costRefusal(p: ProviderId, model: ModelInfo): string | null {
  const c = getConfig();
  const s = c.providers[p];
  if (!s) return null;
  const paidModel = s.billing === 'paid' || (s.billing === 'free-model' && !isZero(model)) || s.billing === 'trial';
  if (c.mode === 'zero' && paidModel) return s.billing === 'trial' ? 'crédits d’essai (pas gratuits durablement)' : 'payant ou prix inconnu (mode Zéro coût)';
  if (paidModel && s.billing !== 'trial' && monthCost() >= c.budget) return `budget du mois atteint (${c.budget} $)`;
  return null;
}

/** candidates in order, each with its model or the reason it is skipped */
export function plan(task: AiTask): { provider: ProviderId; model: ModelInfo | null; skip: string | null }[] {
  const order = routeFor(task.kind).filter((p, i, a) => a.indexOf(p) === i);
  if (!order.includes('local') && task.local) order.push('local');
  const out = order.map((p) => {
    const model = p === 'local' ? { id: 'forge-local', provider: 'local' as const, caps: [], price: { input: 0, output: 0 } } : pickModel(p, task.needs);
    let skip = refusal(p, task, model);
    if (!skip && p === 'local' && !task.local) skip = 'pas de version locale pour cette tâche';
    return { provider: p, model, skip };
  });
  // local providers last when the task is long and they are small? no: the user's order wins; local engine always last
  return [...out.filter((x) => x.provider !== 'local'), ...out.filter((x) => x.provider === 'local')];
}

export interface RunResult { answer: AiAnswer; provider: ProviderId; model: string; attempts: AttemptLog[]; cached: boolean }

const cost = (m: ModelInfo | null, a: AiAnswer) => (m?.price ? ((a.usage?.inputTokens ?? 0) * m.price.input + (a.usage?.outputTokens ?? 0) * m.price.output) / 1e6 : 0);

export async function run(task: AiTask & { local?: () => Promise<AiAnswer> }, signal?: AbortSignal): Promise<RunResult> {
  // OpenRouter: read the catalogue (with prices) before choosing, so « free » is checked, not assumed
  if (routeFor(task.kind).includes('openrouter') && getConfig().providers.openrouter.enabled && hasKey('openrouter') && !modelsOf('openrouter').length) {
    try { await refreshModels('openrouter', signal); } catch { /* keep the hint */ }
  }
  const steps = plan(task);
  const attempts: AttemptLog[] = [];
  const key = task.fresh ? null : await hashOf(JSON.stringify([task.kind, task.system, task.prompt, task.images?.length, task.audio?.size, task.language]));
  for (const st of steps) {
    if (st.skip) continue;
    const p = st.provider, m = st.model!;
    const sent = p === 'local' || LOCALS.includes(p) ? [] : task.data;
    // privacy: the first time a kind of data goes to a provider, ask
    if (sent.length) {
      const have = new Set(getConfig().consent[p] ?? []);
      const missing = sent.filter((d) => !have.has(d));
      if (missing.length) {
        const ok = await asker(p, missing);
        if (!ok) { attempts.push({ provider: p, model: m.id, ok: false, error: 'blocked', message: 'envoi refusé', ms: 0 }); continue; }
        setConfig((c) => ({ ...c, consent: { ...c.consent, [p]: [...new Set([...(c.consent[p] ?? []), ...missing])] } }));
      }
    }
    const ck = key ? `${key}:${p}:${m.id}` : null;
    const hit = ck ? cacheGet(ck) : null;
    if (hit) {
      const answer = JSON.parse(hit) as AiAnswer;
      const log = { provider: p, model: m.id, ok: true, ms: 0, cached: true };
      attempts.push(log);
      logAttempt({ ...log, t: new Date().toISOString(), task: task.kind, sent: [] });
      return { answer, provider: p, model: m.id, attempts, cached: true };
    }
    const t0 = performance.now();
    try {
      const answer = await slot(p, async () => {
        if (p === 'local') return task.local!();
        const a = ADAPTERS[p]!;
        const k = keyOf(p);
        if (task.needs.includes('transcribe')) {
          if (!a.transcribe) throw new AiError('unsupported', `${INFO[p].label} ne transcrit pas.`);
          return a.transcribe(k, m.id, task, signal);
        }
        if (!a.chat) throw new AiError('unsupported', `${INFO[p].label} ne fait pas de texte.`);
        return a.chat(k, m.id, task, signal);
      });
      if (task.json) JSON.parse(extractJson(answer.text)); // checked here: a broken answer falls back
      const ms = Math.round(performance.now() - t0);
      const c = cost(m, answer);
      recordUse(p, (answer.usage?.inputTokens ?? 0) + (answer.usage?.outputTokens ?? 0), c);
      clearCool(p);
      if (ck) cachePut(ck, JSON.stringify(answer));
      const log = { provider: p, model: m.id, ok: true, ms };
      attempts.push(log);
      logAttempt({ ...log, t: new Date().toISOString(), task: task.kind, sent, tokens: (answer.usage?.inputTokens ?? 0) + (answer.usage?.outputTokens ?? 0), cost: c });
      return { answer, provider: p, model: m.id, attempts, cached: false };
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      const err = e instanceof AiError ? e : e instanceof SyntaxError ? new AiError('invalid-answer', `${INFO[p].label} : réponse illisible.`) : new AiError('server', String((e as Error).message));
      const ms = Math.round(performance.now() - t0);
      if (err.kind === 'auth') coolDown(p, 'auth', 24 * 3600, err.message);
      else if (err.kind === 'quota') coolDown(p, 'quota', err.retryAfter ?? 60, err.message);
      else if (err.kind === 'network') coolDown(p, 'network', 30, err.message);
      else if (err.kind === 'server') coolDown(p, 'server', 20, err.message);
      const log = { provider: p, model: m.id, ok: false, error: err.kind, message: scrub(err.message), ms };
      attempts.push(log);
      logAttempt({ ...log, t: new Date().toISOString(), task: task.kind, sent });
    }
  }
  const why = steps.map((s) => `${INFO[s.provider].label} : ${s.skip ?? attempts.find((a) => a.provider === s.provider)?.message ?? 'échec'}`).join(' · ');
  throw new AiError('unsupported', `Aucune IA disponible pour cette tâche. ${why}`);
}

/** the JSON object inside an answer (models sometimes wrap it in ``` fences or text) */
export function extractJson(t: string): string {
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = (fenced ? fenced[1] : t).trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  const a2 = s.indexOf('['), b2 = s.lastIndexOf(']');
  if (a2 >= 0 && (a < 0 || a2 < a) && b2 > a2) return s.slice(a2, b2 + 1);
  return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}

/** connection test of one provider: lists its models (real call) */
export async function testProvider(p: ProviderId, signal?: AbortSignal): Promise<{ ok: boolean; models: number; message: string }> {
  try {
    if (p === 'local') return { ok: true, models: 0, message: 'Moteur local disponible.' };
    const models = await refreshModels(p, signal);
    clearCool(p);
    const free = models.filter(isZero).length;
    return { ok: true, models: models.length, message: `${models.length} modèle(s)${p === 'openrouter' ? `, dont ${free} gratuit(s) vérifié(s)` : ''}.` };
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError('network', String((e as Error).message));
    if (err.kind === 'auth') coolDown(p, 'auth', 24 * 3600, err.message);
    return { ok: false, models: 0, message: scrub(err.message) };
  }
}
