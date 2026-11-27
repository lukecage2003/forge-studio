// Every file the build refers to must exist: entry of index.html, the files listed in the
// manifest with their static and dynamic imports, and every "./X-hash.js" a script imports.
//   node scripts/check-build.mjs dist                       (local build)
//   node scripts/check-build.mjs https://host/forge-studio/  (published site; also checks the kept older files)
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2] ?? 'dist';
const remote = /^https?:/.test(target);
const base = remote ? target.replace(/\/?$/, '/') : target;
const get = async (rel) => {
  if (remote) { const r = await fetch(base + rel, { cache: 'no-store' }); return r.ok ? (/\.(js|html|json|css)$/.test(rel) ? await r.text() : 'ok') : null; }
  const f = path.join(base, rel); return fs.existsSync(f) ? (/\.(js|html|json|css)$/.test(rel) ? fs.readFileSync(f, 'utf8') : 'ok') : null;
};
const problems = [];
const seen = new Set();
// files a script loads: Vite writes them as "./Name-hash.js" (same folder) or "assets/Name-hash.js"
const refsIn = (code) => [...new Set([...code.matchAll(/["'`](?:\.\/|assets\/)([\w.-]+-[\w-]{6,}\.(?:js|css))["'`]/g)].map((m) => 'assets/' + m[1]))];
async function walk(rel, from) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const body = await get(rel);
  if (body == null) { problems.push(`${rel} manquant (demandé par ${from})`); return; }
  if (rel.endsWith('.js')) for (const r of refsIn(body)) await walk(r, rel);
}
const html = await get('index.html');
if (!html) { console.error('index.html introuvable'); process.exit(1); }
if (/(src|href)="\/assets\//.test(html)) problems.push('index.html utilise des chemins absolus « /assets/… » : cassé sous /forge-studio/');
for (const m of html.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g)) await walk(m[1], 'index.html');
const manifest = await get('.vite/manifest.json');
if (manifest) {
  const man = JSON.parse(manifest);
  for (const [src, e] of Object.entries(man)) {
    await walk(e.file, `manifeste (${src})`);
    for (const c of e.css ?? []) await walk(c, `manifeste (${src})`);
    for (const d of e.dynamicImports ?? []) if (!man[d]) problems.push(`import dynamique ${d} absent du manifeste (${src})`);
  }
} else if (!remote) problems.push('.vite/manifest.json absent : build.manifest doit rester activé');
const version = await get('version.json');
if (!version) problems.push('version.json absent');
// older files kept for open tabs: they must be reachable too
const ages = await get('assets-ages.json');
let kept = 0;
if (ages) for (const f of Object.keys(JSON.parse(ages))) { if (seen.has('assets/' + f)) continue; kept++; if (!(await get('assets/' + f))) problems.push(`assets/${f} listé dans assets-ages.json mais absent`); }
console.log(`${remote ? 'Site publié' : 'Build'} ${target} : ${seen.size} fichiers vérifiés depuis index.html et le manifeste${ages ? `, ${kept} fichiers de versions précédentes` : ''}${version ? `, version ${JSON.parse(version).build}` : ''}`);
if (problems.length) { console.error(problems.map((p) => '✗ ' + p).join('\n')); process.exit(1); }
console.log('✓ Toutes les références sont présentes');
