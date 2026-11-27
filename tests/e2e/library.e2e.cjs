// Media library, end to end, through the interface: two projects, the same page imported twice,
// search, duplicates, add a page of another project (same file, no copy).
// FORGE_E2E_CLIP=1 also runs the visual search (downloads the CLIP model, ~150 MB, once).
//   node tests/e2e/library.e2e.cjs [port]
const { chromium } = require('playwright');
const { comicPages } = require('./fixtures.cjs');
const port = process.argv[2] || '5199';
const fails = []; const T0 = Date.now();
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}  [${((Date.now() - T0) / 1000).toFixed(0)} s]`); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  const imgs = await comicPages(ctx, 3);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => !!globalThis.__forgeQueue, null, { timeout: 60000 });
  const settle = () => p.waitForFunction(() => { const q = globalThis.__forgeQueue; const pr = window.__forge.getState().project; return pr.shots.length > 0 && q.active(pr.id).length === 0; }, null, { timeout: 180000, polling: 250 });
  await p.locator('input[type=file][accept*="pdf"]').setInputFiles(imgs.slice(0, 2));
  await settle();
  await p.evaluate(() => import('/src/store.ts').then((s) => s.update((x) => ({ ...x, name: 'Projet A' }))));
  await p.evaluate(async () => { const S = await import('/src/lib/studio.ts'); await S.createProject('Projet B'); });
  await p.locator('input[type=file][accept*="pdf"]').setInputFiles([{ ...imgs[0], name: 'copie-page-01.png' }, imgs[2]]);
  await settle();
  await p.waitForTimeout(3000); // autosave into the workspace

  await p.getByRole('button', { name: 'Médiathèque' }).click();
  await p.waitForSelector('.ml-card', { timeout: 30000 });
  const all = await p.locator('.ml-card').count();
  check(all === 4, `4 pages de 2 projets dans la médiathèque (${all})`);
  await p.locator('#ml-q').fill('page-02');
  await p.waitForTimeout(300);
  check(await p.locator('.ml-card').count() === 1, 'recherche par mot : une seule page « page-02 »');
  await p.locator('.ml-card').first().click();
  const detail = await p.locator('.ml-detail').innerText();
  check(/Projet A/.test(detail) && /Utilisé dans/.test(detail), 'la fiche dit dans quel projet la page est utilisée');
  await p.locator('#ml-q').fill('');
  await p.locator('.ml-search select').selectOption('dups');
  await p.waitForTimeout(300);
  const dups = await p.locator('.ml-card').count();
  check(dups === 2, `doublon trouvé : la même page importée dans les deux projets, et seulement elle (${dups})`);

  await p.locator('.ml-search select').selectOption('image');
  const before = await p.evaluate(async () => { const S = await import('/src/lib/studio.ts'); const st = (await import('/src/store.ts')).getState(); return { pages: st.project.pages.length, media: (await S.workspace().listProjects()).length }; });
  await p.locator('#ml-q').fill('page-02');
  await p.waitForTimeout(300);
  await p.locator('.ml-grid li input[type=checkbox]').first().check();
  await p.getByRole('button', { name: /Ajouter 1 page au projet ouvert/ }).click();
  await p.waitForFunction((n) => window.__forge.getState().project.pages.length > n, before.pages, { timeout: 30000 });
  await settle();
  const after = await p.evaluate(async () => { const st = (await import('/src/store.ts')).getState(); const pr = st.project; const S = await import('/src/lib/studio.ts'); return { pages: pr.pages.length, shotsOnNew: pr.shots.filter((s) => s.pageId === pr.pages.at(-1).id).length, mediaId: pr.pages.at(-1).mediaId }; });
  const sameFile = await p.evaluate(async (id) => { const S = await import('/src/lib/studio.ts'); const r = await S.workspace().readProject((await S.listProjects()).find((m) => m.name === 'Projet A').id); return r.project.pages.some((pg) => pg.mediaId === id); }, after.mediaId);
  check(after.pages === before.pages + 1 && after.shotsOnNew > 0, `page ajoutée au projet B et découpée (${after.shotsOnNew} plans)`);
  check(sameFile, 'le projet B réutilise le même fichier que le projet A (aucune copie)');

  if (process.env.FORGE_E2E_CLIP) {
    await p.locator('.ml-search select').selectOption('all');
    await p.getByRole('radio', { name: /Description visuelle/ }).click();
    await p.getByRole('button', { name: /Analyser \d+ image/ }).click();
    await p.waitForFunction(() => /images analysées/.test(document.querySelector('.media-modal')?.textContent ?? '') && !/Analyser \d/.test(document.querySelector('.media-modal')?.textContent ?? ''), null, { timeout: 900000, polling: 1000 });
    await p.locator('#ml-q').fill('bandes dessinées colorées');
    await p.getByRole('button', { name: 'Chercher' }).click();
    await p.waitForFunction(() => /· \d+$/.test(document.querySelector('.ml-meta')?.textContent ?? ''), null, { timeout: 300000 });
    check(await p.locator('.ml-card').count() === 4, 'recherche par description : les images sont classées');
  } else console.log('  (recherche par description non testée ici : FORGE_E2E_CLIP=1 pour la lancer)');

  check(errs.length === 0, `aucune erreur de page ${errs.slice(0, 2).join(' | ')}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} échec(s)` : '\nTout est bon');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
