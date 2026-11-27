// Keep the files of the previous publications for a while.
// A tab opened before a publication (or an index.html still in a cache: GitHub Pages
// serves it for 10 minutes) asks for the files of ITS version; they must still be there.
//   node scripts/keep-old-assets.mjs <new dist> <previous site> [days=30]
// Hashed file names never collide: an old file can't replace a new one.
// assets-ages.json records when each file was first published; files of the
// current build are never removed, older ones go after <days>.
import fs from 'node:fs';
import path from 'node:path';

const [dist, prev, days = '30'] = process.argv.slice(2);
const maxAge = Number(days) * 86400_000;
const now = Date.now();
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
const ages = read(path.join(prev ?? '', 'assets-ages.json'));
const out = {};
const cur = new Set(fs.readdirSync(path.join(dist, 'assets')));
for (const f of cur) out[f] = ages[f] ?? now;
let kept = 0, dropped = 0;
const old = prev && fs.existsSync(path.join(prev, 'assets')) ? fs.readdirSync(path.join(prev, 'assets')) : [];
for (const f of old) {
  if (cur.has(f)) continue;
  const born = ages[f] ?? now; // a file published before this script existed: counted from today
  if (now - born > maxAge) { dropped++; continue; }
  fs.copyFileSync(path.join(prev, 'assets', f), path.join(dist, 'assets', f));
  out[f] = born; kept++;
}
fs.writeFileSync(path.join(dist, 'assets-ages.json'), JSON.stringify(out, null, 0));
console.log(`Fichiers des versions précédentes : ${kept} gardés, ${dropped} retirés (plus de ${days} jours) · version actuelle : ${cur.size} fichiers`);
