/**
 * Forge AI Orchestrator: shared types. Every provider is described by what it
 * can really do; a task says what it needs; the router only pairs them when
 * the capabilities, the cost mode and the privacy rules allow it.
 */
export type ProviderId = 'local' | 'gemini' | 'groq' | 'openrouter' | 'agnes' | 'cloudflare' | 'nvidia' | 'ollama' | 'lmstudio' | 'openai' | 'anthropic';

/** what a model can take or produce */
export type Capability = 'text' | 'json' | 'vision' | 'transcribe' | 'long' | 'stream';

/** how a provider is paid for: free tier (no billing on the account), verified free model, trial credits, paid, or local */
export type Billing = 'local' | 'free-tier' | 'free-model' | 'trial' | 'paid';

export type Mode = 'zero' | 'balanced' | 'quality';

export interface ModelInfo {
  id: string;
  provider: ProviderId;
  label?: string;
  caps: Capability[];
  /** thousands of tokens of context, when known */
  contextK?: number;
  /** price per million tokens (input, output) in USD when the provider publishes it; 0 = verified free */
  price?: { input: number; output: number } | null;
}

export type TaskKind =
  | 'script.analyse' | 'script.review' | 'audio.transcribe' | 'captions.punctuate' | 'assistant' | 'classify' | 'connection.test'
  /** the historical Gemini features of Forge (panel reading, matching, research…) */
  | 'gemini.feature';

/** what leaves the computer with a task */
export type DataKind = 'texte' | 'audio' | 'images';

export interface AiTask {
  kind: TaskKind;
  /** chat messages for text models */
  system?: string;
  prompt?: string;
  /** a JSON answer is expected (checked before use) */
  json?: boolean;
  /** audio to transcribe (16 kHz mono WAV) */
  audio?: Blob;
  language?: string;
  /** images given to vision models (data: URLs) */
  images?: string[];
  needs: Capability[];
  data: DataKind[];
  /** characters of input, for routing (long scripts go to long-context models) */
  size?: number;
  /** skip the cache */
  fresh?: boolean;
  /** the same task done by Forge itself, offline (last resort) */
  local?: () => Promise<AiAnswer>;
}

export interface Usage { inputTokens?: number; outputTokens?: number; seconds?: number }

export interface AiAnswer {
  text: string;
  words?: { w: string; s: number; e: number }[];
  usage?: Usage;
}

export type ErrorClass = 'auth' | 'quota' | 'network' | 'server' | 'bad-request' | 'unsupported' | 'blocked' | 'invalid-answer';

export class AiError extends Error {
  kind: ErrorClass;
  retryAfter?: number;
  status?: number;
  constructor(kind: ErrorClass, message: string, extra: { retryAfter?: number; status?: number } = {}) {
    super(message);
    this.kind = kind;
    this.retryAfter = extra.retryAfter;
    this.status = extra.status;
  }
}

/** one provider adapter: the common operations it really supports */
export interface ProviderAdapter {
  id: ProviderId;
  listModels(key: string | null, signal?: AbortSignal): Promise<ModelInfo[]>;
  chat?(key: string | null, model: string, task: AiTask, signal?: AbortSignal): Promise<AiAnswer>;
  transcribe?(key: string | null, model: string, task: AiTask, signal?: AbortSignal): Promise<AiAnswer>;
}

export interface AttemptLog { provider: ProviderId; model: string; ok: boolean; error?: ErrorClass; message?: string; ms: number; cached?: boolean }
