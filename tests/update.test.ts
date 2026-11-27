import { describe, expect, it } from 'vitest';
import { isChunkLoadError, chunkOf, decide } from '../src/lib/staleVersion';

describe('nouvelle version de Forge pendant qu’un onglet est ouvert', () => {
  it('reconnaît les erreurs de chargement de module des navigateurs', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/forge-studio/assets/AiCenter-CT8MIwNp.js'))).toBe(true); // Chrome, Edge
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true); // Safari
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/a.js'))).toBe(true); // Firefox
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
  });
  it('nomme le fichier manquant', () => {
    expect(chunkOf(new TypeError('Failed to fetch dynamically imported module: https://lukecage2003.github.io/forge-studio/assets/AssistantModal-B977wpPD.js'))).toBe('AssistantModal-B977wpPD.js');
  });
  it('propose un rechargement, puis, si un rechargement vient d’avoir lieu, ne le repropose pas (pas de boucle)', () => {
    const now = 1_000_000;
    expect(decide('AiCenter-A.js', null, now).afterReload).toBe(false);
    // just reloaded for the old file; the new version misses another file: no second reload
    expect(decide('AiCenter-B.js', { at: now - 20_000, file: 'AiCenter-A.js' }, now).afterReload).toBe(true);
    // long after: a new publication is a new situation, reloading is proposed again
    expect(decide('AiCenter-C.js', { at: now - 10 * 60_000, file: 'AiCenter-B.js' }, now).afterReload).toBe(false);
  });
});

describe('fichiers gardés des publications précédentes', () => {
  it('garde les anciens fichiers 30 jours, jamais au détriment de la version actuelle', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path'); const { execFileSync } = await import('node:child_process');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keep-'));
    const mk = (d: string, files: Record<string, string>) => { fs.mkdirSync(path.join(dir, d, 'assets'), { recursive: true }); for (const [f, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, d, 'assets', f), c); };
    mk('prev', { 'AiCenter-old.js': 'ancien', 'vieux-old.js': 'très ancien', 'shared-x.js': 'ANCIEN CONTENU' });
    const day = 86400_000, now = Date.now();
    fs.writeFileSync(path.join(dir, 'prev', 'assets-ages.json'), JSON.stringify({ 'AiCenter-old.js': now - 2 * day, 'vieux-old.js': now - 40 * day, 'shared-x.js': now - 5 * day }));
    mk('new', { 'AiCenter-new.js': 'nouveau', 'shared-x.js': 'contenu actuel' });
    execFileSync(process.execPath, ['scripts/keep-old-assets.mjs', path.join(dir, 'new'), path.join(dir, 'prev'), '30']);
    const files = fs.readdirSync(path.join(dir, 'new', 'assets')).sort();
    expect(files).toEqual(['AiCenter-new.js', 'AiCenter-old.js', 'shared-x.js']);
    expect(fs.readFileSync(path.join(dir, 'new', 'assets', 'shared-x.js'), 'utf8')).toBe('contenu actuel');
    const ages = JSON.parse(fs.readFileSync(path.join(dir, 'new', 'assets-ages.json'), 'utf8'));
    expect(ages['AiCenter-old.js']).toBe(now - 2 * day);
    expect(ages['shared-x.js']).toBe(now - 5 * day);
  });
});
