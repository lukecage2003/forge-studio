---
name: forge-e2e
description: End-to-end test of Forge in a real browser (import PDF/rush, auto edit, export MP4) with Playwright. Use to verify a feature for real.
---
1. Start the dev server: `npx vite --port 5199 --strictPort` (in the background).
2. Write a CommonJS script that loads Playwright with `require('playwright')`, opens `http://localhost:5199/`, and drives the app.
   - Import pages: `page.locator('input[type=file][accept*="pdf"]').setInputFiles(pdf)`.
   - Import a rush: `input[type=file][accept="video/*"]`.
   - Read the state: `window.__forge.getState()`.
   - Load modules: `await import('/src/engine/auto.ts')`, and the same for `export.ts`, `report.ts`, `rush.ts`.
   - Auto edit: `autoMontage(project, { style, profile, model, length, story, ... })`, then `store.loadProject(project)`.
   - Export: `exportMp4(p, { quality: 'high', fps: 30, onProgress, onMix, onCheck, signal })`. Return base64 to Node and write the file.
3. Check the file with `ffprobe` and contact sheets: `ffmpeg -vf "fps=1/3,scale=180:320,tile=7x2"`. Look at the image.
4. Measure, do not guess: LUFS from `onMix`, sync from `onCheck`, the QC report from `buildReport`.
5. For speech tests, use synthetic voices with defects at known times (espeak-ng, ffmpeg), and compare cuts to that ground truth.
