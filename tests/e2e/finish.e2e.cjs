// Finishing, end to end: a darker scan is spotted by the quality review, harmonised on request only,
// and the version comparison says what changed.
//   node tests/e2e/finish.e2e.cjs [port]
const { chromium } = require('playwright');
const { comicPages } = require('./fixtures.cjs');
const port = process.argv[2] || '5199';
const fails = []; const T0 = Date.now();
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}  [${((Date.now() - T0) / 1000).toFixed(0)} s]`); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  const imgs = await comicPages(ctx, 5, { dark: [1] });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => !!globalThis.__forgeQueue, null, { timeout: 60000 });
  await p.locator('input[type=file][accept*="pdf"]').setInputFiles(imgs);
  await p.waitForFunction(() => { const q = globalThis.__forgeQueue; const pr = window.__forge.getState().project; return pr.shots.length > 0 && q.active(pr.id).length === 0; }, null, { timeout: 180000, polling: 250 });
  // the review only recommends: nothing changes before the user clicks
  await p.evaluate(() => import('/src/store.ts').then((s) => s.update((x) => ({ ...x, pages: x.pages.map((pg) => ({ ...pg, kind: 'story', skip: false })) }))));
  await p.evaluate(async () => { const S = await import('/src/lib/studio.ts'); await S.takeVersion('Avant finition'); });
  await p.evaluate(() => import('/src/store.ts').then((s) => s.setUI({ exportOpen: true })));
  const issue = p.getByText(/ne ressemble/);
  await issue.waitFor({ timeout: 15000 });
  const txt = await issue.innerText();
  check(/^1 page/.test(txt) && /page-02/.test(txt) && /sombre/.test(txt), `la planche plus sombre est repérée (${txt.slice(0, 90)})`);
  const before = await p.evaluate(() => window.__forge.getState().project.pages.filter((pg) => pg.tone).length);
  check(before === 0, 'rien n’est changé avant ton accord');
  await p.getByRole('button', { name: 'Harmoniser les couleurs' }).click();
  const tones = await p.evaluate(() => window.__forge.getState().project.pages.map((pg) => (pg.tone ? +pg.tone.brightness.toFixed(2) : null)));
  check(tones.filter((x) => x).length === 1 && tones[1] > 1.1, `seule la planche sombre est éclaircie (${JSON.stringify(tones)})`);
  // the drawing itself is untouched: the correction is a render filter
  const same = await p.evaluate(async () => { const M = await import('/src/engine/media.ts'); const pg = window.__forge.getState().project.pages[3]; return !!M.getImage(pg.mediaId); });
  check(same, 'le fichier de la planche n’est pas modifié (filtre au rendu)');
  await p.evaluate(() => import('/src/store.ts').then((s) => s.setUI({ exportOpen: false, projectsOpen: true })));
  await p.getByRole('tab', { name: 'Versions' }).click();
  await p.locator('.pj-list li', { hasText: 'Avant finition' }).getByRole('button', { name: 'Comparer avec maintenant' }).click();
  const diff = await p.locator('.pj-diff').innerText();
  check(/Couleurs harmonisées .* 1 planche/.test(diff), `la comparaison de versions le dit (${diff.replace(/\n/g, ' · ')})`);
  await p.evaluate(() => import('/src/store.ts').then((s) => s.undo()));
  check(await p.evaluate(() => !window.__forge.getState().project.pages.some((pg) => pg.tone)), 'Ctrl+Z annule l’harmonisation');
  check(errs.length === 0, `aucune erreur de page ${errs.slice(0, 2).join(' | ')}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} échec(s)` : '\nTout est bon');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
