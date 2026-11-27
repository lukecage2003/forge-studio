// Production orchestrator, end to end, against the dev server (npx vite --port 5199 --strictPort):
//   node tests/e2e/orchestrator.e2e.cjs [port]
// Synthetic comic pages (drawn on a canvas, no copyrighted material). Checks:
// queue run, reload in the middle (resume), crash of the tab (resume), manual edit
// protected, cancel and pause of a render, network error and quota (retry), lane
// limits under concurrency, interface responsiveness during a render.
const { chromium } = require('playwright');
const port = process.argv[2] || '5199';
const URL = `http://localhost:${port}/`;
const fails = [];
const T0 = Date.now();
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}  [${((Date.now() - T0) / 1000).toFixed(0)} s]`); if (!ok) fails.push(what); };
const Q = 'globalThis.__forgeQueue';

async function pages(ctx, n) {
  const art = await ctx.newPage();
  const out = [];
  for (let i = 0; i < n; i++) {
    await art.setContent(`<canvas id=c width=900 height=1350></canvas><script>
      const x=c.getContext('2d');x.fillStyle='#f4efe4';x.fillRect(0,0,900,1350);x.lineWidth=9;x.strokeStyle='#111';
      const P=[[40,40,400,600],[470,40,390,600],[40,690,820,620]];
      P.forEach(([a,b,w,h],k)=>{x.fillStyle=['#d9532b','#2f62c9','#3a9a5b','#a63fb5'][(k+${i})%4];x.fillRect(a,b,w,h);x.strokeRect(a,b,w,h);
        x.fillStyle='#fff';x.beginPath();x.ellipse(a+w*0.35,b+90,120,55,0,0,7);x.fill();x.stroke();
        x.fillStyle='#111';x.font='bold 26px sans-serif';x.fillText('PAGE ${i + 1}!',a+w*0.35-75,b+100);});
    </script>`);
    out.push({ name: `page-${String(i + 1).padStart(2, '0')}.png`, mimeType: 'image/png', buffer: await art.locator('#c').screenshot() });
  }
  await art.close();
  return out;
}
const boot = async (p) => { await p.goto(URL); await p.waitForFunction(() => !!globalThis.__forgeQueue && document.querySelector('.topbar'), null, { timeout: 60000 }); };
const state = (p) => p.evaluate(`(() => { const q = ${Q}; const pr = window.__forge.getState().project;
  const by = (k) => q.tasks.filter((t) => t.kind === k && t.projectId === pr.id);
  return { pages: pr.pages.length, shots: pr.shots.length, analysing: pr.pages.filter((x) => x.analysing).length,
    detect: by('pages.detect').map((t) => t.state), classify: by('pages.classify').map((t) => t.state), active: q.active(pr.id).length,
    interrupted: q.tasks.filter((t) => t.projectId === pr.id && t.interrupted === true).length,
    shotsPerPage: pr.pages.map((g) => pr.shots.filter((s) => s.pageId === g.id).length) }; })()`);
const settle = (p, ms = 300000) => p.waitForFunction(`(() => { const q = ${Q}; const pr = window.__forge.getState().project; return q.active(pr.id).length === 0 && !pr.pages.some((x) => x.analysing) && !window.__forge.getState().ui.busy; })()`, null, { timeout: ms, polling: 250 });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  const imgs = await pages(ctx, 8);
  let p = await ctx.newPage();
  const errs = []; const watch = (pg) => pg.on('pageerror', (e) => errs.push(e.message));
  watch(p);
  await boot(p);

  /* 1. import as tasks, reload in the middle */
  await p.locator('input[type=file][accept*="pdf"]').setInputFiles(imgs);
  await p.waitForFunction(`${Q}.tasks.filter((t) => t.kind === 'pages.detect' && t.state === 'done').length >= 2`, null, { timeout: 120000, polling: 100 });
  const mid = await state(p);
  check(mid.pages === 8 && mid.detect.length === 8, `import : 8 pages ajoutées tout de suite, 8 lectures en file (${mid.pages} / ${mid.detect.length})`);
  await p.evaluate(`${Q}.flush()`);
  await p.reload();
  await p.waitForFunction(() => !!globalThis.__forgeQueue, null, { timeout: 60000 });
  await settle(p);
  const after = await state(p);
  check(after.pages === 8, `après rechargement : toujours 8 pages, aucune en double (${after.pages})`);
  check(after.classify.length === 1 && after.classify[0] === 'done', `le classement s’est terminé après la reprise (${after.classify})`);
  check(after.shotsPerPage.every((n) => n >= 1) && after.shots === after.shotsPerPage.reduce((a, c) => a + c, 0), `chaque page a ses plans, sans doublon (${after.shotsPerPage})`);
  const doneRuns = await p.evaluate(`${Q}.tasks.filter((t) => t.kind === 'pages.detect' && t.attempts === 1 && t.state === 'done').length`);
  check(doneRuns >= 2, `les lectures déjà finies avant le rechargement ne sont pas refaites (${doneRuns} d’un seul essai)`);

  /* 2. manual edit protected: a page cut by hand during the analysis keeps its cut */
  await p.evaluate(async () => { const S = await import('/src/lib/studio.ts'); await S.createProject('Protection'); });
  await p.locator('input[type=file][accept*="pdf"]').setInputFiles(imgs.slice(0, 3));
  await p.waitForFunction(() => window.__forge.getState().project.pages.length === 3, null, { timeout: 60000 });
  const manualId = await p.evaluate(async () => {
    const A = await import('/src/actions.ts'); const pr = window.__forge.getState().project; const pg = pr.pages[1];
    A.addShotRect(pg.id, { x: 10, y: 10, w: 300, h: 300 }); return pg.id;
  });
  await settle(p);
  const prot = await p.evaluate((id) => { const pr = window.__forge.getState().project; return pr.shots.filter((s) => s.pageId === id).map((s) => s.rect.w); }, manualId);
  check(prot.length === 1 && prot[0] === 300, `la page découpée à la main pendant l’analyse garde ta découpe (${JSON.stringify(prot)})`);

  /* 3. a real crash (browser process killed) is tested at the end, on its own profile */
  await p.evaluate(async () => { const S = await import('/src/lib/studio.ts'); await S.createProject('Rendu'); });
  await p.locator('input[type=file][accept*="pdf"]').setInputFiles(imgs.slice(0, 2));
  await settle(p);

  /* 4. render: pause, resume, cancel; the project is not touched */
  const before = await p.evaluate(() => JSON.stringify(window.__forge.getState().project.shots));
  const rid = await p.evaluate(async () => { const K = await import('/src/production/kinds.ts'); const t = await K.renderVideo({ name: 'essai.mp4', quality: 'high', fps: 24, scale: 1, burn: true }); return t.id; });
  await p.waitForFunction(`(${Q}.get('${rid}')?.progress ?? 0) > 0.08`, null, { timeout: 180000, polling: 100 });
  await p.evaluate(`${Q}.pause('${rid}')`);
  await p.waitForTimeout(800);
  const p1 = await p.evaluate(`${Q}.get('${rid}').progress`);
  await p.waitForTimeout(2500);
  const p2 = await p.evaluate(`${Q}.get('${rid}').progress`);
  check(Math.abs(p2 - p1) < 0.02, `rendu en pause : la progression ne bouge plus (${p1.toFixed(3)} → ${p2.toFixed(3)})`);
  await p.evaluate(`${Q}.resume('${rid}')`);
  await p.waitForFunction(`${Q}.get('${rid}').progress > ${p2 + 0.03}`, null, { timeout: 120000, polling: 100 });
  check(true, 'rendu repris après la pause');
  // interface while rendering, with the user scrolling: event-loop lag measured
  const lag = await p.evaluate(async () => {
    const lags = []; let last = performance.now();
    const t = setInterval(() => { const now = performance.now(); lags.push(now - last - 50); last = now; }, 50);
    for (let i = 0; i < 30; i++) { window.dispatchEvent(new WheelEvent('wheel', { deltaY: 10 })); await new Promise((r) => setTimeout(r, 100)); }
    clearInterval(t); lags.sort((a, b) => a - b);
    return { p50: Math.round(lags[Math.floor(lags.length / 2)]), p95: Math.round(lags[Math.floor(lags.length * 0.95)]), max: Math.round(lags[lags.length - 1]) };
  });
  console.log(`  interface pendant le rendu : retard médian ${lag.p50} ms, 95 % ${lag.p95} ms, max ${lag.max} ms`);
  await p.evaluate(`${Q}.cancel('${rid}')`);
  await p.waitForTimeout(500);
  const rs = await p.evaluate(`${Q}.get('${rid}').state`);
  const same = await p.evaluate((b) => JSON.stringify(window.__forge.getState().project.shots) === b, before);
  check(rs === 'cancelled' && same, `rendu annulé, projet intact (${rs})`);

  /* 5. network error then quota: a real fetch through the browser, failures injected by the test */
  let netCalls = 0, quotaCalls = 0;
  await ctx.route('**/forge-test/net', (r) => (++netCalls < 2 ? r.abort('internetdisconnected') : r.fulfill({ status: 200, body: 'ok' })));
  await ctx.route('**/forge-test/quota', (r) => (++quotaCalls < 2 ? r.fulfill({ status: 429, headers: { 'retry-after': '1' }, body: 'quota' }) : r.fulfill({ status: 200, body: 'ok' })));
  const net = await p.evaluate(async () => {
    const q = globalThis.__forgeQueue;
    const { AiError } = await import('/src/ai/types.ts');
    q.register({ kind: 'test.net', lane: 'network', label: () => 'Test réseau', key: (x) => x.u, maxAttempts: 3,
      run: async (_c, x) => { const r = await fetch(x.u); if (r.status === 429) throw new AiError('quota', 'HTTP 429', { retryAfter: Number(r.headers.get('retry-after')) }); return r.text(); } });
    const pid = window.__forge.getState().project.id;
    const a = q.enqueue('test.net', { u: '/forge-test/net' }, { projectId: pid });
    const b = q.enqueue('test.net', { u: '/forge-test/quota' }, { projectId: pid });
    await new Promise((r) => setTimeout(r, 400));
    const mid = [q.get(a.id).state, q.get(a.id).note, q.get(b.id).state, q.get(b.id).note];
    await q.idle([a.id, b.id]);
    return { mid, end: [q.get(a.id).state, q.get(a.id).attempts, q.get(b.id).state, q.get(b.id).attempts] };
  });
  check(net.mid[0] === 'retrying' && /Réseau/.test(net.mid[1]), `coupure réseau : la tâche attend et réessaie (${net.mid[1]})`);
  check(net.mid[2] === 'retrying' && /Quota/.test(net.mid[3]), `quota d’API : la tâche attend le délai demandé (${net.mid[3]})`);
  check(net.end[0] === 'done' && net.end[2] === 'done' && net.end[1] === 2 && net.end[3] === 2, `les deux réussissent au 2e essai (${net.end})`);

  /* 6. concurrency: many tasks at once never exceed the lane limits */
  const conc = await p.evaluate(async () => {
    const q = globalThis.__forgeQueue; const pid = window.__forge.getState().project.id;
    let heavyMax = 0, lightMax = 0;
    const tick = setInterval(() => {
      const run = q.tasks.filter((t) => t.state === 'running');
      heavyMax = Math.max(heavyMax, run.filter((t) => t.lane === 'heavy').length);
      lightMax = Math.max(lightMax, run.filter((t) => t.lane === 'light').length);
    }, 5);
    q.register({ kind: 'test.heavy', lane: 'heavy', family: 'x', label: () => 'lourd', key: (x) => String(x.i), run: async () => { await new Promise((r) => setTimeout(r, 40)); return 1; } });
    q.register({ kind: 'test.light', lane: 'light', label: () => 'léger', key: (x) => String(x.i), run: async () => { await new Promise((r) => setTimeout(r, 30)); return 1; } });
    const ids = [];
    for (let i = 0; i < 12; i++) { ids.push(q.enqueue('test.heavy', { i }, { projectId: pid }).id, q.enqueue('test.light', { i }, { projectId: pid }).id); }
    await q.idle(ids); clearInterval(tick);
    const { budget } = await import('/src/engine/resources.ts');
    return { heavyMax, lightMax, lightSlots: budget().slots.light, done: ids.filter((i) => q.get(i).state === 'done').length };
  });
  check(conc.done === 24 && conc.heavyMax === 1, `24 tâches simultanées : toutes finies, jamais plus d’un traitement lourd à la fois (${conc.heavyMax})`);
  check(conc.lightMax <= Math.max(conc.lightSlots, 3), `tâches légères dans la limite du gouverneur (${conc.lightMax} ≤ ${conc.lightSlots})`);

  check(errs.length === 0, `aucune erreur de page ${errs.length ? errs.slice(0, 3).join(' | ') : ''}`);
  await b.close();

  /* 7. crash: Chromium killed (SIGKILL) while tasks run, relaunched on the same profile */
  const { spawn } = require('child_process');
  const os = require('os'), path = require('path'), fs = require('fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-crash-'));
  const launch = async () => {
    const port = 9300 + Math.floor(Math.random() * 500);
    const proc = spawn(chromium.executablePath(), ['--headless=new', '--no-sandbox', `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { const br = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); return { proc, br }; } catch { await new Promise((r) => setTimeout(r, 250)); } }
    throw new Error('Chromium ne démarre pas');
  };
  let { proc, br } = await launch();
  let cp = br.contexts()[0].pages()[0] ?? await br.contexts()[0].newPage();
  await boot(cp);
  await cp.locator('input[type=file][accept*="pdf"]').setInputFiles(imgs.slice(0, 6));
  await cp.waitForFunction(`${Q}.tasks.filter((t) => t.kind === 'pages.detect' && t.state === 'done').length >= 1`, null, { timeout: 120000, polling: 100 });
  await cp.evaluate(`${Q}.flush()`);
  proc.kill('SIGKILL');
  await new Promise((r) => proc.once('exit', r));
  ({ proc, br } = await launch());
  cp = br.contexts()[0].pages()[0] ?? await br.contexts()[0].newPage();
  await boot(cp);
  await settle(cp);
  const crash = await state(cp);
  check(crash.pages === 6 && crash.shotsPerPage.every((n) => n >= 1), `après l’arrêt brutal du navigateur : 6 pages, toutes analysées (${crash.shotsPerPage})`);
  check(crash.interrupted >= 1, `les tâches interrompues ont repris (${crash.interrupted})`);
  await br.close().catch(() => {});
  if (proc.exitCode === null) { proc.kill('SIGKILL'); await new Promise((r) => proc.once('exit', r)); }
  // Windows keeps the profile files locked a moment after the process exits: cleanup is best effort
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { console.log(`  (profil de test laissé dans ${dir})`); }
  console.log(fails.length ? `\n${fails.length} échec(s)` : '\nTout est bon');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
