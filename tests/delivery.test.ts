import { describe, expect, it } from 'vitest';
import { blackRuns, checkDelivery, clippedSamples, meanLuma, truePeakDb, PLATFORMS, type FileReport } from '../src/engine/delivery';
import { buildPost, seriesOf, hookOf } from '../src/engine/publish';
import { newProject } from '../src/store';

const good: FileReport = { width: 1080, height: 1920, fps: 30, duration: 45, sizeMB: 40, mbps: 7, videoCodec: 'avc1.640028', audioCodec: 'mp4a.40.2', sampleRate: 48000, black: [], lufs: -14.2, truePeakDb: -1.6, clipped: 0, silentStart: 0.1 };

describe('livraison : contrôle du fichier', () => {
  it('trouve les passages noirs d’au moins 0,4 s, pas les images isolées', () => {
    const s = [0, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4].map((t) => ({ t, luma: t >= 0.4 && t < 1.0 ? 0.01 : t === 1.2 ? 0.02 : 0.5 }));
    expect(blackRuns(s, 0.2)).toEqual([{ s: 0.4, e: 1.0 }]);
  });
  it('mesure la luminosité moyenne', () => {
    expect(meanLuma(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]))).toBeCloseTo(0.5, 3);
  });
  it('la crête vraie voit le dépassement entre deux échantillons ; la saturation est comptée', () => {
    // a sine at a quarter of the sample rate, phase 45°: samples at 0.707, real peak at 1.0
    const c = Float32Array.from({ length: 4000 }, (_, i) => Math.sin(Math.PI / 2 * i + Math.PI / 4));
    const samplePeak = 20 * Math.log10(Math.max(...Array.from(c, Math.abs)));
    expect(samplePeak).toBeCloseTo(-3, 0);
    expect(truePeakDb([c])).toBeGreaterThan(-1);
    expect(clippedSamples([Float32Array.from([0.2, 1, -1, 0.9999, 0.5])])).toBe(3);
  });
  it('un fichier conforme passe ; chaque défaut est nommé', () => {
    expect(checkDelivery(good, PLATFORMS.tiktok)).toEqual([{ level: 'ok', text: 'Conforme pour TikTok.' }]);
    const bad = checkDelivery({ ...good, width: 1920, height: 1080, duration: 240, audioCodec: 'opus', black: [{ s: 3, e: 4 }], truePeakDb: 0.4, clipped: 12 }, PLATFORMS.shorts);
    const t = bad.map((x) => x.text).join(' | ');
    expect(t).toMatch(/1080×1920/); expect(t).toMatch(/durée maximale/); expect(t).toMatch(/AAC/); expect(t).toMatch(/noir/); expect(t).toMatch(/dBTP/); expect(t).toMatch(/saturés/);
  });
  it('sous-titres sous l’interface de la plateforme : bloquant', () => {
    const p = { ...newProject(), subtitles: [{ s: 0, e: 1, text: 'x', words: [] }] };
    p.subtitleStyle = { ...p.subtitleStyle, y: 0.9 };
    expect(checkDelivery(good, PLATFORMS.reels, p).some((x) => x.level === 'error' && /interface/.test(x.text))).toBe(true);
    p.subtitleStyle = { ...p.subtitleStyle, y: 0.7 };
    expect(checkDelivery(good, PLATFORMS.reels, p)[0].level).toBe('ok');
  });
});

describe('kit de publication', () => {
  const p = { ...newProject(), name: 'Galactus contre les Ultimates', script: 'Dans l’espace, une machine géante hurle un seul mot. Black Panther réunit une équipe.', pages: [{ source: 'The Ultimates (2015) 001.pdf' }, { source: 'The Ultimates (2015) 001.pdf' }] as never };
  it('lit la série dans le nom des fichiers et l’accroche dans le script', () => {
    expect(seriesOf(p)).toEqual(['The Ultimates']);
    expect(hookOf(p)).toBe('Dans l’espace, une machine géante hurle un seul mot.');
  });
  it('propose titre, description et hashtags sans inventer, dans la limite de la plateforme', () => {
    const post = buildPost(p, 'shorts');
    expect(post.title).toBe('Galactus contre les Ultimates');
    expect(post.description).toContain('Dans l’espace');
    expect(post.hashtags.length).toBeLessThanOrEqual(3);
    expect(post.hashtags).toContain('#TheUltimates');
    expect(post.sources.join(' ')).toMatch(/nom des fichiers/);
  });
});
