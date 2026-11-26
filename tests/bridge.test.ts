import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-'));
const PORT = 17878, UP_PORT = 17879;
const ORIGIN = 'https://lukecage2003.github.io';
const env = { ...process.env, FORGE_BRIDGE_HOME: HOME, FORGE_BRIDGE_PORT: String(PORT), FORGE_BRIDGE_NO_KEYRING: '1', FORGE_BRIDGE_UP_NVIDIA: `http://127.0.0.1:${UP_PORT}`, FORGE_BRIDGE_UP_CLOUDFLARE: `http://127.0.0.1:${UP_PORT}/acct/{account}/ai` };
const script = path.resolve('bridge/forge-bridge.mjs');
let bridge: ChildProcess, upstream: http.Server, token = '';
const seen: { url?: string; auth?: string }[] = [];

beforeAll(async () => {
  upstream = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    if (req.url?.includes('fail')) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: { message: `bad key ${req.headers.authorization?.slice(7)}` } })); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
  }).listen(UP_PORT);
  spawnSync('node', [script, 'set-key', 'nvidia'], { env: { ...env, FORGE_BRIDGE_KEY: 'nvapi-TEST-SECRET-123456789' } });
  spawnSync('node', [script, 'set-key', 'cloudflare'], { env: { ...env, FORGE_BRIDGE_KEY: 'cf-TEST-SECRET-123456789' } });
  spawnSync('node', [script, 'set-account', 'cloudflare', 'acc42'], { env });
  bridge = spawn('node', [script], { env });
  await new Promise<void>((r) => bridge.stdout!.on('data', (d) => { const m = String(d).match(/appairage[^:]*: ([0-9a-f]+)/); if (m) { token = m[1]; r(); } }));
});
afterAll(() => { bridge?.kill(); upstream?.close(); fs.rmSync(HOME, { recursive: true, force: true }); });

const req = (p: string, o: RequestInit & { origin?: string } = {}) => fetch(`http://127.0.0.1:${PORT}${p}`, { ...o, headers: { origin: o.origin ?? ORIGIN, ...(o.headers ?? {}) } });

describe('Forge Bridge', () => {
  it('les clés ne sont jamais écrites en clair sur le disque', () => {
    const all = fs.readdirSync(HOME).map((f) => fs.readFileSync(path.join(HOME, f), 'utf8')).join('\n');
    expect(all).not.toContain('TEST-SECRET');
  });
  it('santé : dit quelles clés existent, sans les montrer', async () => {
    const r = await (await req('/health')).json();
    expect(r).toMatchObject({ ok: true, vault: 'file', services: { nvidia: true, cloudflare: true } });
    expect(JSON.stringify(r)).not.toContain('SECRET');
  });
  it('refuse un autre site et un appel sans code d’appairage', async () => {
    expect((await req('/proxy/nvidia/v1/models', { origin: 'https://evil.example', headers: { 'x-forge-token': token } })).status).toBe(403);
    expect((await req('/proxy/nvidia/v1/models')).status).toBe(401);
  });
  it('relaie NVIDIA en ajoutant la clé, et Cloudflare sur le bon compte', async () => {
    const r = await req('/proxy/nvidia/v1/chat/completions', { method: 'POST', headers: { 'x-forge-token': token, 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN);
    expect(seen.at(-1)).toEqual({ url: '/v1/chat/completions', auth: 'Bearer nvapi-TEST-SECRET-123456789' });
    await req('/proxy/cloudflare/v1/chat/completions', { method: 'POST', headers: { 'x-forge-token': token }, body: '{}' });
    expect(seen.at(-1)).toEqual({ url: '/acct/acc42/ai/v1/chat/completions', auth: 'Bearer cf-TEST-SECRET-123456789' });
  });
  it('une erreur du service ne laisse jamais passer la clé', async () => {
    const r = await req('/proxy/nvidia/v1/fail', { headers: { 'x-forge-token': token } });
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain('SECRET');
  });
});
