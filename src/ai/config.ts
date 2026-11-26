/**
 * Orchestrator settings: mode, budget, providers, routing, privacy.
 * Stored in this browser, without any secret (keys live in the vault).
 */
import type { Billing, Mode, ProviderId, TaskKind } from './types';

export interface ProviderSettings {
  enabled: boolean;
  /** how this account is billed: the user says it, Forge cannot check it */
  billing: Billing;
  /** chosen model per use; empty = let Forge pick from the catalogue */
  model?: string;
  transcribeModel?: string;
  /** local servers and Forge Bridge */
  baseUrl?: string;
}

export interface AiConfig {
  mode: Mode;
  /** monthly ceiling in USD for paid calls (balanced and quality modes) */
  budget: number;
  providers: Record<ProviderId, ProviderSettings>;
  /** priority order per task (first = preferred) */
  routes: Partial<Record<TaskKind, ProviderId[]>>;
  /** send nothing outside this computer */
  localOnly: boolean;
  /** what the user already agreed to send, per provider (« texte », « audio », « images ») */
  consent: Partial<Record<ProviderId, string[]>>;
  /** Forge Bridge (local helper): address and pairing token */
  bridge: { url: string; token: string };
}

const P = (enabled: boolean, billing: Billing, extra: Partial<ProviderSettings> = {}): ProviderSettings => ({ enabled, billing, ...extra });

export const DEFAULT_ROUTES: Record<TaskKind, ProviderId[]> = {
  'script.analyse': ['gemini', 'agnes', 'openrouter', 'groq', 'ollama', 'lmstudio', 'local'],
  'script.review': ['agnes', 'openrouter', 'gemini', 'groq', 'ollama', 'lmstudio', 'local'],
  'audio.transcribe': ['groq', 'gemini', 'local'],
  'captions.punctuate': ['groq', 'openrouter', 'gemini', 'ollama', 'lmstudio', 'local'],
  assistant: ['gemini', 'agnes', 'openrouter', 'groq', 'ollama', 'lmstudio', 'local'],
  classify: ['cloudflare', 'groq', 'openrouter', 'ollama', 'lmstudio', 'local'],
  'connection.test': ['local'],
  'gemini.feature': ['gemini'],
};

export function defaultConfig(): AiConfig {
  return {
    mode: 'zero',
    budget: 0,
    providers: {
      local: P(true, 'local'),
      gemini: P(true, 'free-tier'),
      groq: P(true, 'free-tier'),
      openrouter: P(true, 'free-model'),
      agnes: P(true, 'free-tier'),
      cloudflare: P(false, 'free-tier'),
      nvidia: P(false, 'trial'),
      ollama: P(false, 'local', { baseUrl: 'http://localhost:11434' }),
      lmstudio: P(false, 'local', { baseUrl: 'http://localhost:1234' }),
      openai: P(false, 'paid'),
      anthropic: P(false, 'paid'),
    },
    routes: {},
    localOnly: false,
    consent: {},
    bridge: { url: 'http://127.0.0.1:7878', token: '' },
  };
}

const KEY = 'forge.ai';
let cfg: AiConfig | null = null;
const subs = new Set<() => void>();

export function getConfig(): AiConfig {
  if (cfg) return cfg;
  const base = defaultConfig();
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<AiConfig>;
    cfg = { ...base, ...v, providers: { ...base.providers }, bridge: { ...base.bridge, ...(v.bridge ?? {}) } };
    for (const id of Object.keys(base.providers) as ProviderId[]) cfg.providers[id] = { ...base.providers[id], ...(v.providers?.[id] ?? {}) };
  } catch { cfg = base; }
  return cfg;
}

export function setConfig(patch: Partial<AiConfig> | ((c: AiConfig) => AiConfig)) {
  const cur = getConfig();
  cfg = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* storage blocked */ }
  subs.forEach((f) => f());
}
export const onConfig = (f: () => void) => (subs.add(f), () => { subs.delete(f); });
export const routeFor = (k: TaskKind) => getConfig().routes[k] ?? DEFAULT_ROUTES[k];
/** tests and reset */
export function resetConfig(c: AiConfig = defaultConfig()) { cfg = c; try { localStorage.removeItem(KEY); } catch { /* */ } }
