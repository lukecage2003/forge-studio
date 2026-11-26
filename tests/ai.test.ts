import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiError, type AiTask, type ProviderAdapter, type ProviderId } from '../src/ai/types';
import { getConfig, resetConfig, setConfig, defaultConfig } from '../src/ai/config';
import { setAdapter } from '../src/ai/providers';
import { describe as describeModel, openaiCompat } from '../src/ai/providers/openaiCompat';
import { setCatalogue, resetCatalogue } from '../src/ai/models';
import { plan, run, setConsentAsker, extractJson } from '../src/ai/orchestrator';
import { cooling, getHistory, resetLedger, slot } from '../src/ai/ledger';
import { setKey, masked, scrub, removeKey } from '../src/ai/vault';

const calls: string[] = [];
function fake(id: ProviderId, behaviour: (task: AiTask) => string | Error, transcribe = false): ProviderAdapter {
  const f = async (_k: string | null, model: string, task: AiTask) => {
    calls.push(`${id}:${model}`);
    const r = behaviour(task);
    if (r instanceof Error) throw r;
    return { text: r, usage: { inputTokens: 1000, outputTokens: 500 } };
  };
  return { id, listModels: async () => [], chat: f, ...(transcribe ? { transcribe: f } : {}) };
}
const task = (over: Partial<AiTask> = {}): AiTask => ({ kind: 'script.analyse', prompt: 'Analyse ce script', needs: ['text'], data: ['texte'], fresh: true, local: async () => ({ text: 'local' }), ...over });

beforeEach(async () => {
  calls.length = 0;
  resetConfig(); resetLedger(); resetCatalogue();
  setConsentAsker(async () => true);
  for (const p of ['gemini', 'groq', 'openrouter', 'agnes', 'openai'] as ProviderId[]) await setKey(p, `${p}-SECRET-KEY-1234567890`);
  setConfig((c) => ({ ...c, routes: { 'script.analyse': ['gemini', 'agnes', 'openrouter', 'local'] } }));
});

describe('mode Zéro coût et budget', () => {
  it('refuse un modèle OpenRouter payant ou au prix inconnu, accepte un modèle à prix 0 vérifié', () => {
    setCatalogue('openrouter', [{ id: 'paid/x', provider: 'openrouter', caps: ['text', 'json'], price: { input: 3, output: 15 } }]);
    setConfig((c) => ({ ...c, routes: { 'script.analyse': ['openrouter', 'local'] } }));
    expect(plan(task())[0].skip).toMatch(/payant/);
    setCatalogue('openrouter', [{ id: 'free/y:free', provider: 'openrouter', caps: ['text', 'json'], price: { input: 0, output: 0 } }]);
    expect(plan(task())[0].skip).toBeNull();
  });
  it('refuse les crédits d’essai NVIDIA et tout fournisseur payant', () => {
    setConfig((c) => ({ ...c, providers: { ...c.providers, nvidia: { ...c.providers.nvidia, enabled: true }, openai: { ...c.providers.openai, enabled: true } }, bridge: { ...c.bridge, token: 't' }, routes: { 'script.analyse': ['nvidia', 'openai', 'local'] } }));
    const p = plan(task());
    expect(p[0].skip).toMatch(/essai/);
    expect(p[1].skip).toMatch(/payant/);
  });
  it('n’appelle jamais un payant en mode Zéro coût : le local répond', async () => {
    setAdapter('openai', fake('openai', () => 'payé'));
    setConfig((c) => ({ ...c, providers: { ...c.providers, openai: { ...c.providers.openai, enabled: true } }, routes: { 'script.analyse': ['openai', 'local'] } }));
    const r = await run(task());
    expect(r.provider).toBe('local');
    expect(calls).toEqual([]);
  });
  it('mode Équilibré : payant seulement sous le plafond', () => {
    setConfig((c) => ({ ...c, mode: 'balanced', budget: 0, providers: { ...c.providers, openai: { ...c.providers.openai, enabled: true } }, routes: { 'script.analyse': ['openai', 'local'] } }));
    expect(plan(task())[0].skip).toMatch(/budget/);
    setConfig({ budget: 2 });
    expect(plan(task())[0].skip).toBeNull();
  });
});

