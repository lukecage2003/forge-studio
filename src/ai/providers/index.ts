/**
 * Provider Manager: every provider Forge can use, with what Forge knows for
 * sure about it. Free offers are described, never assumed: limits are read
 * from the provider's answers and the user's own console.
 */
import type { ProviderAdapter, ProviderId } from '../types';
import { getConfig } from '../config';
import { openaiCompat } from './openaiCompat';
import { gemini } from './gemini';
import { anthropic } from './anthropic';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  role: string;
  site: string;
  keyUrl?: string;
  /** the browser may call it directly (checked on 25/11/2026), else Forge Bridge is needed */
  direct: boolean;
  needsKey: boolean;
  /** first model to try before the catalogue has been read */
  hint?: string;
  transcribeHint?: string;
  free: string;
  privacy: string;
  /** generation of images or video exists on this API and is never used by Forge */
  noGeneration?: boolean;
}

const bridge = (path: string) => () => getConfig().bridge.url.replace(/\/$/, '') + path;
const bridgeHeaders = () => ({ 'X-Forge-Token': getConfig().bridge.token });
const local = (id: 'ollama' | 'lmstudio') => () => (getConfig().providers[id].baseUrl ?? '').replace(/\/$/, '') + '/v1';

export const PROVIDERS: ProviderInfo[] = [
  { id: 'local', label: 'Forge local', role: 'Toujours disponible, hors ligne : Whisper dans le navigateur, analyse du script par règles', site: '', direct: true, needsKey: false, free: 'Gratuit, sur cet ordinateur', privacy: 'Rien ne sort de l’ordinateur' },
  { id: 'gemini', label: 'Google Gemini', role: 'Longs scripts, images des cases, recherche', site: 'https://ai.google.dev', keyUrl: 'https://aistudio.google.com/apikey', direct: true, needsKey: true, hint: 'gemini-2.5-flash',
    free: 'Free tier de l’API Gemini (limites par modèle, voir AI Studio). L’abonnement Gemini Pro ne donne pas de crédit API.', privacy: 'Sur le free tier, Google peut utiliser les contenus envoyés pour améliorer ses produits.' },
  { id: 'groq', label: 'Groq', role: 'Transcription Whisper rapide, texte court', site: 'https://console.groq.com', keyUrl: 'https://console.groq.com/keys', direct: true, needsKey: true, hint: 'llama-3.3-70b-versatile', transcribeHint: 'whisper-large-v3-turbo',
    free: 'Free tier avec limites de débit par modèle (console Groq).', privacy: 'Voir les conditions de Groq ; Forge t’indique avant chaque premier envoi ce qui part.' },
  { id: 'openrouter', label: 'OpenRouter', role: 'Secours, comparaison, modèles gratuits', site: 'https://openrouter.ai', keyUrl: 'https://openrouter.ai/keys', direct: true, needsKey: true, hint: 'openrouter/free',
    free: 'En mode Zéro coût, seuls les modèles dont le prix lu dans le catalogue est 0 sont utilisés. Limites quotidiennes selon le compte.', privacy: 'Les fournisseurs de modèles gratuits peuvent journaliser les requêtes.' },
  { id: 'agnes', label: 'Agnes AI', role: 'Deuxième lecture éditoriale, classification, images en entrée', site: 'https://agnes-ai.com', keyUrl: 'https://platform.agnes-ai.com/', direct: true, needsKey: true, hint: 'agnes-2.0-flash', noGeneration: true,
    free: 'Compte gratuit : limites de débit sur les modèles texte (catalogue Agnes, valeurs de référence susceptibles de changer).', privacy: 'Voir les conditions d’Agnes AI. La génération d’images et de vidéos de cette API n’est jamais utilisée par Forge.' },
  { id: 'cloudflare', label: 'Cloudflare Workers AI', role: 'Classification, résumé léger', site: 'https://developers.cloudflare.com/workers-ai/', direct: false, needsKey: false, hint: '@cf/meta/llama-3.1-8b-instruct',
    free: 'Allocation gratuite quotidienne (tableau de bord Cloudflare).', privacy: 'Cloudflare refuse les appels directs depuis un site web : passe par Forge Bridge, qui garde la clé.' },
  { id: 'nvidia', label: 'NVIDIA NIM', role: 'Expérimentation', site: 'https://build.nvidia.com', direct: false, needsKey: false, hint: 'meta/llama-3.1-8b-instruct',
    free: 'Crédits d’essai : pas une offre gratuite permanente (refusé en mode Zéro coût).', privacy: 'Appels directs refusés par NVIDIA : passe par Forge Bridge.' },
  { id: 'ollama', label: 'Ollama', role: 'IA locale hors ligne', site: 'https://ollama.com', direct: true, needsKey: false,
    free: 'Gratuit, sur ton ordinateur.', privacy: 'Rien ne sort de l’ordinateur. Lance Ollama avec OLLAMA_ORIGINS autorisant ce site.' },
  { id: 'lmstudio', label: 'LM Studio', role: 'IA locale hors ligne', site: 'https://lmstudio.ai', direct: true, needsKey: false,
    free: 'Gratuit, sur ton ordinateur.', privacy: 'Rien ne sort de l’ordinateur. Active « CORS » dans le serveur local de LM Studio.' },
  { id: 'openai', label: 'OpenAI (API)', role: 'Optionnel, payant', site: 'https://platform.openai.com', keyUrl: 'https://platform.openai.com/api-keys', direct: true, needsKey: true, hint: 'gpt-4o-mini', transcribeHint: 'whisper-1',
    free: 'Payant. L’abonnement ChatGPT Go ne donne pas d’accès API.', privacy: 'Voir les conditions d’OpenAI.' },
  { id: 'anthropic', label: 'Anthropic (API)', role: 'Optionnel, payant', site: 'https://console.anthropic.com', keyUrl: 'https://console.anthropic.com/settings/keys', direct: true, needsKey: true, hint: 'claude-haiku-4-5',
    free: 'Payant. L’abonnement Claude Pro ne donne pas d’accès API.', privacy: 'Voir les conditions d’Anthropic.' },
];
export const INFO = Object.fromEntries(PROVIDERS.map((p) => [p.id, p])) as Record<ProviderId, ProviderInfo>;

