// Storyboard, end to end, through the interface: prepare, edit, recompute (edits kept), edit the video from it.
//   node tests/e2e/storyboard.e2e.cjs [port]
const { chromium } = require('playwright');
const { comicPages } = require('./fixtures.cjs');
const port = process.argv[2] || '5199';
const fails = []; const T0 = Date.now();
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}  [${((Date.now() - T0) / 1000).toFixed(0)} s]`); if (!ok) fails.push(what); };
const SCRIPT = 'Tout commence à la première page. La deuxième page change tout. La troisième page termine l’histoire. Et la fin arrive enfin.';

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  const imgs = await comicPages(ctx, 3);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => !!globalThis.__forgeQueue, null, { timeout: 60000 });
  await p.locator('input[type=file][accept*="pdf"]').setInputFiles(imgs);
  await p.waitForFunction(() => { const q = globalThis.__forgeQueue; const pr = window.__forge.getState().project; return pr.shots.length > 0 && q.active(pr.id).length === 0; }, null, { timeout: 180000, polling: 250 });
  await p.evaluate((s) => import('/src/store.ts').then((st) => st.update((x) => ({ ...x, script: s }))), SCRIPT);

  await p.getByRole('button', { name: 'Storyboard' }).click();
  await p.getByRole('button', { name: 'Préparer le storyboard' }).click();
  await p.waitForSelector('.sb-row', { timeout: 180000 });
  const rows = await p.locator('.sb-row').count();
  check(rows === 4, `une ligne par phrase (${rows})`);
  const hasVisual = await p.locator('.sb-row').first().locator('img').count();
  check(hasVisual >= 1, 'chaque ligne montre sa case');

  await p.locator('.sb-row').nth(0).locator('select').first().selectOption('tour');
  await p.locator('.sb-row').nth(1).getByRole('radio', { name: 'Visage' }).click();
  await p.locator('.sb-row').nth(2).locator('select').nth(1).selectOption('none');
  const edited = await p.evaluate(() => window.__forge.getState().project.storyboard.rows.map((r) => r.edited ?? []));
  check(edited[0].includes('camera') && edited[1].includes('mode') && edited[2].includes('sound'), 'les choix sont marqués « modifiés à la main »');
  await p.evaluate(() => import('/src/store.ts').then((s) => s.undo()));
  const undone = await p.evaluate(() => window.__forge.getState().project.storyboard.rows[2].sound);
  check(undone !== 'none', 'Ctrl+Z annule le dernier choix du storyboard');
  await p.evaluate(() => import('/src/store.ts').then((s) => s.redo()));

  await p.getByRole('button', { name: 'Recalculer (garde tes choix)' }).click();
  await p.waitForFunction(() => { const q = globalThis.__forgeQueue; return !q.tasks.some((t) => t.kind === 'storyboard.plan' && ['queued', 'running', 'waiting'].includes(t.state)); }, null, { timeout: 120000 });
  await p.waitForTimeout(500);
  const kept = await p.evaluate(() => window.__forge.getState().project.storyboard.rows.map((r) => [r.camera, r.mode, r.sound]));
  check(kept[0][0] === 'tour' && kept[1][1] === 'face' && kept[2][2] === 'none', `recalculer garde les choix (${JSON.stringify(kept.slice(0, 3))})`);

  await p.getByRole('button', { name: 'Monter selon ce storyboard' }).click();
  await p.getByRole('dialog').getByText('Suivre mon storyboard').waitFor({ timeout: 10000 });
  check(true, 'la fenêtre de montage propose de suivre le storyboard');
  await p.locator('.modal').getByRole('button', { name: /Lancer le montage/ }).click();
  await p.waitForFunction(() => window.__forge.getState().project.shots.some((s) => s.match), null, { timeout: 180000 });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(() => {
    const pr = window.__forge.getState().project; const rows = pr.storyboard.rows;
    const of = (i) => pr.shots.filter((s) => s.match?.sentence === rows[i].text);
    return { s0: of(0).map((s) => [s.motion, s.why]), s1: of(1).length, s2: of(2).map((s) => s.sfx), notes: window.__forge.getState().ui.lastNotes ?? [] };
  });
  check(r.s0.length > 0 && r.s0.every(([m]) => m === 'tour'), `phrase 1 : mouvement « Explorer » du storyboard (${JSON.stringify(r.s0)})`);
  check(r.s1 === 0, `phrase 2 en « Visage » : aucune case dessus (${r.s1})`);
  check(r.s2.length > 0 && r.s2.every((x) => x === 'none'), `phrase 3 : son coupé comme demandé (${JSON.stringify(r.s2)})`);
  check(errs.length === 0, `aucune erreur de page ${errs.slice(0, 2).join(' | ')}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} échec(s)` : '\nTout est bon');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
