// A new publication of Forge while a tab is open, end to end, on production builds served under
// /forge-studio/ like GitHub Pages. Builds two versions (A, then B with new module names), then:
//  1. publication WITHOUT the kept older files (what happened before): the window asks for a controlled
//     reload instead of crashing; after the reload the project is intact and both windows open;
//  2. publication WITH the kept older files (scripts/keep-old-assets.mjs): the old tab keeps working and
//     a bar announces the new version;
//  3. broken publication (the file is missing even in the new version): one reload at most, then an
//     honest message — never a loop.
//   node tests/e2e/update.e2e.cjs
const { chromium } = require('playwright');
const { execSync, spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-update-'));
const SITE = path.join(tmp, 'site'), PORT = 4179, URL = `http://localhost:${PORT}/forge-studio/`;
const fails = []; const T0 = Date.now();
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}  [${((Date.now() - T0) / 1000).toFixed(0)} s]`); if (!ok) fails.push(what); };

const build = (name, env) => { const out = path.join(tmp, name); execSync(`npx vite build --outDir "${out}" --emptyOutDir`, { cwd: ROOT, env: { ...process.env, ...env }, stdio: 'ignore' }); return out; };
const publish = (dir, { keep = false } = {}) => {
  const prev = path.join(tmp, 'prev');
  fs.rmSync(prev, { recursive: true, force: true });
  if (fs.existsSync(SITE)) fs.cpSync(SITE, prev, { recursive: true });
  fs.rmSync(SITE, { recursive: true, force: true });
  fs.cpSync(dir, SITE, { recursive: true });
  if (keep) execSync(`node scripts/keep-old-assets.mjs "${SITE}" "${prev}" 30`, { cwd: ROOT, stdio: 'inherit' });
};
const names = (dir) => fs.readdirSync(path.join(dir, 'assets')).filter((f) => /^(AiCenter|AssistantModal)-/.test(f)).sort();

(async () => {
  const A = build('A', { FORGE_BUILD: 'essai-A' });
  const B = build('B', { FORGE_BUILD: 'essai-B', FORGE_TEST_RENAME: 'b' });
  check(names(A).join() !== names(B).join(), `deux versions aux noms de fichiers différents (${names(A).join(', ')} → ${names(B).join(', ')})`);
  const server = spawn(process.execPath, [path.join(ROOT, 'scripts/static-server.cjs'), SITE, String(PORT)], { stdio: 'ignore' });
  const browser = await chromium.launch();
  const open = async () => {
    const ctx = await browser.newContext(); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    let loads = 0; p.on('load', () => loads++);
    await p.goto(URL); await p.waitForSelector('.topbar', { timeout: 60000 });
    return { ctx, p, errs, loads: () => loads };
  };
  const ai = (p) => p.getByTitle(/Centre de contrôle IA/).click();
  const assistant = (p) => p.getByTitle(/Assistant de montage/).click();
  const close = async (p) => { const b = p.locator('.modal').getByRole('button', { name: 'Fermer' }).first(); if (await b.count()) await b.click(); else await p.keyboard.press('Escape'); };
  const sees = (p, text, ms = 8000) => p.getByText(text).first().waitFor({ timeout: ms }).then(() => true, () => false);
  try {
    publish(A);
    await new Promise((r) => setTimeout(r, 500));

    /* 0. normal use, under /forge-studio/ */
    { const { ctx, p } = await open();
      await ai(p); check(await sees(p, 'Centre de contrôle IA'), 'le Centre de contrôle IA s’ouvre (version A, sous /forge-studio/)'); await close(p);
      await assistant(p); check(await sees(p, 'Assistant de montage'), 'l’Assistant de montage s’ouvre'); await close(p);
      check(execSync(`node scripts/check-build.mjs ${URL}`, { cwd: ROOT }).toString().includes('✓'), 'toutes les références du site servi sont présentes');
      await ctx.close(); }

    /* 1. new publication without the kept files (the situation of the logs) */
    { publish(A);
      const { ctx, p, errs, loads } = await open();
      await p.locator('.project-name').fill('Projet qui doit survivre');
      await p.waitForTimeout(1500); // autosave
      publish(B, { keep: false });
      await ai(p);
      check(await sees(p, 'Forge a été mis à jour'), 'fenêtre d’un ancien fichier : proposition de rechargement (pas de fenêtre d’erreur)');
      check(!(await p.getByText('Cette zone a rencontré un problème').count()), 'pas de fenêtre « Cette zone a rencontré un problème »');
      await p.getByRole('button', { name: 'Enregistrer et recharger' }).click();
      await p.waitForSelector('.topbar', { timeout: 60000 }); await p.waitForTimeout(1500);
      check(await p.locator('.project-name').inputValue() === 'Projet qui doit survivre', 'après le rechargement, le projet est intact');
      check(await p.evaluate(() => fetch('version.json', { cache: 'no-store' }).then((r) => r.json()).then((v) => v.build)) === 'essai-B', 'la page rechargée est la version B');
      await ai(p); check(await sees(p, 'Centre de contrôle IA'), 'le Centre de contrôle IA s’ouvre après rechargement'); await close(p);
      await assistant(p); check(await sees(p, 'Assistant de montage'), 'l’Assistant de montage s’ouvre après rechargement'); await close(p);
      check(loads() === 2, `un seul rechargement (${loads() - 1})`);
      check(!errs.some((e) => /dynamically imported/.test(e)), `aucune erreur non gérée ${errs.slice(0, 2).join(' | ')}`);
      await ctx.close(); }

    /* 2. new publication with the kept files: the old tab keeps working, and is told about the new version */
    { publish(A);
      const { ctx, p } = await open();
      publish(B, { keep: true });
      await ai(p); check(await sees(p, 'Centre de contrôle IA'), 'ancien onglet après publication : le Centre de contrôle IA s’ouvre (anciens fichiers gardés)'); await close(p);
      await assistant(p); check(await sees(p, 'Assistant de montage'), 'ancien onglet : l’Assistant de montage s’ouvre'); await close(p);
      check(!(await p.getByText('Forge a été mis à jour').count()), 'aucune interruption');
      // what returning to the tab does after a while: ask the server which version it has
      await p.evaluate(() => window.__forge.checkForUpdate(true));
      check(await sees(p, 'Une nouvelle version de Forge est disponible'), 'une barre annonce la nouvelle version');
      const out = execSync(`node scripts/check-build.mjs ${URL}`, { cwd: ROOT }).toString();
      check(/fichiers de versions précédentes/.test(out) && out.includes('✓'), `site publié cohérent, anciens fichiers accessibles (${out.split('\n')[0].replace(/^.*: /, '')})`);
      await ctx.close(); }

    /* 3. broken publication: the file is missing in the new version too */
    { publish(A);
      const { ctx, p, loads } = await open();
      publish(B, { keep: false });
      for (const f of fs.readdirSync(path.join(SITE, 'assets'))) if (/^AiCenter-/.test(f)) fs.rmSync(path.join(SITE, 'assets', f));
      await ai(p);
      await p.getByRole('button', { name: 'Enregistrer et recharger' }).click();
      await p.waitForSelector('.topbar', { timeout: 60000 }); await p.waitForTimeout(800);
      await ai(p);
      check(await sees(p, 'Fichier introuvable sur le serveur'), 'après un rechargement inutile : message honnête');
      check(!(await p.getByRole('button', { name: 'Enregistrer et recharger' }).count()), 'plus de bouton de rechargement : pas de boucle');
      await p.waitForTimeout(3000);
      check(loads() === 2, `aucun rechargement automatique (${loads() - 1} rechargement)`);
      await ctx.close(); }
  } finally {
    await browser.close(); server.kill();
    try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* Windows may keep a lock a moment */ }
  }
  console.log(fails.length ? `\n${fails.length} échec(s)` : '\nTout est bon');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
