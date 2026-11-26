// Production studio, end to end, against the dev server (npx vite --port 5199 --strictPort):
//   node tests/e2e/studio.e2e.cjs [port]
// Uses the browser's private storage (the folder picker needs a human click).
// Checks: autosave to the workspace, several projects, versions, crash recovery.
const { chromium } = require('playwright');
const port = process.argv[2] || '5199';
const URL = `http://localhost:${port}/`;
const fails = [];
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext();
  // a synthetic comic page: four panels drawn on a canvas (no copyrighted material)
  const art = await ctx.newPage();
  await art.setContent('<canvas id=c width=800 height=1200></canvas><script>const x=c.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,800,1200);x.lineWidth=8;[[30,30,360,540],[410,30,360,540],[30,630,360,540],[410,630,360,540]].forEach(([a,b,w,h],i)=>{x.fillStyle=["#e63","#36c","#3a6","#c3a"][i];x.fillRect(a,b,w,h);x.strokeRect(a,b,w,h)})</script>');
  const png = await art.locator('#c').screenshot();
  await art.close();

  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL); await p.waitForTimeout(1500);
  const studio = () => p.evaluate(() => import('/src/lib/studio.ts').then(() => true));
  await studio();
  const where = await p.evaluate(() => window.__forge.getState().ui.where);
  check(where === 'browser', `espace de projets ouvert dans le navigateur (${where})`);

  await p.locator('input[type=file][accept*="pdf"]').setInputFiles({ name: 'page.png', mimeType: 'image/png', buffer: png });
  await p.waitForFunction(() => window.__forge.getState().project.pages.length === 1 && !window.__forge.getState().ui.busy, null, { timeout: 120000 });
  await p.evaluate(() => import('/src/store.ts').then((s) => s.update((q) => ({ ...q, name: 'Projet A' }))));
  await p.waitForTimeout(3500); // journal 0.6 s + workspace write 2 s
  const a = await p.evaluate(async () => {
    const S = await import('/src/lib/studio.ts');
    const list = await S.listProjects();
    const ws = S.workspace();
    const cur = window.__forge.getState().project;
    return { list: list.map((m) => m.name), hasMedia: await ws.hasMedia(cur.pages[0].mediaId), id: cur.id };
  });
  check(a.list.includes('Projet A'), 'le projet est enregistré dans l’espace');
  check(a.hasMedia, 'la page est copiée dans les médias de l’espace');

  const b2 = await p.evaluate(async (idA) => {
    const S = await import('/src/lib/studio.ts');
    await S.createProject('Projet B');
    const names = (await S.listProjects()).map((m) => m.name).sort();
    const st = window.__forge.getState().project;
    const fresh = st.name === 'Projet B' && st.pages.length === 0 && st.production?.tasks.length > 0;
    await S.openProject(idA);
    const back = window.__forge.getState().project;
    return { names, fresh, backName: back.name, backPages: back.pages.length };
  }, a.id);
  check(b2.names.join(',') === 'Projet A,Projet B', `deux projets dans la liste (${b2.names})`);
  check(b2.fresh, 'un nouveau projet part vide, avec sa liste de tâches');
  check(b2.backName === 'Projet A' && b2.backPages === 1, 'rouvrir le projet A rend sa page');

  const v = await p.evaluate(async () => {
    const S = await import('/src/lib/studio.ts'); const st = await import('/src/store.ts');
    const ver = await S.takeVersion('Avant essai');
    st.update((q) => ({ ...q, name: 'Projet A modifié' }));
    await S.restoreVersion(ver.file);
    const vs = await S.listVersions();
    return { name: window.__forge.getState().project.name, labels: vs.map((x) => x.label) };
  });
  check(v.name === 'Projet A', 'restaurer une version rend l’état d’avant');
  check(v.labels.includes('Avant restauration'), 'l’état remplacé est gardé en version (restauration annulable)');

  // crash: the journal is written, the page closes before the workspace write
  await p.evaluate(() => import('/src/store.ts').then(async (s) => { s.update((q) => ({ ...q, name: 'Après plantage' })); await s.flushSave(); }));
  await p.reload();
  const sawToast = await p.waitForFunction(() => document.body.innerText.includes('récupérées'), null, { timeout: 8000, polling: 100 }).then(() => true, () => false);
  await p.waitForTimeout(500);
  const r = await p.evaluate(async () => {
    const S = await import('/src/lib/studio.ts');
    const cur = window.__forge.getState().project;
    const disk = await S.workspace().readProject(cur.id);
    return { name: cur.name, disk: disk?.project.name };
  });
  check(r.name === 'Après plantage' && r.disk === 'Après plantage', `après rechargement brutal, rien n’est perdu (${r.name} / ${r.disk})`);
  check(sawToast, 'Forge signale la récupération');
  // the Projects window, driven like a user
  await p.getByRole('button', { name: 'Projets' }).click();
  await p.getByRole('dialog').waitFor();
  await p.locator('#pj-new-name').fill('Projet C');
  await p.getByRole('button', { name: 'Nouveau projet' }).last().click();
  await p.getByRole('radio', { name: 'Montage' }).waitFor();
  await p.getByRole('radio', { name: 'Montage' }).click();
  await p.locator('.pj-tasks input[type=checkbox]').first().check();
  await p.locator('#pj-task').fill('Choisir la musique'); await p.locator('#pj-task').press('Enter');
  const ui1 = await p.evaluate(() => { const pr = window.__forge.getState().project; return { name: pr.name, status: pr.production?.status, done: pr.production?.tasks.filter((t) => t.done).length, added: pr.production?.tasks.some((t) => t.text === 'Choisir la musique') }; });
  check(ui1.name === 'Projet C' && ui1.status === 'montage' && ui1.done === 1 && ui1.added, 'fenêtre Projets : créer, avancer le statut, cocher et ajouter une tâche');
  await p.getByRole('tab', { name: 'Versions' }).click();
  await p.locator('#pj-ver').fill('Avant musique');
  await p.getByRole('button', { name: 'Créer une version' }).click();
  await p.getByText('Avant musique').waitFor({ timeout: 5000 });
  await p.evaluate(() => import('/src/store.ts').then((s) => s.update((q) => ({ ...q, name: 'Projet C bis' }))));
  await p.locator('.pj-list li', { hasText: 'Avant musique' }).getByRole('button', { name: 'Restaurer' }).click();
  await p.locator('.pj-confirm').getByRole('button', { name: 'Restaurer' }).click();
  await p.waitForFunction(() => window.__forge.getState().project.name === 'Projet C', null, { timeout: 5000 }).catch(() => {});
  check(await p.evaluate(() => window.__forge.getState().project.name) === 'Projet C', 'fenêtre Projets : restaurer une version');
  await p.getByRole('tab', { name: 'Tous les projets' }).click();
  await p.waitForTimeout(800);
  const rows = await p.locator('.pj-list li').count();
  check(rows === 3, `la liste montre les 3 projets (${rows})`);
  if (process.env.SHOT) await p.locator('.projects-modal').screenshot({ path: process.env.SHOT });
  check(errs.length === 0, `aucune erreur de page ${errs.length ? errs.join(' | ') : ''}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} échec(s)` : '\nTout est bon');
  process.exit(fails.length ? 1 : 0);
})();
