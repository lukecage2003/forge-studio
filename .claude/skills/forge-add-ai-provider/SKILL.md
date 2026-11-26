---
name: forge-add-ai-provider
description: Add an AI provider to the Forge orchestrator (OpenAI-compatible or native), with routing, cost rules and tests.
---
1. Check browser CORS for real with `curl -X OPTIONS <url> -H "Origin: https://lukecage2003.github.io" ...`. Without CORS, the provider goes through Forge Bridge (`bridge/forge-bridge.mjs`, add an upstream).
2. Add the id to `ProviderId` (`src/ai/types.ts`), and its settings (`enabled: false` by default unless it is free and local) in `defaultConfig()` (`src/ai/config.ts`).
3. Write the adapter:
   - **OpenAI-compatible:** add `openaiCompat({ id, label, base, headers?, needsKey?, publicModels? })` to `ADAPTERS` (`src/ai/providers/index.ts`).
   - **Otherwise:** write a native adapter. Throw `AiError` with the right kind (auth, quota, network, server, bad-request) through `call()` from `providers/http.ts`.
4. Add the `ProviderInfo` entry: French role, offer described (never a hardcoded quota), privacy note, key page.
5. Add it to the task routes in `DEFAULT_ROUTES`, local providers last.
6. Tests in `tests/ai.test.ts`, with a fake adapter through `setAdapter`: zero-cost refusal if paid, fallback, capability filter. Add a live test in `tests/live.test.ts` if something can be checked without a key.
