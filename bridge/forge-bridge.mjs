#!/usr/bin/env node
/**
 * Forge Bridge — optional local helper (Windows, Linux, macOS; Node 20+).
 *
 *  - keeps API keys out of the browser: in the system vault when the optional
 *    package @napi-rs/keyring is installed (Windows Credential Manager, Secret
 *    Service on Linux), else in an AES-256-GCM encrypted file in your home folder
 *  - relays the services the browser may not call itself: Cloudflare Workers AI,
 *    NVIDIA NIM, and a local whisper.cpp server
 *  - answers only Forge: allowed origins + a pairing code printed at start
 *
 *  node forge-bridge.mjs                     start (prints the pairing code)
 *  node forge-bridge.mjs set-key <service>   store a key (typed, not echoed)
 *  node forge-bridge.mjs set-account cloudflare <account id>
 *  node forge-bridge.mjs remove-key <service>
 *  node forge-bridge.mjs list
 *  services: cloudflare, nvidia
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';

const HOME = process.env.FORGE_BRIDGE_HOME || path.join(os.homedir(), '.forge-bridge');
const PORT = Number(process.env.FORGE_BRIDGE_PORT || 7878);
const ORIGINS = (process.env.FORGE_BRIDGE_ORIGINS || 'https://lukecage2003.github.io,http://localhost:5173,http://localhost:4173').split(',');
const UP = {
  cloudflare: process.env.FORGE_BRIDGE_UP_CLOUDFLARE || 'https://api.cloudflare.com/client/v4/accounts/{account}/ai',
  nvidia: process.env.FORGE_BRIDGE_UP_NVIDIA || 'https://integrate.api.nvidia.com',
  whispercpp: process.env.FORGE_BRIDGE_UP_WHISPERCPP || 'http://127.0.0.1:8080',
};
const SERVICES = ['cloudflare', 'nvidia'];
fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });

/* ----------------------------------------------------------- key store */
let keyring = null;
if (!process.env.FORGE_BRIDGE_NO_KEYRING) { try { keyring = await import('@napi-rs/keyring'); } catch { keyring = null; } }
const vaultKind = keyring ? 'system' : 'file';
const secretFile = path.join(HOME, 'secret.bin'), keysFile = path.join(HOME, 'keys.json'), confFile = path.join(HOME, 'config.json');
function fileKey() {
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32), { mode: 0o600 });
  return fs.readFileSync(secretFile);
}
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 1), { mode: 0o600 });
function setKey(svc, value) {
  if (keyring) { new keyring.Entry('forge-bridge', svc).setPassword(value); return; }
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', fileKey(), iv);
  const data = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  const all = readJson(keysFile, {});
  all[svc] = { iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
  writeJson(keysFile, all);
}
function getKey(svc) {
  if (keyring) { try { return new keyring.Entry('forge-bridge', svc).getPassword() || null; } catch { return null; } }
  const box = readJson(keysFile, {})[svc];
  if (!box) return null;
  const d = crypto.createDecipheriv('aes-256-gcm', fileKey(), Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8');
}
function removeKey(svc) {
  if (keyring) { try { new keyring.Entry('forge-bridge', svc).deletePassword(); } catch { /* none */ } return; }
  const all = readJson(keysFile, {}); delete all[svc]; writeJson(keysFile, all);
}
const conf = () => readJson(confFile, {});
const mask = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');

/* ----------------------------------------------------------- CLI */
const [cmd, a1, a2] = process.argv.slice(2);
async function hidden(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.startsWith(q)) rl.output.write(q); };
  return new Promise((r) => rl.question(q, (v) => { rl.close(); process.stdout.write('\n'); r(v.trim()); }));
}
if (cmd === 'set-key') {
  if (!SERVICES.includes(a1)) { console.error(`Service inconnu. Choix : ${SERVICES.join(', ')}`); process.exit(1); }
  const v = process.env.FORGE_BRIDGE_KEY ?? (await hidden(`Clé ${a1} (non affichée) : `));
  if (!v) { console.error('Clé vide.'); process.exit(1); }
  setKey(a1, v); console.log(`Clé ${a1} enregistrée (${vaultKind === 'system' ? 'coffre du système' : 'fichier chiffré'}) : ${mask(v)}`); process.exit(0);
}
if (cmd === 'set-account') { const c = conf(); c[a1 + 'Account'] = a2; writeJson(confFile, c); console.log(`Compte ${a1} : ${a2}`); process.exit(0); }
if (cmd === 'remove-key') { removeKey(a1); console.log(`Clé ${a1} supprimée.`); process.exit(0); }
if (cmd === 'list') { for (const s of SERVICES) console.log(`${s} : ${getKey(s) ? mask(getKey(s)) : '—'}`); console.log(`Coffre : ${vaultKind === 'system' ? 'système' : 'fichier chiffré ' + keysFile}`); process.exit(0); }