describe('secours, quotas, erreurs', () => {
  it('quota dépassé : pause du fournisseur le temps indiqué, le suivant répond', async () => {
    setAdapter('gemini', fake('gemini', () => new AiError('quota', 'Gemini : quota', { retryAfter: 42 })));
    setAdapter('agnes', fake('agnes', () => 'réponse agnes'));
    const r = await run(task());
    expect(r.provider).toBe('agnes');
    expect(cooling('gemini')?.why).toBe('quota');
    expect(cooling('gemini')!.until - Date.now()).toBeGreaterThan(40_000);
    calls.length = 0;
    await run(task());
    expect(calls.some((c) => c.startsWith('gemini'))).toBe(false);
  });
  it('clé invalide : le fournisseur est écarté, la clé n’apparaît nulle part', async () => {
    setAdapter('gemini', fake('gemini', () => new AiError('auth', 'Gemini : clé refusée gemini-SECRET-KEY-1234567890')));
    setAdapter('agnes', fake('agnes', () => 'ok'));
    await run(task());
    expect(plan(task())[0].skip).toBe('clé refusée');
    expect(JSON.stringify(getHistory())).not.toContain('SECRET-KEY');
  });
  it('réseau coupé partout : le moteur local prend le relais', async () => {
    for (const p of ['gemini', 'agnes', 'openrouter'] as ProviderId[]) setAdapter(p, fake(p, () => new AiError('network', 'injoignable')));
    const r = await run(task());
    expect(r.provider).toBe('local');
    expect(r.attempts.filter((a) => !a.ok).length).toBe(3);
  });
  it('réponse JSON illisible : on passe au suivant', async () => {
    setAdapter('gemini', fake('gemini', () => 'pas du json'));
    setAdapter('agnes', fake('agnes', () => '```json\n{"ok":true}\n```'));
    const r = await run(task({ json: true }));
    expect(r.provider).toBe('agnes');
    expect(JSON.parse(extractJson(r.answer.text))).toEqual({ ok: true });
  });
  it('tout échoue sans version locale : erreur claire avec les raisons', async () => {
    for (const p of ['gemini', 'agnes', 'openrouter'] as ProviderId[]) setAdapter(p, fake(p, () => new AiError('server', 'panne')));
    await expect(run(task({ local: undefined }))).rejects.toThrow(/Aucune IA disponible/);
  });
});

describe('capacités, confidentialité, cache, débit', () => {
  it('une transcription ne part jamais vers un modèle qui ne transcrit pas', () => {
    setCatalogue('groq', [{ id: 'llama-x', provider: 'groq', caps: ['text', 'json'], price: null }]);
    setConfig((c) => ({ ...c, routes: { 'audio.transcribe': ['groq', 'local'] } }));
    expect(plan(task({ kind: 'audio.transcribe', needs: ['transcribe'], data: ['audio'] }))[0].skip).toMatch(/aucun modèle|transcrit/);
    setCatalogue('groq', [{ id: 'whisper-large-v3-turbo', provider: 'groq', caps: ['transcribe'], price: null }]);
    expect(plan(task({ kind: 'audio.transcribe', needs: ['transcribe'], data: ['audio'] }))[0].skip).toBeNull();
  });
  it('images : seulement vers un modèle qui les lit', () => {
    setCatalogue('agnes', [{ id: 'agnes-text', provider: 'agnes', caps: ['text'], price: null }]);
    setConfig((c) => ({ ...c, routes: { 'script.analyse': ['agnes', 'local'] } }));
    expect(plan(task({ needs: ['text', 'vision'], data: ['texte', 'images'] }))[0].skip).toMatch(/aucun modèle|images/);
  });
  it('« local uniquement » : rien ne sort', async () => {
    setAdapter('gemini', fake('gemini', () => 'x'));
    setConfig({ localOnly: true });
    const r = await run(task());
    expect(r.provider).toBe('local');
    expect(calls).toEqual([]);
  });
  it('envoi refusé par l’utilisateur : le fournisseur n’est pas appelé', async () => {
    setAdapter('gemini', fake('gemini', () => 'x'));
    setAdapter('agnes', fake('agnes', () => 'x'));
    setAdapter('openrouter', fake('openrouter', () => 'x'));
    setConsentAsker(async () => false);
    const r = await run(task());
    expect(r.provider).toBe('local');
    expect(calls).toEqual([]);
  });
  it('le même travail n’est pas demandé deux fois (cache)', async () => {
    setAdapter('gemini', fake('gemini', () => 'réponse'));
    await run(task({ fresh: false }));
    const r2 = await run(task({ fresh: false }));
    expect(r2.cached).toBe(true);
    expect(calls.length).toBe(1);
  });
  it('jamais plus de 2 appels simultanés au même fournisseur', async () => {
    let now = 0, max = 0;
    await Promise.all(Array.from({ length: 6 }, () => slot('groq', async () => { now++; max = Math.max(max, now); await new Promise((r) => setTimeout(r, 15)); now--; })));
    expect(max).toBe(2);
  });
});

