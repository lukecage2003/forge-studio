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
  await p.evaluate(async () => { const st = await import('/src/store.ts'); const pr = st.getState().project; st.setUI({ playhead: 1, selection: { kind: 'shot', id: pr.shots.find((s) => s.pageId === pr.pages[1].id).id } }); });
  await p.keyboard.press('Control+k'); await p.keyboard.type('superposer la case'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => (window.__forge.getState().project.overlays ?? []).length === 1, null, { timeout: 10000 });
  check(true, 'case superposée depuis la palette de commandes');
  await p.getByText('Calque superposé · piste 1').waitFor({ timeout: 5000 });
  check(true, 'l’inspecteur montre la superposition');

  // 2. a video (recorded in the page: a yellow square moving on blue), at 3 s, put on the top half
  await p.evaluate(async () => {
    const W = 640, H = 360, c = Object.assign(document.createElement('canvas'), { width: W, height: H }); const g = c.getContext('2d');
    // with a sound track (a tone), so its sound can be kept
    const ac = new AudioContext(); const dest = ac.createMediaStreamDestination(); const osc = ac.createOscillator(); const g2 = ac.createGain(); g2.gain.value = 0.3; osc.connect(g2).connect(dest); osc.start();
    const rec = new MediaRecorder(new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]), { mimeType: 'video/webm;codecs=vp8,opus', videoBitsPerSecond: 3e6 }); const ch = []; rec.ondataavailable = (e) => ch.push(e.data);
    let raf = 0; const t0 = performance.now(); const draw = () => { const k = (performance.now() - t0) / 1000; g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, W, H); g.fillStyle = '#facc15'; g.fillRect(40 + k * 60, 100, 160, 160); raf = requestAnimationFrame(draw); }; draw();
    rec.start(200); await new Promise((r) => setTimeout(r, 4500)); rec.stop(); await new Promise((r) => (rec.onstop = r)); cancelAnimationFrame(raf); osc.stop(); await ac.close();
    const st = await import('/src/store.ts'); st.setUI({ playhead: 3 });
    const A = await import('/src/actions.ts'); await A.importOverlayFiles([new File(ch, 'plan-de-coupe.webm', { type: 'video/webm' })]);
  });
  await p.waitForFunction(() => (window.__forge.getState().project.overlays ?? []).length === 2, null, { timeout: 30000 });
  await p.getByRole('radio', { name: 'Moitié haute' }).click();
  const ovs = await p.evaluate(() => window.__forge.getState().project.overlays.map((o) => ({ kind: o.source.kind, place: o.place, track: o.track, start: o.start, d: +o.duration.toFixed(2) })));
  check(ovs[0].place !== 'full' && ovs[1].kind === 'video' && ovs[1].place === 'top' && ovs[1].start === 3, `case au placement conseillé pour sa forme, vidéo superposée à 3 s, placée en moitié haute depuis l’inspecteur (${JSON.stringify(ovs)})`);
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
    const panelOv = pr.overlays.find((o) => o.source.kind === 'panel'); const panelPlace = panelOv.place;
    for (const [name, t, place] of [['case', 1.6, panelPlace], ['vidéo', 4.2, 'top']]) {
      const box = name === 'case' ? O.overlayRect(pr, panelOv, t, W, H) : O.placeBox(place, W, H); const inner = { x: Math.round(box.x + box.w * 0.1), y: Math.round(box.y + box.h * 0.1), w: Math.round(box.w * 0.8), h: Math.round(box.h * 0.8) };
      const e = await frameAt(t), withOv = await refAt(t, true), without = await refAt(t, false);
      out[name] = { vsRendu: +diff(e, withOv, inner).toFixed(1), sansSuperposition: +diff(e, without, inner).toFixed(1) };
    }
    return { state: q.get(render.id).state, dur: +dur.toFixed(1), out };
  });
  check(r.state === 'done', 'export terminé');
  for (const [name, d] of Object.entries(r.out)) {
    check(d.vsRendu < 14 && d.sansSuperposition > 3 * d.vsRendu + 10, `${name} présente dans le MP4, identique à l’aperçu (écart ${d.vsRendu}/255, contre ${d.sansSuperposition} sans superposition)`);
  }

  // 3b. the picture-in-picture shows THAT panel: its mean colour matches the panel's on the page
  const col = await p.evaluate(async () => {
    const st = await import('/src/store.ts'); const R = await import('/src/engine/render.ts'); const O = await import('/src/engine/overlays.ts'); const M = await import('/src/engine/media.ts');
    const pr = st.getState().project; const o = pr.overlays.find((x) => x.source.kind === 'panel');
    const pg = pr.pages.find((x) => x.id === o.source.pageId); const a = M.getImage(pg.mediaId); const r = o.source.rect;
    const mean = (c, box) => { const d = c.getContext('2d').getImageData(box.x, box.y, box.w, box.h).data; const m = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) { m[0] += d[i]; m[1] += d[i + 1]; m[2] += d[i + 2]; } return m.map((x) => x / (d.length / 4)); };
    const src = new OffscreenCanvas(a.width, a.height); src.getContext('2d').drawImage(a.img, 0, 0);
    // the centre of the panel (cover-fit keeps the centre)
    const panel = mean(src, { x: Math.round(r.x + r.w * 0.35), y: Math.round(r.y + r.h * 0.35), w: Math.max(1, Math.round(r.w * 0.3)), h: Math.max(1, Math.round(r.h * 0.3)) });
    const W = 1080, H = 1920, c = new OffscreenCanvas(W, H); R.createRenderer(W, H).draw(c.getContext('2d'), pr, o.start + o.duration / 2);
    const b = O.overlayRect(pr, o, o.start + o.duration / 2, W, H);
    const pip = mean(c, { x: Math.round(b.x + b.w * 0.35), y: Math.round(b.y + b.h * 0.35), w: Math.round(b.w * 0.3), h: Math.round(b.h * 0.3) });
    return { panel: panel.map(Math.round), pip: pip.map(Math.round), d: Math.max(...panel.map((v, i) => Math.abs(v - pip[i]))) };
  });
  check(col.d < 40, `l’incrustation montre bien la case choisie (couleur ${col.pip} contre ${col.panel} sur la planche)`);

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
  // 5. drag the panel overlay in the preview: it becomes free and lands where it was dropped
  await p.evaluate(async () => { const st = await import('/src/store.ts'); const o = st.getState().project.overlays.find((x) => x.source.kind === 'panel'); st.setUI({ mode: 'preview', playhead: o.start + 0.5, selection: { kind: 'overlay', id: o.id } }); });
  const h = p.locator('.ov-handle'); await h.waitFor({ timeout: 10000 });
  const hb = await h.boundingBox();
  await p.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await p.mouse.down(); await p.mouse.move(hb.x + hb.width / 2 - 80, hb.y + hb.height / 2 + 120, { steps: 6 }); await p.mouse.up();
  const free = await p.evaluate(() => { const o = window.__forge.getState().project.overlays.find((x) => x.source.kind === 'panel'); return { place: o.place, box: o.box }; });
  check(free.place === 'free' && free.box && free.box.y > 0.1, `glissé dans l’aperçu : calque libre à l’endroit lâché (${JSON.stringify(free.box && Object.fromEntries(Object.entries(free.box).map(([k, v]) => [k, +v.toFixed(2)])))})`);
  // 6. pop entrance, the video's own sound kept in step, a light copy for a large overlay video
  const z2 = await p.evaluate(async () => {
    const st = await import('/src/store.ts'); const A = await import('/src/actions.ts'); const R = await import('/src/engine/render.ts');
    const pr = st.getState().project; const pan = pr.overlays.find((x) => x.source.kind === 'panel'); const vid = pr.overlays.find((x) => x.source.kind === 'video');
    A.patchOverlay(pan.id, { enter: 'pop', fade: 0.6 });
    const draw = (t, p2) => { const c = new OffscreenCanvas(270, 480); R.createRenderer(270, 480).draw(c.getContext('2d'), p2, t); return c.getContext('2d').getImageData(0, 0, 270, 480).data; };
    const cur = st.getState().project; const a = draw(pan.start + 0.15, cur), b = draw(pan.start + 0.15, { ...cur, overlays: cur.overlays.map((x) => (x.id === pan.id ? { ...x, enter: 'fade' } : x)) });
    // measured inside the overlay's zone only (the rest of the frame is the same)
    const O = await import('/src/engine/overlays.ts'); const zb = O.overlayBox(st.getState().project.overlays.find((x) => x.id === pan.id), pan.start + 0.15, 270, 480);
    let d = 0, n = 0; for (let y = Math.max(0, Math.floor(zb.y)); y < Math.min(480, zb.y + zb.h); y++) for (let x = Math.max(0, Math.floor(zb.x)); x < Math.min(270, zb.x + zb.w); x++) { const i = (y * 270 + x) * 4; d += Math.abs(a[i] - b[i]); n++; } d /= Math.max(1, n);
    A.setOverlaySound(vid.id, true);
    const clip0 = st.getState().project.audio.find((c) => c.id === st.getState().project.overlays.find((x) => x.id === vid.id).soundClip);
    A.patchOverlay(vid.id, { start: vid.start + 1 });
    const clip1 = st.getState().project.audio.find((c) => c.id === clip0?.id);
    st.setUI({ selection: { kind: 'overlay', id: vid.id } }); A.deleteSelection();
    const gone = !st.getState().project.audio.some((c) => c.id === clip0?.id);
    const K = await import('/src/production/kinds.ts'); const t = await K.proxyMedia(vid.source.mediaId, 1920, 1080);
    const q = globalThis.__forgeQueue; if (t) await q.idle([t.id]);
    const M = await import('/src/engine/media.ts');
    return { popDiff: +d.toFixed(1), clipKind: clip0?.kind, followed: clip1 && Math.abs(clip1.start - (vid.start + 1)) < 1e-6, gone, proxy: t ? q.get(t.id).state : 'déjà', hasProxy: M.hasProxy(vid.source.mediaId) };
  });
  check(z2.popDiff > 5, `entrée « Pop » différente du fondu pendant l’entrée (écart ${z2.popDiff})`);
  check(z2.clipKind === 'sfx' && z2.followed && z2.gone, 'son de la vidéo gardé sur la piste Bruitages, suit le calque, part avec lui');
  check(z2.proxy === 'done' && z2.hasProxy, `aperçu léger fait pour une vidéo en calque (${z2.proxy})`);
  check(errs.length === 0, `aucune erreur de page ${errs.slice(0, 2).join(' | ')}`);
  await b.close();
  console.log(fails.length ? `\n${fails.length} échec(s)` : '\nTout est bon');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
