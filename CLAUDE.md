# Forge — notes for Claude Code

Comic video editor (TikTok, Shorts, YouTube) in the browser: React 19 + TypeScript + Vite, deployed to GitHub Pages by `.github/workflows/deploy.yml`.

## Language
- Every word the user sees is in **French** (UI, toasts, reports, commit messages).
- Code comments are in English.

## Commands
| Task | Command |
|---|---|
| Typecheck | `npx tsc -p tsconfig.app.json --noEmit` (the root `tsc -p .` checks nothing: it only has references) |
| Unit tests | `npm test` (vitest, about 90 tests, under 10 s) |
| Visual regression | `npm run test:visual`, then `npm run test:visual:update` after an intended change. CI compares against the previous commit; put `[visuel]` in the commit message to accept a change. |
| Live services | `FORGE_LIVE=1 npx vitest run tests/live.test.ts` (no key needed) |
| Build | `npm run build` |
| Dev server | `npx vite --port 5199 --strictPort` (end-to-end scripts drive it with Playwright) |
| End-to-end | `node tests/e2e/studio.e2e.cjs`, `orchestrator.e2e.cjs` and `delivery.e2e.cjs` (shared test material in `tests/e2e/fixtures.cjs`) against the dev server (CI runs both on Linux and Windows before every deploy). Restart the dev server after editing sources first: Vite's HMR timestamps can load a second copy of a module (two stores), which breaks scripts that import modules directly. |

## Invariants (never break)
- **Preview equals export.** One renderer, `createRenderer().draw(ctx, project, t)` in `src/engine/render.ts`, and it is a pure function of time.
- **Deterministic.** No `Math.random()` in render, sound or auto edit: use `rng(hashSeed(...))` from `src/engine/rng.ts`.
- **Never generated images.** Visuals come from the user's own pages and panels only. Missing material is asked for, never invented.
- **Non-destructive.** Every change goes through `update()` in `src/store.ts`, which makes it undoable. Automatic proposals wait for the user's validation.
- **Zero cost by default.** No paid AI call unless the user enabled it and set a budget (`src/ai/orchestrator.ts`, `refusal()`).
- **Keys stay secret.** API keys live only in `src/ai/vault.ts` (encrypted) or Forge Bridge. Never log them, never put them in history or `.forge` files. Pass error text through `scrub()`.
- **Design: no app-UI look in the video.** Diagrams default to the "Encre" style (`src/engine/ink.ts`): paper, ink with a hand wobble, hard offset shadows, yellow captions, Ben-Day dots. No blurred glows, rounded SaaS cards or gradients there.
- **Editorial relevance over animation.** Every automatic choice says why in `shot.why`; the director only touches `shot.auto` shots the user never edited; the review (`qc.ts`) recommends, it never changes the video silently.
- **Artwork is never altered.** Only views (camera paths) and masks (panel shapes, shared composition) change; a panel that can't be isolated cleanly is filmed inside its page.
- **Existing features stay.** Never remove one. Extend by modules.
- **Long work is a task.** Anything that runs for seconds goes through the production orchestrator (`src/production/kinds.ts`), never a new queue: it calls the existing engines (`jobs.heavy`, the AI orchestrator), gives a `guard` so a result computed before a manual edit is never applied silently, and awaits `ctx.checkpoint()` between steps.
- **Large media are stored once.** Files over 8 MB (rushes) live in the project workspace only (`engine/media` sink); pages stay cached in IndexedDB.

## Map
| Folder | Contents |
|---|---|
| `src/engine/` | Pure engines: `render` (frame), `auto` (auto edit), `direction` (8 creative profiles + effect budget), `director` (Creative Director: editorial sequences, treatments, camera grammar, transition diversity; runs after `direction`), `narrative` / `scriptIntel` (script understanding), `speech` (rough cut), `faces` (`cameraPath` = vertical reframing), `audio` / `loudness` / `denoise` / `voicepro` (sound), `library` (music), `export` (MP4 via mediabunny/WebCodecs), `otio` (DaVinci), `report` / `qc` (quality), `scene3d` (three.js), `gl/` (GPU transitions), `hardware` (PC profile), `panelAI` (local YOLO panel + balloon detector, model in `public/models`), `paddleOcr` (local PaddleOCR line detection + English reading of the lettering, Tesseract as fallback; `understand.ocrPages` groups lines by balloon), `classify` (page kinds), `ink` ("Encre" comic-print look of diagrams and maps), `hold` (display time per image), `styles` (8 art directions), `favorites` (user presets), `camerapath` (smooth keyed camera paths), `comicCamera` (comic camera engine: page glide, panel navigation, reveal, detail, shared composition, panel shapes), `delivery` (reads a finished MP4 back: resolution, cadence, black frames, loudness, true peak, clipping; TikTok / Shorts / Reels rules), `publish` (publication text from the project, no AI), `queue` (production orchestrator: task queue with dependencies, priorities, pause / cancel / retry one step, persistence, stale-result protection), `resources` (resource governor: slots per lane from cores, memory, battery, interface lag, user activity; `yieldToUI`), `jobs` (one local model family in memory; the queue groups heavy work by it) |
| `src/production/` | The app's orchestrator: `orchestrator` (queue instance, IndexedDB persistence, start / resume), `kinds` (tasks: page reading, page text, classification, rush analysis, face, transcription, subtitles, script analysis, motion preparation, render, quality control) |
| `src/lib/` | `workspace` (project storage: folder on disk or browser OPFS, versions, templates, shared media), `studio` (session side: autosave, crash recovery, open / create / duplicate projects), `projectFile` (.forge zip with every media), `db` (IndexedDB journal and media cache) |
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
