// A complete production, end to end, against the dev server: from an empty project to the exported
// video, then the project closed, reopened in a fresh browser and checked.
//  1 project · 2 French script · 3 voice-over · 4 face-camera rush · 5 comic pages · 6 analysis
//  7 storyboard · 8 edit · 9 animation · 10 subtitles · 11 sound · 12 quality control · 13 export
//  14 close and reopen · 15 data and media integrity
// Material is synthetic (no network, no model download): the voices are speech-like bursts, so the
// script is laid on the pauses of the voice instead of a transcription.
//   node tests/e2e/production.e2e.cjs [port]
const { chromium } = require('playwright');
const { comicPages } = require('./fixtures.cjs');
const port = process.argv[2] || '5199';
const fails = []; const T0 = Date.now(); const times = {};
let last = T0;
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}  [${((Date.now() - T0) / 1000).toFixed(0)} s]`); if (!ok) fails.push(what); };
const step = (name) => { times[name] = +((Date.now() - last) / 1000).toFixed(1); last = Date.now(); };

const SCRIPT = [
  'Galactus arrive au-dessus de la Terre.',
  'Le Surfeur d’argent l’a guidé jusqu’ici.',
  'Les Quatre Fantastiques comprennent la menace.',
  'Red Richards cherche une arme capable de le repousser.',
  'Le Surfeur se retourne enfin contre son maître.',
].join(' ');

/** speech-like voice: one burst per sentence (syllable tremolo, varying pitch), a breath between them */
function voiceWav(sentences = 5, sr = 44100) {
  const parts = []; for (let i = 0; i < sentences; i++) parts.push([2.2 + (i % 2) * 0.4, 0.7]);
  const sec = parts.reduce((a, [v, g]) => a + v + g, 0.4);
  const n = Math.round(sec * sr), b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  let t0 = 0.2;
  for (const [v, g] of parts) {
    for (let i = Math.round(t0 * sr); i < Math.round((t0 + v) * sr); i++) {
      const t = i / sr - t0;
      const env = Math.min(1, t / 0.03, (v - t) / 0.03) * (0.55 + 0.45 * Math.abs(Math.sin(Math.PI * 4.5 * t)));
      const f = 140 + 30 * Math.sin(2 * Math.PI * 0.7 * t);
      b.writeInt16LE(Math.round(10000 * env * (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(2 * Math.PI * 2 * f * t) + 0.2 * Math.sin(2 * Math.PI * 3 * f * t)) / 1.6), 44 + i * 2);
    }
    t0 += v + g;
  }
  return { name: 'voix-off.wav', mimeType: 'audio/wav', buffer: b };
}

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const imgs = await comicPages(ctx, 4);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const idle = () => p.waitForFunction(() => { const q = globalThis.__forgeQueue; const pr = window.__forge.getState().project; return q.active(pr.id).length === 0; }, null, { timeout: 300000, polling: 250 });
  await p.goto(`http://localhost:${port}/`); await p.waitForFunction(() => !!globalThis.__forgeQueue, null, { timeout: 60000 });
  step('ouverture');

  /* 1. project, from the Projects window */
  await p.getByRole('button', { name: 'Projets' }).click();
  await p.locator('#pj-new-name').fill('Galactus — production complète');
  await p.getByRole('button', { name: 'Nouveau projet' }).last().click();
  await p.waitForFunction(() => window.__forge.getState().project.name === 'Galactus — production complète', null, { timeout: 30000 }).catch(() => {});
  await p.keyboard.press('Escape');
  const pid = await p.evaluate(() => window.__forge.getState().project.id);
  check(await p.evaluate(() => window.__forge.getState().project.name) === 'Galactus — production complète', '1. projet créé depuis la fenêtre Projets');
  step('projet');

  /* 2. French script */
  await p.evaluate((s) => import('/src/store.ts').then((st) => st.update((x) => ({ ...x, script: s }))), SCRIPT);
  await p.getByRole('tab', { name: /Script/ }).click();
  const scriptCheck = await p.locator('.studio-checks li').first().innerText();
  check(/Script/.test(scriptCheck) && /mots/.test(scriptCheck), `2. script français lu par le studio Script (${scriptCheck.replace(/\n/g, ' ')})`);
  await p.keyboard.press('Escape');

  /* 3. voice-over, through the « Voix off » tile and the file picker */
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.getByRole('button', { name: 'Voix off' }).click()]);
  await fc.setFiles(voiceWav());
  await p.waitForFunction(() => window.__forge.getState().project.audio.some((a) => a.kind === 'voice'), null, { timeout: 60000 });
  check(true, '3. voix off importée');

  /* 4. face-camera rush: recorded in the page (canvas + speech-like sound), then imported like a file */
  const rush = await p.evaluate(async () => {
    const W = 360, H = 640, c = Object.assign(document.createElement('canvas'), { width: W, height: H }); const g = c.getContext('2d');
    const ac = new AudioContext(); const dest = ac.createMediaStreamDestination();
    const osc = ac.createOscillator(); osc.frequency.value = 150; const amp = ac.createGain(); amp.gain.value = 0; osc.connect(amp).connect(dest); osc.start();
    const T = ac.currentTime + 0.3; let t = T;
    for (let i = 0; i < 5; i++) { const v = 1.8 + (i % 2) * 0.4; amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(0.5, t + 0.04); amp.gain.setValueAtTime(0.5, t + v - 0.04); amp.gain.linearRampToValueAtTime(0, t + v); t += v + 0.8; }
    const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' }); const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data);
    let raf = 0; const draw = () => { const k = performance.now() / 1000; g.fillStyle = '#2b3a4a'; g.fillRect(0, 0, W, H); g.fillStyle = '#e0b48c'; g.beginPath(); g.ellipse(W / 2 + 10 * Math.sin(k), H * 0.42, 90, 120, 0, 0, 7); g.fill(); raf = requestAnimationFrame(draw); }; draw();
    rec.start(250); await new Promise((r) => setTimeout(r, (t - ac.currentTime + 0.4) * 1000)); rec.stop(); await new Promise((r) => (rec.onstop = r)); cancelAnimationFrame(raf); osc.stop(); await ac.close();
    const file = new File(chunks, 'face-camera.webm', { type: 'video/webm' });
    const R = await import('/src/rush.ts'); await R.importRush(file);
    return { size: file.size };
  });
  await p.waitForFunction(() => !!window.__forge.getState().project.aroll, null, { timeout: 60000 });
  await idle();
  const ar = await p.evaluate(() => { const a = window.__forge.getState().project.aroll; return { dur: +a.duration.toFixed(1), pauses: a.pauses?.length ?? 0, cuts: a.cuts.length }; });
  check(ar.dur > 8 && ar.pauses >= 3, `4. rush face caméra importé et analysé (${(rush.size / 1e3).toFixed(0)} Ko, ${ar.dur} s, ${ar.pauses} respirations, ${ar.cuts} coupes proposées)`);
  step('script, voix, rush');

  /* 5-6. comic pages, read and cut by the production orchestrator */
  await p.locator('input[type=file][accept*="pdf"]').setInputFiles(imgs);
  await p.waitForFunction((n) => window.__forge.getState().project.pages.length === n, imgs.length, { timeout: 60000 });
  check(true, '5. planches importées');
  await p.waitForFunction(() => { const q = globalThis.__forgeQueue; const pr = window.__forge.getState().project; return pr.pages.every((pg) => pg.cut) && q.active(pr.id).length === 0; }, null, { timeout: 300000, polling: 250 });
  const cut = await p.evaluate(() => { const pr = window.__forge.getState().project; return { pages: pr.pages.length, cut: pr.pages.filter((pg) => pg.cut).length, panels: pr.shots.filter((s) => s.pageId).length }; });
  check(cut.cut === cut.pages && cut.panels >= cut.pages, `6. planches lues et découpées (${cut.cut}/${cut.pages} pages, ${cut.panels} cases)`);
  step('import et analyse des planches');

  /* 7. storyboard proposal, from the Visual studio */
  await p.getByRole('tab', { name: /Visuel/ }).click();
  await p.getByRole('region', { name: /Studio Visuel/ }).getByRole('button', { name: /Storyboard/ }).last().click();
  await p.getByRole('button', { name: /Préparer le storyboard/ }).click();
  await p.waitForSelector('.sb-row', { timeout: 180000 });
  await idle();
  const rows = await p.locator('.sb-row').count();
  check(rows === 5, `7. storyboard proposé : une ligne par phrase (${rows})`);
  await p.keyboard.press('Escape');
  step('storyboard');

  /* 8. the edit, following the storyboard */
  await p.getByRole('button', { name: /Montage auto/ }).first().click();
  await p.getByText('Suivre mon storyboard').waitFor({ timeout: 15000 });
  await p.locator('.modal').getByRole('button', { name: /Lancer le montage/ }).click();
  await p.waitForFunction(() => !document.querySelector('.modal .spin') && window.__forge.getState().project.shots.some((s) => s.auto), null, { timeout: 300000, polling: 500 });
  await p.waitForTimeout(800); await p.keyboard.press('Escape').catch(() => {}); await idle();
  const ed = await p.evaluate(async () => { const T = await import('/src/engine/timeline.ts'); const pr = window.__forge.getState().project; return { dur: +T.videoDuration(pr).toFixed(1), shots: pr.shots.length, moving: pr.shots.filter((s) => s.motion !== 'static').length, subs: pr.subtitles.length, why: pr.shots.filter((s) => s.why).length }; });
  check(ed.shots >= 3 && ed.dur > 8, `8. montage construit (${ed.shots} plans, ${ed.dur} s, ${ed.why} plans expliqués)`);
  /* 9. animation */
  check(ed.moving >= Math.ceil(ed.shots / 2), `9. mouvements de caméra sur les plans (${ed.moving}/${ed.shots})`);
  /* 10. subtitles from the script laid on the voice */
  const subs = await p.evaluate(() => { const pr = window.__forge.getState().project; return pr.subtitles.map((s) => s.text).join(' '); });
  check(ed.subs > 0 && /Galactus/.test(subs) && /Surfeur/.test(subs), `10. sous-titres synchronisés, texte exact du script (${ed.subs} lignes)`);
  step('montage, animation, sous-titres');

  /* 11. sound: clean voice, loudness target, music ducking */
  await p.evaluate(async () => { const st = await import('/src/store.ts'); st.update((x) => ({ ...x, mix: { ...x.mix, voiceClean: true, target: -14 }, ducking: true })); });
  const audioChecks = await p.evaluate(async () => { const S = await import('/src/lib/studios.ts'); return S.studioChecks(window.__forge.getState().project, 'audio').map((c) => `${c.label}:${c.state}`); });
  check(audioChecks.includes('Voix:ok') && audioChecks.includes('Niveau final:ok'), `11. son réglé (${audioChecks.join(', ')})`);

  /* 12. quality control: every proposed fix applied, nothing blocking left */
  const qc = await p.evaluate(async () => {
    const Q = await import('/src/engine/qc.ts'); const st = await import('/src/store.ts');
    const before = Q.checkProject(st.getState().project);
    for (const i of before) if (i.fix) st.update((x) => i.fix.apply(x));
    const after = Q.checkProject(st.getState().project);
    return { before: before.length, fixed: before.filter((i) => i.fix).length, errors: after.filter((i) => i.level === 'error').map((i) => i.text) };
  });
  check(qc.errors.length === 0, `12. contrôle qualité : ${qc.before} remarque(s), ${qc.fixed} corrigée(s), aucune erreur restante ${qc.errors.join(' | ')}`);
  step('son et contrôle qualité');

  /* 13. export: render, read the file back, publication kit */
  const r = await p.evaluate(async () => {
    const K = await import('/src/production/kinds.ts'); const q = globalThis.__forgeQueue;
    const t0 = performance.now();
    const { render, kit } = await K.deliver({ name: 'galactus-9x16.mp4', quality: 'high', fps: 30, burn: true, platforms: ['tiktok', 'shorts', 'reels'] });
    await q.idle([render.id, kit.id]);
    const R = q.get(render.id);
    return { state: R.state, err: R.error?.message, report: R.result?.report, kit: q.get(kit.id).state, sec: (performance.now() - t0) / 1000 };
  });
  const rep = r.report || {};
  check(r.state === 'done' && rep.width === 1080 && rep.height === 1920, `13. vidéo exportée et relue : ${rep.width}×${rep.height}, ${rep.duration?.toFixed(1)} s ${r.err ?? ''}`);
  check(rep.lufs != null && Math.abs(rep.lufs + 14) < 1.5 && rep.clipped === 0, `13. son du fichier : ${rep.lufs?.toFixed(1)} LUFS, ${rep.clipped} échantillon saturé`);
  check(r.kit === 'done', '13. kit de publication prêt (rien n’est publié)');
  times.rendu = +r.sec.toFixed(1);
  times['rendu / durée vidéo'] = rep.duration ? +(r.sec / rep.duration).toFixed(2) : null;
  step('export');

  /* 13b. the undo history survives a reload of the page */
  const undoBefore = await p.evaluate(async () => { const S = await import('/src/lib/studio.ts'); await S.saveNow(); return window.__forge.getState().past.length; });
  await p.reload(); await p.waitForFunction(() => !!globalThis.__forgeQueue, null, { timeout: 60000 });
  await p.waitForFunction(() => window.__forge.getState().past.length > 0, null, { timeout: 20000 }).catch(() => {});
  const undoAfter = await p.evaluate(() => window.__forge.getState().past.length);
  check(undoBefore > 0 && undoAfter > 0, `Ctrl+Z après rechargement de la page (${undoAfter} étapes gardées sur ${undoBefore})`);

  /* 14. close and reopen: the .forge file, opened in another browser (empty storage) */
  const before = await p.evaluate(async () => {
    const S = await import('/src/lib/studio.ts'); await S.takeVersion('Avant export du projet');
    const { blob, versions } = await S.exportForge();
    const pr = window.__forge.getState().project;
    const sum = { id: pr.id, name: pr.name, shots: pr.shots.map((s) => [s.id, s.pageId, s.duration, s.motion]), subs: pr.subtitles.map((s) => s.text), audio: pr.audio.map((a) => a.mediaId), aroll: pr.aroll?.mediaId, pages: pr.pages.map((pg) => pg.mediaId), schema: pr.schemaVersion };
    return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), versions, sum };
  });
  await ctx.close();
  const ctx2 = await b.newContext(); const p2 = await ctx2.newPage(); p2.on('pageerror', (e) => errs.push(e.message));
  await p2.goto(`http://localhost:${port}/`); await p2.waitForFunction(() => !!globalThis.__forgeQueue, null, { timeout: 60000 });
  const after = await p2.evaluate(async (bytes) => {
    const S = await import('/src/lib/studio.ts'); const M = await import('/src/engine/media.ts');
    const t0 = performance.now();
    const res = await S.importForge(new File([Uint8Array.from(bytes)], 'galactus.forge'));
    const ms = performance.now() - t0;
    const pr = window.__forge.getState().project;
    const sum = { id: pr.id, name: pr.name, shots: pr.shots.map((s) => [s.id, s.pageId, s.duration, s.motion]), subs: pr.subtitles.map((s) => s.text), audio: pr.audio.map((a) => a.mediaId), aroll: pr.aroll?.mediaId, pages: pr.pages.map((pg) => pg.mediaId), schema: pr.schemaVersion };
    const ids = [...sum.pages, ...sum.audio, sum.aroll].filter(Boolean);
    const blobs = await Promise.all(ids.map((id) => M.mediaBlob(id)));
    const decoded = { pages: sum.pages.every((id) => !!M.getImage(id)), video: !!M.getVideo(sum.aroll) };
    const versions = (await S.listVersions(pr.id)).map((v) => v.label);
    const undoSteps = window.__forge.getState().past.length;
    const disk = await S.diskUsage();
    return { sum, missing: ids.filter((_, i) => !blobs[i]).length, decoded, versions, unused: disk?.unused.length, manifest: res.manifest, ms, undoSteps };
  }, before.bytes);
  times['réouverture .forge'] = +(after.ms / 1000).toFixed(1);
  check(after.sum.id === pid && JSON.stringify(after.sum) === JSON.stringify(before.sum), `14. projet rouvert dans un autre navigateur, identique (${(before.bytes.length / 1e6).toFixed(1)} Mo)`);
  /* 15. integrity */
  check(after.missing === 0 && after.decoded.pages && after.decoded.video, `15. tous les médias présents et lisibles (planches, voix, rush) ${JSON.stringify({ manquants: after.missing, ...after.decoded })}`);
  check(after.versions.includes('Avant export du projet') && after.manifest?.versions === before.versions, `15. versions rapportées avec le projet (${after.versions.join(", ")} ; manifeste ${after.manifest?.versions}, envoyées ${before.versions})`);
  check(after.unused === 0 && after.manifest?.missing.length === 0, `15. aucun média manquant ni orphelin (${after.unused} inutilisé, ${after.manifest?.missing.length} manquant)`);
  check(after.undoSteps > 0, `Ctrl+Z possible dans le projet rouvert ailleurs (${after.undoSteps} étapes dans le .forge)`);
  check(errs.length === 0, `aucune erreur de page ${errs.slice(0, 2).join(' | ')}`);
  console.log('\nTemps par étape (s) :', JSON.stringify(times));
  await b.close();
  console.log(fails.length ? `\n${fails.length} échec(s)` : '\nTout est bon');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
