// Test material made on the fly (no copyrighted content): comic pages drawn on a canvas, a tone as music.
async function comicPages(ctx, n, opts = {}) {
  const art = await ctx.newPage();
  const out = [];
  for (let i = 0; i < n; i++) {
    // each page draws in its own scope: setContent keeps the same window, a second « const » would fail
    await art.setContent(`<canvas id=c width=900 height=1350></canvas><script>(() => {
      const x=c.getContext('2d');x.fillStyle='#f4efe4';x.fillRect(0,0,900,1350);x.lineWidth=9;x.strokeStyle='#111';
      // a different panel layout on every page (classic grid, wide band, tall column…)
      const L=[[[40,40,400,600],[470,40,390,600],[40,690,820,620]],[[40,40,820,380],[40,450,400,860],[470,450,390,860]],[[40,40,260,1270],[330,40,530,620],[330,690,530,620]],[[40,40,820,1270]]];
      const P=L[${i}%L.length];
      P.forEach(([a,b,w,h],k)=>{x.fillStyle=['#d9532b','#2f62c9','#3a9a5b','#a63fb5'][(k+${i})%4];x.fillRect(a,b,w,h);x.strokeRect(a,b,w,h);
        x.fillStyle='#fff';x.beginPath();x.ellipse(a+w*0.35,b+90,120,55,0,0,7);x.fill();x.stroke();
        x.fillStyle='#111';x.font='bold 26px sans-serif';x.fillText('PAGE ${i + 1}!',a+w*0.35-75,b+100);});
      // a darker scan: the whole page, balloons included, as a scanner set too dark would make it
      if (${(opts.dark ?? []).includes(i)}) { x.globalCompositeOperation='multiply'; x.fillStyle='#a6a6a6'; x.fillRect(0,0,900,1350); }
    })();</script>`);
    out.push({ name: `page-${String(i + 1).padStart(2, '0')}.png`, mimeType: 'image/png', buffer: await art.locator('#c').screenshot() });
  }
  await art.close();
  return out;
}
/** 16-bit mono WAV: a 220 Hz tone with a slow tremolo, `sec` seconds */
function toneWav(sec = 12, sr = 44100) {
  const n = sec * sr, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(9000 * Math.sin(2 * Math.PI * 220 * i / sr) * (0.7 + 0.3 * Math.sin(2 * Math.PI * 0.5 * i / sr))), 44 + i * 2);
  return { name: 'musique.wav', mimeType: 'audio/wav', buffer: b };
}
module.exports = { comicPages, toneWav };
