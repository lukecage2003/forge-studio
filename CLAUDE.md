# Forge — notes for Claude Code

Comic video editor (TikTok, Shorts, YouTube) in the browser: React 19 + TypeScript + Vite, deployed to GitHub Pages by `.github/workflows/deploy.yml`.

## Language
- Every word the user sees is in **French** (UI, toasts, reports, commit messages).
- Code comments are in English.

## Commands
| Task | Command |
|---|---|
| Typecheck | `npx tsc -b` |
| Unit tests | `npm test` (vitest, about 90 tests, under 10 s) |
| Visual regression | `npm run test:visual`, then `npm run test:visual:update` after an intended change. CI compares against the previous commit; put `[visuel]` in the commit message to accept a change. |
| Live services | `FORGE_LIVE=1 npx vitest run tests/live.test.ts` (no key needed) |
| Build | `npm run build` |
| Dev server | `npx vite --port 5199 --strictPort` (end-to-end scripts drive it with Playwright) |

## Invariants (never break)
- **Preview equals export.** One renderer, `createRenderer().draw(ctx, project, t)` in `src/engine/render.ts`, and it is a pure function of time.
- **Deterministic.** No `Math.random()` in render, sound or auto edit: use `rng(hashSeed(...))` from `src/engine/rng.ts`.
- **Never generated images.** Visuals come from the user's own pages and panels only. Missing material is asked for, never invented.
- **Non-destructive.** Every change goes through `update()` in `src/store.ts`, which makes it undoable. Automatic proposals wait for the user's validation.
- **Zero cost by default.** No paid AI call unless the user enabled it and set a budget (`src/ai/orchestrator.ts`, `refusal()`).
- **Keys stay secret.** API keys live only in `src/ai/vault.ts` (encrypted) or Forge Bridge. Never log them, never put them in history or `.forge` files. Pass error text through `scrub()`.
- **Design: no app-UI look in the video.** Diagrams default to the "Encre" style (`src/engine/ink.ts`): paper, ink with a hand wobble, hard offset shadows, yellow captions, Ben-Day dots. No blurred glows, rounded SaaS cards or gradients there.
- **Existing features stay.** Never remove one. Extend by modules.

## Map
| Folder | Contents |
|---|---|
| `src/engine/` | Pure engines: `render` (frame), `auto` (auto edit), `direction` (8 creative profiles + effect budget), `narrative` / `scriptIntel` (script understanding), `speech` (rough cut), `faces` (`cameraPath` = vertical reframing), `audio` / `loudness` / `denoise` / `voicepro` (sound), `library` (music), `export` (MP4 via mediabunny/WebCodecs), `otio` (DaVinci), `report` / `qc` (quality), `scene3d` (three.js), `gl/` (GPU transitions), `hardware` (PC profile), `panelAI` (local YOLO panel + balloon detector, model in `public/models`), `classify` (page kinds), `ink` ("Encre" comic-print look of diagrams and maps) |
| `src/ai/` | Multi-AI orchestrator: `types`, `config`, `vault`, `ledger` (quotas, cost, cache, history), `providers/*`, `models`, `orchestrator`, `prompts`, `tasks` |
| `src/components/` | UI, one modal per feature, lazy-loaded from `App.tsx` |
| `bridge/` | Optional local Node helper (OS keychain, Cloudflare, NVIDIA, whisper.cpp) |
| `tests/` | `core`, `ai`, `voice`, `bridge`, `live`, `visual/` |
| `docs/ARCHITECTURE.md` | Long-form architecture |

## Habits that pay
- **Read before editing.** Files are long (render.ts is about 1,600 lines): `grep -n` the function, then edit with exact strings.
- **Test DSP and logic on synthetic signals** with known answers (sine at 997 Hz = −3.01 LUFS, and so on) before claiming a gain.
- **Test UI end to end** with a Playwright script against the dev server. Use a Watchmen PDF or a synthetic project from `tests/visual/scene.ts`.
- **Never claim untested results.** Say "non testé" when a check could not be run, for example with no API key or no real GPU.
