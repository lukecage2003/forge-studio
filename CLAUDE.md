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
| Published files | `node scripts/check-build.mjs dist` (or the live URL): every file the page, the build manifest and the JS reference must exist. |
| End-to-end | `node tests/e2e/studio.e2e.cjs`, `orchestrator.e2e.cjs`, `delivery.e2e.cjs` and `production.e2e.cjs` (the whole production, empty project to export and reopening) (shared test material in `tests/e2e/fixtures.cjs`) against the dev server (CI runs them on Linux and Windows before every deploy). `node tests/e2e/update.e2e.cjs` builds two versions itself and serves them under `/forge-studio/` (`scripts/static-server.cjs`) to test a publication while a tab is open. Restart the dev server after editing sources first: Vite's HMR timestamps can load a second copy of a module (two stores), which breaks scripts that import modules directly. |

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
- **A publication keeps the previous files.** `scripts/keep-old-assets.mjs` copies the previous hashed `assets/` for 30 days, so an open tab keeps loading its windows. A module that still fails goes through `src/lib/staleVersion.ts`: one controlled reload after saving, never automatic, never a loop. Never deploy without `check-build`.
- **Project layout changes are migrations.** Add a step to `MIGRATIONS` in `src/lib/schema.ts` and raise `SCHEMA_VERSION`; never edit a past step. Unknown fields of a newer project are kept.
- **Cleanup never deletes in use.** Media used by a project or one of its versions are never moved; unused ones go to `corbeille/` (restorable). Only « Vider la corbeille » deletes, after confirmation.
- **The assistant gets the context of the request** (`contextFor` in `src/ai/tasks.ts`), not the whole project. Forge Brain learns per project, per format and in general (`engine/brain` scopes).
- **Large media are stored once.** Files over 8 MB (rushes) live in the project workspace only (`engine/media` sink); pages stay cached in IndexedDB.

## Map
| Folder | Contents |
|---|---|
| `src/engine/` | Pure engines: `render` (frame), `auto` (auto edit), `direction` (8 creative profiles + effect budget), `director` (Creative Director: editorial sequences, treatments, camera grammar, transition diversity; runs after `direction`), `narrative` / `scriptIntel` (script understanding), `speech` (rough cut), `faces` (`cameraPath` = vertical reframing), `audio` / `loudness` / `denoise` / `voicepro` (sound), `library` (music), `export` (MP4 via mediabunny/WebCodecs), `otio` (DaVinci), `report` / `qc` (quality), `scene3d` (three.js), `gl/` (GPU transitions), `hardware` (PC profile), `panelAI` (local YOLO panel + balloon detector, model in `public/models`), `paddleOcr` (local PaddleOCR line detection + English reading of the lettering, Tesseract as fallback; `understand.ocrPages` groups lines by balloon), `classify` (page kinds), `ink` ("Encre" comic-print look of diagrams and maps), `hold` (display time per image), `styles` (8 art directions), `favorites` (user presets), `clip` (picture ↔ words model for the visual search of the media library, MIT, 150 MB on first use), `camerapath` (smooth keyed camera paths), `comicCamera` (comic camera engine: page glide, panel navigation, reveal, detail, shared composition, panel shapes), `delivery` (reads a finished MP4 back: resolution, cadence, black frames, loudness, true peak, clipping; TikTok / Shorts / Reels rules), `publish` (publication text from the project, no AI), `color` (scan consistency: paper white of story pages measured in the margins, exposure correction proposed for the few pages that stand out, never contrast or colour), `audioCheck` (source recording: clipping, noise floor, low voice), `versionDiff` (what changed between two versions), `storyboard` (sentence-by-sentence plan edited before the auto edit: picture, camera, sound, subtitles, missing material; `autoMontage({ board })` follows it), `queue` (production orchestrator: task queue with dependencies, priorities, pause / cancel / retry one step, persistence, stale-result protection), `resources` (resource governor: slots per lane from cores, memory, battery, interface lag, user activity; `yieldToUI`), `jobs` (one local model family in memory; the queue groups heavy work by it), `proxy` (540p preview copy of a rush over 720p, task `rush.proxy`, stored in `proxies/`; the preview plays it through `previewUrl`, the export always reads the original) |
| `src/production/` | The app's orchestrator: `orchestrator` (queue instance, IndexedDB persistence, start / resume), `kinds` (tasks: page reading, page text, classification, rush analysis, face, transcription, subtitles, script analysis, motion preparation, render, quality control) |
| `src/lib/` | `workspace` (project storage: folder on disk or browser OPFS, versions, templates, shared media), `studio` (session side: autosave, crash recovery, open / create / duplicate projects), `projectFile` (.forge zip with every media), `mediaLibrary` (every media of every project: provenance, usage, search, duplicates; index in `library/index.json` of the workspace), `db` (IndexedDB journal and media cache), `staleVersion` (new publication while a tab is open: reload proposal, update bar from `version.json`), `schema` (project `schemaVersion`, ordered migrations, engine versions in the .forge manifest), `commands` (the one list of menu commands: palette and studios), `studios` (eight workspaces over one project: what each stage still needs, read from the project) |
| `scripts/` | `keep-old-assets` (publication keeps previous files), `check-build` (every referenced file exists, local or live), `static-server` (serves a build under `/forge-studio/` for tests) |
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
