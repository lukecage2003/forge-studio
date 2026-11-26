/**
 * Tests against the real services, only those that need no key.
 * Skipped when FORGE_LIVE is not set (CI stays offline and deterministic).
 */
import { describe, expect, it } from 'vitest';
import { ADAPTERS } from '../src/ai/providers';
import { isZero } from '../src/ai/models';

describe.skipIf(!process.env.FORGE_LIVE)('connexion réelle (sans clé)', () => {
  it('OpenRouter : catalogue lu, prix vérifiés, gratuits identifiés', async () => {
    const models = await ADAPTERS.openrouter!.listModels(null);
    const free = models.filter(isZero);
    const textFree = free.filter((m) => m.caps.includes('text'));
    console.log(`OpenRouter : ${models.length} modèles, ${free.length} au prix 0, dont ${textFree.length} textuels :`, textFree.map((m) => m.id).join(', '));
    expect(models.length).toBeGreaterThan(50);
    expect(free.length).toBeGreaterThan(0);
    expect(models.every((m) => m.price === null || (m.price.input >= 0 && m.price.output >= 0))).toBe(true);
    // a paid model is never counted as free
    expect(models.filter((m) => m.price && m.price.input > 0).every((m) => !isZero(m))).toBe(true);
  });
  it('Groq, Agnes, Gemini : sans clé, refus propre (pas de plantage)', async () => {
    for (const id of ['groq', 'agnes', 'gemini'] as const) await expect(ADAPTERS[id]!.listModels(null)).rejects.toMatchObject({ kind: 'auth' });
  });
  it('Groq : une fausse clé est refusée par le vrai service et classée « clé refusée »', async () => {
    await expect(ADAPTERS.groq!.listModels('gsk_fausse_cle_de_test_0000000000000000')).rejects.toMatchObject({ kind: 'auth' });
  });
  it('OpenRouter et Agnes : une fausse clé est refusée par le vrai service', async () => {
    await expect(ADAPTERS.openrouter!.chat!('sk-or-v1-fausse', 'openrouter/free', { kind: 'classify', prompt: 'ok', needs: ['text'], data: ['texte'] })).rejects.toMatchObject({ kind: 'auth' });
    await expect(ADAPTERS.agnes!.chat!('fausse-cle-agnes', 'agnes-2.0-flash', { kind: 'classify', prompt: 'ok', needs: ['text'], data: ['texte'] })).rejects.toMatchObject({ kind: expect.stringMatching(/auth|bad-request/) });
  });
  it('Gemini : une fausse clé est refusée par le vrai service', async () => {
    await expect(ADAPTERS.gemini!.listModels('AIzaFausseCleDeTest000000000000000000')).rejects.toMatchObject({ kind: expect.stringMatching(/auth|bad-request/) });
  });
});