describe('coffre à clés', () => {
  it('masque la clé et la retire des messages', async () => {
    await setKey('groq', 'gsk_abcdefghijklmnopqrstuvwxyz123456');
    expect(masked('groq')).toBe('gsk_…3456');
    expect(scrub('erreur avec gsk_abcdefghijklmnopqrstuvwxyz123456 dedans')).not.toContain('abcdefghij');
    await removeKey('groq');
    expect(masked('groq')).toBe('');
  });
});

describe('adaptateur compatible OpenAI (faux serveur)', () => {
  const resp = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
  const a = openaiCompat({ id: 'groq', label: 'Groq', base: () => 'https://x/v1' });
  it('401 → clé refusée ; 429 → quota avec délai ; réseau → injoignable', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    f.mockResolvedValueOnce(resp(401, { error: { message: 'Invalid API Key' } }));
    await expect(a.chat!('k', 'm', task())).rejects.toMatchObject({ kind: 'auth' });
    f.mockResolvedValueOnce(resp(429, { error: { message: 'Rate limit' } }, { 'retry-after': '7' }));
    await expect(a.chat!('k', 'm', task())).rejects.toMatchObject({ kind: 'quota', retryAfter: 7 });
    f.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(a.chat!('k', 'm', task())).rejects.toMatchObject({ kind: 'network' });
    f.mockRestore();
  });
  it('mode JSON refusé par le modèle : redemande en texte', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    f.mockResolvedValueOnce(resp(400, { error: { message: 'response_format json_object not supported' } }));
    f.mockResolvedValueOnce(resp(200, { choices: [{ message: { content: '{"a":1}' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }));
    const r = await a.chat!('k', 'm', task({ json: true }));
    expect(r.text).toBe('{"a":1}');
    expect(JSON.parse(String(f.mock.calls[1][1]!.body)).response_format).toBeUndefined();
    f.mockRestore();
  });
  it('transcription : mots horodatés lus dans verbose_json', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(resp(200, { text: 'Thor arrive', duration: 2, words: [{ word: 'Thor', start: 0.1, end: 0.5 }, { word: ' arrive', start: 0.6, end: 1 }] }));
    const r = await a.transcribe!('k', 'whisper-large-v3-turbo', task({ audio: new Blob([new Uint8Array(10)]), needs: ['transcribe'] }));
    expect(r.words).toEqual([{ w: 'Thor', s: 0.1, e: 0.5 }, { w: 'arrive', s: 0.6, e: 1 }]);
    const body = f.mock.calls[0][1]!.body as FormData;
    expect(body.getAll('timestamp_granularities[]')).toContain('word');
    f.mockRestore();
  });
  it('catalogue : prix et capacités lus, jamais supposés', () => {
    const m = describeModel('openrouter', { id: 'g/gemma:free', context_length: 131072, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } });
    expect(m.price).toEqual({ input: 0, output: 0 });
    expect(m.caps).toEqual(expect.arrayContaining(['text', 'vision', 'long']));
    const nop = describeModel('groq', { id: 'llama-3.3-70b-versatile', context_window: 131072 });
    expect(nop.price).toBeNull();
    expect(describeModel('groq', { id: 'whisper-large-v3-turbo' }).caps).toEqual(['transcribe']);
  });
});

describe('réglages', () => {
  it('Zéro coût est le mode par défaut et les payants sont éteints', () => {
    const d = defaultConfig();
    expect(d.mode).toBe('zero');
    expect(d.providers.openai.enabled).toBe(false);
    expect(d.providers.anthropic.enabled).toBe(false);
    expect(getConfig().mode).toBe('zero');
  });
});

