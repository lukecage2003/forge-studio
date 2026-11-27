// Delivery, end to end, against the dev server: render once for TikTok, Shorts and Reels,
// read the finished file back, and open the publication kit.
//   node tests/e2e/delivery.e2e.cjs [port]
const { chromium } = require('playwright');
const { comicPages, toneWav } = require('./fixtures.cjs');
const port = process.argv[2] || '5199';
const fails = [];
const T0 = Date.now();
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}  [${((Date.now() - T0) / 1000).toFixed(0)} s]`); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  const imgs = await comicPages(ctx, 3);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => !!globalThis.__forgeQueue, null, { timeout: 60000 });
  await p.locator('input[type=file][accept*="pdf"]').setInputFiles(imgs);
  await p.waitForFunction(() => { const q = globalThis.__forgeQueue; const pr = window.__forge.getState().project; return pr.shots.length > 0 && q.active(pr.id).length === 0; }, null, { timeout: 180000, polling: 250 });
  await p.locator('input[type=file][accept^="audio/*"]').first().setInputFiles(toneWav(12));
  await p.waitForFunction(() => window.__forge.getState().project.audio.length > 0, null, { timeout: 30000 });
  await p.evaluate(async () => { const st = await import('/src/store.ts'); st.update((x) => ({ ...x, name: 'Essai livraison', script: 'Une équipe de héros affronte une menace venue de l’espace. Personne ne sait comment cela va finir.' })); });
  const r = await p.evaluate(async () => {
    const K = await import('/src/production/kinds.ts'); const q = globalThis.__forgeQueue;
    const { render, kit } = await K.deliver({ name: 'essai-9x16.mp4', quality: 'high', fps: 30, burn: true, platforms: ['tiktok', 'shorts', 'reels'] });
    await q.idle([render.id, kit.id]);
    const R = q.get(render.id), D = q.get(kit.id);
    const zip = K.renders.get(kit.id);
    const qc = q.tasks.find((t) => t.kind === 'qc' && R.deps.includes(t.id));
    return { render: R.state, renderErr: R.error?.message, report: R.result?.report, kit: D.state, kitErr: D.error?.message, zip: zip ? Array.from(new Uint8Array(await zip.arrayBuffer())) : [], qcState: qc?.state, checks: D.result?.checks };
  });
  const { unzipSync, strFromU8 } = require('fflate');
  const files = r.zip.length ? unzipSync(Uint8Array.from(r.zip)) : {};
  Object.assign(r, { files: Object.keys(files).sort(), tiktok: files['tiktok.txt'] ? strFromU8(files['tiktok.txt']) : '', qcTxt: files['controle-technique.txt'] ? strFromU8(files['controle-technique.txt']) : '' });
  check(r.qcState === 'done', `contrôle qualité du projet avant le rendu (${r.qcState})`);
  check(r.render === 'done', `rendu terminé ${r.renderErr ?? ''}`);
  const rep = r.report || {};
  check(rep.width === 1080 && rep.height === 1920, `fichier relu : ${rep.width}×${rep.height}`);
  check(Math.abs((rep.fps ?? 0) - 30) < 0.5, `cadence mesurée ${rep.fps?.toFixed(2)} i/s`);
  check(rep.lufs != null && Math.abs(rep.lufs + 14) < 1.5, `volume mesuré dans le fichier : ${rep.lufs?.toFixed(1)} LUFS (cible −14)`);
  check(rep.truePeakDb != null && rep.truePeakDb <= -0.9, `crête vraie ${rep.truePeakDb?.toFixed(2)} dBTP (≤ −1 attendu)`);
  check(rep.clipped === 0, `aucun échantillon saturé (${rep.clipped})`);
  check(Array.isArray(rep.black) && rep.black.length === 0, `aucun passage noir (${JSON.stringify(rep.black)})`);
  check(r.kit === 'done', `kit de publication terminé ${r.kitErr ?? ''}`);
  const want = ['controle-technique.txt', 'couverture.png', 'essai-9x16.mp4', 'reels.txt', 'shorts.txt', 'tiktok.txt'];
  check(want.every((f) => r.files.includes(f)), `le kit contient la vidéo, la couverture, les textes et le contrôle (${r.files.join(', ')})`);
  check(/TITRE\nEssai livraison/.test(r.tiktok) && /#comics/.test(r.tiktok) && /rien n’a été envoyé/.test(r.tiktok), 'texte TikTok : titre, hashtags, et rien n’est publié');
  console.log(r.qcTxt.split('\n').map((l) => '    ' + l).join('\n'));
  check(errs.length === 0, `aucune erreur de page ${errs.slice(0, 2).join(' | ')}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} échec(s)` : '\nTout est bon');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