export const ADAPTERS: Partial<Record<ProviderId, ProviderAdapter>> = {
  gemini,
  anthropic,
  groq: openaiCompat({ id: 'groq', label: 'Groq', base: () => 'https://api.groq.com/openai/v1' }),
  openrouter: openaiCompat({ id: 'openrouter', label: 'OpenRouter', base: () => 'https://openrouter.ai/api/v1', headers: () => ({ 'X-Title': 'Forge' }), publicModels: true }),
  agnes: openaiCompat({ id: 'agnes', label: 'Agnes AI', base: () => 'https://apihub.agnes-ai.com/v1' }),
  openai: openaiCompat({ id: 'openai', label: 'OpenAI', base: () => 'https://api.openai.com/v1' }),
  ollama: openaiCompat({ id: 'ollama', label: 'Ollama', base: local('ollama'), needsKey: false }),
  lmstudio: openaiCompat({ id: 'lmstudio', label: 'LM Studio', base: local('lmstudio'), needsKey: false }),
  cloudflare: openaiCompat({ id: 'cloudflare', label: 'Cloudflare (via Forge Bridge)', base: bridge('/proxy/cloudflare/v1'), headers: bridgeHeaders, needsKey: false }),
  nvidia: openaiCompat({ id: 'nvidia', label: 'NVIDIA NIM (via Forge Bridge)', base: bridge('/proxy/nvidia/v1'), headers: bridgeHeaders, needsKey: false }),
};
/** tests: swap an adapter */
export function setAdapter(id: ProviderId, a: ProviderAdapter) { ADAPTERS[id] = a; }
