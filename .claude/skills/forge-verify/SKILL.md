---
name: forge-verify
description: Run every check of Forge before committing (types, unit, visual regression, build). Use after any code change.
---
1. Typecheck: `npx tsc -b` (must print nothing).
2. Unit tests: `npx vitest run`. All pass; `live.test.ts` is skipped without `FORGE_LIVE`.
3. Visual regression: `node tests/visual/run.cjs`. It must say `0 différences`.
   - If a difference is intended, look at the images in `tests/visual/out/`.
   - Then run `node tests/visual/run.cjs --update` and commit with `[visuel]` in the message.
4. Build: `npm run build` (no errors).
5. Report the real numbers. Never write "tout passe" without the output.
