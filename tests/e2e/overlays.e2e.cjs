// Overlay tracks, end to end: a panel in a picture-in-picture and a video on the top half, placed
// from the commands, edited in the inspector, then exported. The exported MP4 is read back and the
// overlay regions compared with the preview renderer (one renderer: they must match) and with the
// same frame without overlays (they must differ). Undo, the .forge file and the cleanup are checked.
//   node tests/e2e/overlays.e2e.cjs [port]
const { chromium } = require('playwright');
const { comicPages } = require('./fixtures.cjs');
const port = process.argv[2] || '5199';
const fails = []; const T0 = Date.now();
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}  [${((Date.now() - T0) / 1000).toFixed(0)} s]`); if (!ok) fails.push(what); };

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const imgs = await comicPages(ctx, 3);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => !!globalThis.__forgeQueue, null, { timeout: 60000 });
  await p.locator('input[type=file][accept*="pdf"]').setInputFiles(imgs);
  await p.waitForFunction(() => { const q = globalThis.__forgeQueue; const pr = window.__forge.getState().project; return pr.shots.length > 0 && q.active(pr.id).length === 0; }, null, { timeout: 180000, polling: 250 });

  // 1. the selected panel, from the command palette, at 1 s
  await p.evaluate(async () => { const st = await import('/src/store.ts'); const pr = st.getState().project; st.setUI({ playhead: 1, selection: { kind: 'shot', id: pr.shots[pr.shots.length - 1].id } }); });
  await p.keyboard.press('Control+k'); await p.keyboard.type('superposer la case'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => (window.__forge.getState().project.overlays ?? []).length === 1, null, { timeout: 10000 });
  check(true, 'case superposée depuis la palette de commandes');
  await p.getByText('Calque superposé · piste 1').waitFor({ timeout: 5000 });
  check(true, 'l’inspecteur montre la superposition');

  // 2. a video (recorded in the page: a yellow square moving on blue), at 3 s, put on the top half
  await p.evaluate(async () => {
    const W = 640, H = 360, c = Object.assign(document.createElement('canvas'), { width: W, height: H }); const g = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 3e6 }); const ch = []; rec.ondataavailable = (e) => ch.push(e.data);
    let raf = 0; const t0 = performance.now(); const draw = () => { const k = (performance.now() - t0) / 1000; g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, W, H); g.fillStyle = '#facc15'; g.fillRect(40 + k * 60, 100, 160, 160); raf = requestAnimationFrame(draw); }; draw();
    rec.start(200); await new Promise((r) => setTimeout(r, 4500)); rec.stop(); await new Promise((r) => (rec.onstop = r)); cancelAnimationFrame(raf);
    const st = await import('/src/store.ts'); st.setUI({ playhead: 3 });
    const A = await import('/src/actions.ts'); await A.importOverlayFiles([new File(ch, 'plan-de-coupe.webm', { type: 'video/webm' })]);
  });
  await p.waitForFunction(() => (window.__forge.getState().project.overlays ?? []).length === 2, null, { timeout: 30000 });
  await p.getByRole('radio', { name: 'Moitié haute' }).click();
  const ovs = await p.evaluate(() => window.__forge.getState().project.overlays.map((o) => ({ kind: o.source.kind, place: o.place, track: o.track, start: o.start, d: +o.duration.toFixed(2) })));
  check(ovs[0].place === 'pip' && ovs[1].kind === 'video' && ovs[1].place === 'top' && ovs[1].start === 3, `vidéo superposée à 3 s, placée en moitié haute depuis l’inspecteur (${JSON.stringify(ovs)})`);
  check(await p.locator('.ov-chip').count() === 2, 'deux blocs sur la rangée « Calques » de la timeline');

  // 3. export, then compare the exported frames with the renderer
  const r = await p.evaluate(async () => {
    const st = await import('/src/store.ts'); const pr = st.getState().project;
    const T = await import('/src/engine/timeline.ts'); const dur = T.videoDuration(pr);
    const K = await import('/src/production/kinds.ts'); const q = globalThis.__forgeQueue;
    const { render } = await K.deliver({ name: 'superpositions.mp4', quality: 'high', fps: 30, burn: false, platforms: ['tiktok'] });
    await q.idle([render.id]);
    const blob = K.renders.get(render.id);
    const R = await import('/src/engine/render.ts'); const O = await import('/src/engine/overlays.ts');
    const W = 1080, H = 1920;
    const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(blob); await new Promise((res) => (v.onloadeddata = res));
    const frameAt = async (t) => { await new Promise((res) => { v.onseeked = res; v.currentTime = t; }); const c = new OffscreenCanvas(W, H); c.getContext('2d').drawImage(v, 0, 0, W, H); return c.getContext('2d').getImageData(0, 0, W, H).data; };
    // the overlay video's own frame for the reference render
    const ovv = pr.overlays.find((o) => o.source.kind === 'video');
    const M = await import('/src/engine/media.ts'); const src = document.createElement('video'); src.muted = true; src.src = M.getVideo(ovv.source.mediaId).url; await new Promise((res) => (src.onloadeddata = res));
    const refAt = async (t, withOv) => {
      if (ovv && t >= ovv.start && t < ovv.start + ovv.duration) await new Promise((res) => { src.onseeked = res; src.currentTime = O.overlaySourceTime(ovv, t); });
      const c = new OffscreenCanvas(W, H); R.createRenderer(W, H).draw(c.getContext('2d'), withOv ? pr : { ...pr, overlays: [] }, t, undefined, () => src);
      return c.getContext('2d').getImageData(0, 0, W, H).data;
    };
    const diff = (a, b2, box) => { let s = 0, n = 0; for (let y = box.y; y < box.y + box.h; y += 4) for (let x = box.x; x < box.x + box.w; x += 4) { const i = (y * W + x) * 4; s += Math.abs(a[i] - b2[i]) + Math.abs(a[i + 1] - b2[i + 1]) + Math.abs(a[i + 2] - b2[i + 2]); n += 3; } return s / n; };
    const out = {};
    for (const [name, t, place] of [['case', 1.6, 'pip'], ['vidéo', 4.2, 'top']]) {
      const box = O.placeBox(place, W, H); const inner = { x: Math.round(box.x + box.w * 0.1), y: Math.round(box.y + box.h * 0.1), w: Math.round(box.w * 0.8), h: Math.round(box.h * 0.8) };
      const e = await frameAt(t), withOv = await refAt(t, true), without = await refAt(t, false);
      out[name] = { vsRendu: +diff(e, withOv, inner).toFixed(1), sansSuperposition: +diff(e, without, inner).toFixed(1) };
    }
    return { state: q.get(render.id).state, dur: +dur.toFixed(1), out };
  });
  check(r.state === 'done', 'export terminé');
  for (const [name, d] of Object.entries(r.out)) {
    check(d.vsRendu < 14 && d.sansSuperposition > 3 * d.vsRendu + 10, `${name} présente dans le MP4, identique à l’aperçu (écart ${d.vsRendu}/255, contre ${d.sansSuperposition} sans superposition)`);
  }

  // 4. undo, .forge, cleanup
  const z = await p.evaluate(async () => {
    const st = await import('/src/store.ts'); const S = await import('/src/lib/studio.ts');
    const place = () => st.getState().project.overlays.find((o) => o.source.kind === 'video').place;
    const before = place();
    st.undo(); const afterUndo = place(); st.redo(); const afterRedo = place();
    const { blob } = await S.exportForge();
    const PF = await import('/src/lib/projectFile.ts'); const back = await PF.readProjectFile(blob);
    const vid = back.project.overlays.find((o) => o.source.kind === 'video');
    const disk = await S.diskUsage();
    return { before, afterUndo, afterRedo, overlays: back.project.overlays.length, hasVideo: !!back.media.get(vid.source.mediaId)?.size, missing: back.manifest.missing.length, unused: disk.unused.length };
  });
  check(z.before === 'top' && z.afterUndo === 'full' && z.afterRedo === 'top', `Ctrl+Z annule le placement, Ctrl+Maj+Z le remet (${z.before} → ${z.afterUndo} → ${z.afterRedo})`);
  check(z.overlays === 2 && z.hasVideo && z.missing === 0, 'le fichier .forge emporte les superpositions et la vidéo superposée');
  check(z.unused === 0, 'le nettoyage considère la vidéo superposée comme utilisée');
  check(errs.length === 0, `aucune erreur de page ${errs.slice(0, 2).join(' | ')}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} échec(s)` : '\nTout est bon');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