import { aiPunctuate, aiTranscribe, validProposals, localAssistant, aiReviewScript } from '../src/ai/tasks';
import { newProject, newShot } from '../src/store';

describe('IA dans le montage', () => {
  it('ponctuation : une ligne dont l’IA a changé les mots est refusée', async () => {
    setConfig((c) => ({ ...c, routes: { 'captions.punctuate': ['groq', 'local'] } }));
    setAdapter('groq', fake('groq', () => JSON.stringify({ lignes: ['Thor arrive.', 'Il frappe Hulk fort'] })));
    const r = await aiPunctuate(['thor arrive', 'il frappe fort']);
    expect(r.lines).toEqual(['Thor arrive.', 'il frappe fort']);
    expect(r.changed).toBe(1);
    expect(r.refused).toBe(1);
  });
  it('transcription longue : morceaux de 10 min recollés au bon temps', async () => {
    setConfig((c) => ({ ...c, routes: { 'audio.transcribe': ['groq', 'local'] } }));
    setCatalogue('groq', [{ id: 'whisper-large-v3-turbo', provider: 'groq', caps: ['transcribe'], price: null }]);
    let n = 0;
    setAdapter('groq', { id: 'groq', listModels: async () => [], transcribe: async () => ({ text: 'x', words: [{ w: `mot${n++}`, s: 1, e: 1.5 }] }) });
    const pcm = new Float32Array(16000 * 660); // 11 min
    const r = await aiTranscribe(pcm, 'fr', async () => []);
    expect(r.words.map((w) => w.s)).toEqual([1, 601]);
    expect(r.via.provider).toBe('groq');
  });
  it('transcription sans fournisseur : Whisper local', async () => {
    setConfig((c) => ({ ...c, routes: { 'audio.transcribe': ['groq', 'local'] } }));
    await removeKey('groq');
    const r = await aiTranscribe(new Float32Array(16000), 'fr', async () => [{ w: 'local', s: 0, e: 0.4 }]);
    expect(r.via.provider).toBe('local');
    expect(r.words[0].w).toBe('local');
  });
  it('assistant : propositions vérifiées contre le vrai projet', () => {
    const p = newProject();
    p.shots = [newShot(p, { id: 'a', duration: 8 }), newShot(p, { id: 'b', duration: 3 })];
    const ok = validProposals([
      { type: 'shot.duration', shotId: 'a', seconds: 5 },
      { type: 'shot.duration', shotId: 'inventé', seconds: 5 },
      { type: 'shot.duration', shotId: 'b', seconds: 0.1 },
      { type: 'shot.transition', shotId: 'b', transition: 'explosion-3d' },
      { type: 'title.add', at: 4, text: 'ODINFORCE' },
      { type: 'title.add', at: 999, text: 'trop tard' },
      { type: 'rush.cut', s: 1, e: 2 },
      { type: 'supprimer-tout' },
      { type: 'note', text: 'Bon rythme' },
    ], p);
    expect(ok.map((x) => x.type)).toEqual(['shot.duration', 'title.add', 'note']);
  });
  it('assistant hors ligne : repère les plans trop longs', () => {
    const p = newProject();
    p.pages = [{ id: 'pg', name: 'p', mediaId: 'm', width: 10, height: 10 } as never];
    p.shots = [newShot(p, { id: 'a', pageId: 'pg', duration: 9 }), newShot(p, { id: 'b', pageId: 'pg', duration: 3 })];
    const r = localAssistant('Trouve les passages trop longs', p);
    expect(r.propositions).toEqual([expect.objectContaining({ type: 'shot.duration', shotId: 'a' })]);
  });
  it('deuxième lecture hors ligne : accroche longue et conclusion manquante', async () => {
    setConfig({ localOnly: true });
    const p = { ...newProject(), script: "Aujourd'hui on va parler longuement de Thor et de tout ce qui fait de lui un des personnages les plus intéressants de tout l'univers Marvel depuis des décennies. Il a un marteau." };
    const r = await aiReviewScript(p);
    expect(r.via.provider).toBe('local');
    expect(r.notes.map((n) => n.type)).toEqual(expect.arrayContaining(['accroche']));
  });
});
