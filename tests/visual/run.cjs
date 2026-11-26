/**
 * Visual regression: renders tests/visual/scene.ts in Chromium and compares
 * each frame with tests/visual/baseline. `node tests/visual/run.cjs --update`
 * rewrites the baseline. Baselines depend on the machine's font and GPU
 * rasterisation: make them on the machine that checks them.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// FORGE_ROOT: render another checkout (CI: the previous version, to make the references)
// VISUAL_BASELINE: where the references live; VISUAL_PORT: dev server port
const root = process.env.FORGE_ROOT ? path.resolve(process.cwd(), process.env.FORGE_ROOT) : path.resolve(__dirname, '../..');
const base = process.env.VISUAL_BASELINE ? path.resolve(process.cwd(), process.env.VISUAL_BASELINE) : path.join(__dirname, 'baseline');
const outDir = path.join(__dirname, 'out');
const update = process.argv.includes('--update');
const PORT = Number(process.env.VISUAL_PORT) || 5197;

function png(dataUrl) { return Buffer.from(dataUrl.split(',')[1], 'base64'); }

(async () => {
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'ignore', detached: true });
  const stop = () => { try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* already gone */ } };
  let code = 1;
  try {
    for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${PORT}/`); break; } catch { await new Promise((r) => setTimeout(r, 500)); } }
    const browser = await chromium.launch();
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log('page error:', e.message));
    await page.goto(`http://localhost:${PORT}/`);
    const scenes = await page.evaluate(async () => {
      const S = await import('/tests/visual/scene.ts');
      const res = {};
      Object.assign(res, await S.renderScene(await S.buildScene()));
      const looks = await S.renderScene(await S.buildScene({ grain: 0.6, paper: 0.6, vignette: 0.5, chroma: true, grade: 'cinema' }, ['cut', 'fade', 'flash']));
      for (const k in looks) res['look-' + k] = looks[k];
      if (S.renderGl) Object.assign(res, await S.renderGl());
      if (S.renderScenes) Object.assign(res, await S.renderScenes());
      if (S.renderMotion) Object.assign(res, await S.renderMotion());
      if (S.renderSharpen) Object.assign(res, await S.renderSharpen());
      if (S.renderGrid) Object.assign(res, await S.renderGrid());
      return res;
    });
    await browser.close();
    fs.mkdirSync(base, { recursive: true });
    fs.mkdirSync(outDir, { recursive: true });
    const cmp = await chromium.launch();
    const cp = await cmp.newPage();
    let failed = 0, checked = 0, added = 0;
    for (const [name, url] of Object.entries(scenes)) {
      const file = path.join(base, name + '.png');
      if (update || !fs.existsSync(file)) { fs.writeFileSync(file, png(url)); added++; continue; }
      const ref = 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
      const diff = await cp.evaluate(async ([a, b]) => {
        const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return 1;
        const c = document.createElement('canvas'); c.width = ia.width; c.height = ia.height;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
        x.clearRect(0, 0, c.width, c.height); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let k = 0; k < da.length; k += 4) if (Math.abs(da[k] - db[k]) > 10 || Math.abs(da[k + 1] - db[k + 1]) > 10 || Math.abs(da[k + 2] - db[k + 2]) > 10) n++;
        return n / (da.length / 4);
      }, [url, ref]);
      checked++;
      if (diff > 0.002) { failed++; fs.writeFileSync(path.join(outDir, name + '.png'), png(url)); console.log(`DIFF ${name}: ${(diff * 100).toFixed(2)} % des pixels`); }
    }
    await cmp.close();
    console.log(`${checked} images comparées, ${failed} différences, ${added} références écrites`);
    code = failed ? 1 : 0;
  } finally { stop(); }
  process.exit(code);
})();