/* ----------------------------------------------------------- server */
const tokenFile = path.join(HOME, 'token');
if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(12).toString('hex'), { mode: 0o600 });
const TOKEN = fs.readFileSync(tokenFile, 'utf8').trim();
let inflight = 0;

function cors(req, res) {
  const o = req.headers.origin;
  if (o && ORIGINS.includes(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-forge-token, x-title');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  return !o || ORIGINS.includes(o);
}
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const scrub = (t) => { let s = String(t); for (const v of SERVICES) { const k = getKey(v); if (k && k.length >= 8) s = s.split(k).join('••••'); } return s; };

const server = http.createServer(async (req, res) => {
  const okOrigin = cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(okOrigin ? 204 : 403); return res.end(); }
  if (!okOrigin) return send(res, 403, { error: { message: 'Origine non autorisée.' } });
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return send(res, 200, { ok: true, vault: vaultKind, services: Object.fromEntries(SERVICES.map((s) => [s, !!getKey(s)])) });
  if (req.headers['x-forge-token'] !== TOKEN) return send(res, 401, { error: { message: 'Code d’appairage Forge Bridge manquant ou faux.' } });
  const m = url.pathname.match(/^\/proxy\/(cloudflare|nvidia|whispercpp)(\/.*)$/);
  if (!m) return send(res, 404, { error: { message: 'Route inconnue.' } });
  const [, svc, rest] = m;
  let base = UP[svc];
  const headers = {};
  if (svc !== 'whispercpp') {
    const key = getKey(svc);
    if (!key) return send(res, 401, { error: { message: `Aucune clé ${svc} dans Forge Bridge : node forge-bridge.mjs set-key ${svc}` } });
    headers.authorization = `Bearer ${key}`;
    if (svc === 'cloudflare') {
      const acct = conf().cloudflareAccount;
      if (!acct) return send(res, 400, { error: { message: 'Compte Cloudflare manquant : node forge-bridge.mjs set-account cloudflare <id>' } });
      base = base.replace('{account}', encodeURIComponent(acct));
    }
  }
  if (inflight >= 4) return send(res, 429, { error: { message: 'Forge Bridge : trop de requêtes simultanées.' } });
  inflight++;
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
    const up = await fetch(base + rest + url.search, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const body = Buffer.from(await up.arrayBuffer());
    const out = { 'content-type': up.headers.get('content-type') || 'application/json' };
    const ra = up.headers.get('retry-after'); if (ra) out['retry-after'] = ra;
    res.writeHead(up.status, out);
    res.end(up.ok ? body : scrub(body.toString('utf8')));
  } catch (e) {
    send(res, 502, { error: { message: `Service ${svc} injoignable depuis Forge Bridge.` } });
  } finally { inflight--; }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Forge Bridge prêt sur http://127.0.0.1:${PORT}`);
  console.log(`Code d’appairage à coller dans Forge (centre de contrôle IA) : ${TOKEN}`);
  console.log(`Coffre des clés : ${vaultKind === 'system' ? 'coffre du système' : 'fichier chiffré (installe @napi-rs/keyring pour le coffre du système)'}`);
});
