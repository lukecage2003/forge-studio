// Light preview copy (proxy) of a large rush, end to end: a 1080p rush is imported, the task queue
// makes a 540p copy, the preview plays it, the export still reads the original, and the copy can
// be removed safely. Also measures what the copy saves when the preview seeks.
//   node tests/e2e/proxy.e2e.cjs [port]
const { chromium } = require('playwright');
const port = process.argv[2] || '5199';
const fails = []; const T0 = Date.now();
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}  [${((Date.now() - T0) / 1000).toFixed(0)} s]`); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => !!globalThis.__forgeQueue, null, { timeout: 60000 });
  // a 1080p rush with detail (noise squares), recorded in the page, then imported like a file
  await p.evaluate(async () => {
    const W = 1920, H = 1080, c = Object.assign(document.createElement('canvas'), { width: W, height: H }); const g = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 8e6 }); const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data);
    let raf = 0, n = 0; const draw = () => { n++; for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${(i * 37 + n * 5) % 360},70%,${30 + (i * 13 + n) % 50}%)`; g.fillRect((i * 97 + n * 11) % W, (i * 53 + n * 7) % H, 60, 60); } raf = requestAnimationFrame(draw); }; draw();
    rec.start(250); await new Promise((r) => setTimeout(r, 8000)); rec.stop(); await new Promise((r) => (rec.onstop = r)); cancelAnimationFrame(raf);
    const R = await import('/src/rush.ts'); await R.importRush(new File(chunks, 'rush-1080p.webm', { type: 'video/webm' }));
  });
  await p.waitForFunction(() => { const q = globalThis.__forgeQueue; const t = q.tasks.find((x) => x.kind === 'rush.proxy'); return t && ['done', 'failed'].includes(t.state); }, null, { timeout: 300000, polling: 500 });
  const r = await p.evaluate(async () => {
    const q = globalThis.__forgeQueue; const t = q.tasks.find((x) => x.kind === 'rush.proxy');
    const M = await import('/src/engine/media.ts'); const ar = window.__forge.getState().project.aroll;
    await new Promise((res) => setTimeout(res, 300));
    const url = M.previewUrl(ar.mediaId), orig = M.getVideo(ar.mediaId).url;
    const dims = (u) => new Promise((res) => { const v = document.createElement('video'); v.muted = true; v.onloadedmetadata = () => res([v.videoWidth, v.videoHeight]); v.src = u; });
    // preview seeks: average time to show a frame at 25 scattered points
    const seeks = async (u) => { const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = u; await new Promise((res) => (v.onloadeddata = res)); const ts = []; for (let i = 0; i < 25; i++) { const s = performance.now(); await new Promise((res) => { v.onseeked = res; v.currentTime = ((i * 7) % 25) / 25 * (ar.duration - 0.2); }); ts.push(performance.now() - s); } return ts.reduce((a, x) => a + x, 0) / ts.length; };
    return { state: t.state, err: t.error?.message, isProxy: url !== orig, proxy: await dims(url), original: await dims(orig), seekProxy: await seeks(url), seekOrig: await seeks(orig), arW: ar.width };
  });
  check(r.state === 'done', `copie légère faite par la file de tâches ${r.err ?? ''}`);
  check(r.isProxy && r.proxy[0] === 960 && r.proxy[1] === 540, `l’aperçu lit la copie ${r.proxy.join('×')} (original ${r.original.join('×')})`);
  check(r.arW === 1920, 'le projet garde les dimensions de l’original (l’export lit l’original)');
  console.log(`  déplacement dans l’aperçu : ${r.seekOrig.toFixed(1)} ms sur l’original, ${r.seekProxy.toFixed(1)} ms sur la copie`);
  // the export reads the original: it takes the media blob of the rush (engine/export), which is the 1920×1080 file
  const exp = await p.evaluate(async () => {
    const M = await import('/src/engine/media.ts'); const ar = window.__forge.getState().project.aroll; const blob = await M.mediaBlob(ar.mediaId);
    const u = URL.createObjectURL(blob); const v = document.createElement('video'); v.muted = true; v.src = u;
    await new Promise((res) => (v.onloadedmetadata = res)); return [v.videoWidth, v.videoHeight];
  });
  check(exp[0] === 1920 && exp[1] === 1080, `le fichier lu par l’export est l’original (${exp.join('×')})`);
  // a later session finds the copy in the workspace, then the copy is removed: the preview reads the original again
  const again = await p.evaluate(async () => {
    const M = await import('/src/engine/media.ts'); const S = await import('/src/lib/studio.ts'); const ar = window.__forge.getState().project.aroll;
    await S.saveNow();
    M.dropProxies(); const back = await M.loadProxy(ar.mediaId);
    const disk = (await S.diskUsage()).proxies.count;
    const n = await S.removeProxies();
    return { back, disk, n, orig: M.previewUrl(ar.mediaId) === M.getVideo(ar.mediaId).url, media: !!(await M.mediaBlob(ar.mediaId)) };
  });
  check(again.back && again.disk === 1, 'la copie est retrouvée dans le dossier du projet à la session suivante');
  check(again.n === 1 && again.orig && again.media, 'supprimer les aperçus : l’aperçu relit l’original, le rush est intact');
  check(errs.length === 0, `aucune erreur de page ${errs.slice(0, 2).join(' | ')}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} échec(s)` : '\nTout est bon');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
