import { describe, expect, it } from 'vitest';
import { analyse, proposeCuts, defaultRoughCut, keepSegments, segsDuration, SR } from '../src/engine/speech';
import { comicNames, correctNames } from '../src/engine/lexicon';
import { validateProject } from '../src/engine/validate';
import { scriptSentences } from '../src/engine/narration';
import { matchLocal } from '../src/engine/understand';
import { emphasisAt } from '../src/engine/emphasis';
import type { Project } from '../src/types';

/* ---------- synthetic voice: syllables, silences, a held "euuuh" ---------- */
function speechLike() {
  const parts: Float32Array[] = [];
  const noise = (sec: number) => Float32Array.from({ length: sec * SR }, () => (Math.random() - 0.5) * 0.002);
  // syllables: 5 Hz amplitude modulation with consonant dips (like real words)
  const words = (sec: number) => Float32Array.from({ length: sec * SR }, (_, i) => {
    const t = i / SR, env = Math.max(0, Math.sin(Math.PI * 5 * t)) ** 2;
    return env * 0.3 * Math.sin(2 * Math.PI * 180 * t) + env * 0.05 * (Math.random() - 0.5);
  });
  // steady vowel: constant level, no dips
  const vowel = (sec: number) => Float32Array.from({ length: sec * SR }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 140 * (i / SR)));
  parts.push(noise(0.8), words(2.4), noise(1.2), vowel(0.8), noise(0.4), words(2), noise(1.5));
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe('dérushage', () => {
  const a = analyse(speechLike());
  const cuts = proposeCuts(a, [], defaultRoughCut());
  it('coupe le silence de tête, les pauses et la fin', () => {
    const sil = cuts.filter((c) => c.reason === 'silence' && c.on);
    expect(sil.some((c) => c.s < 0.2)).toBe(true); // head
    expect(sil.some((c) => c.s > 3.0 && c.e < 4.5)).toBe(true); // 1.2 s pause
    expect(sil.some((c) => c.e > a.duration - 0.1)).toBe(true); // tail
  });
  it('repère le son tenu comme hésitation, pas les mots', () => {
    const h = cuts.filter((c) => c.reason === 'hesitation');
    expect(h.length).toBe(1);
    expect(h[0].s).toBeGreaterThan(4.3);
    expect(h[0].e).toBeLessThan(5.4);
  });
  it('garde la parole', () => {
    const kept = segsDuration(keepSegments({ cuts, duration: a.duration } as never));
    expect(kept).toBeGreaterThan(3.8);
    expect(kept).toBeLessThan(5.2);
  });
  it('coupe une fausse reprise grâce à la transcription', () => {
    const w = (x: string, s: number) => ({ w: x, s, e: s + 0.3 });
    const words = [w('Alors', 1), w('Batman', 1.3), w('il...', 1.6), w('Alors', 2.4), w('Batman', 2.7), w('il', 3), w('a', 3.2), w('décidé', 3.4)];
    const r = proposeCuts(a, words, defaultRoughCut()).filter((c) => c.reason === 'retake');
    expect(r.length).toBe(1);
    expect(r[0].on).toBe(true);
  });
});

describe('noms', () => {
  const p = { shots: [{ pageId: 'a', chars: ['Janey Slater', 'Jon Osterman'] }], script: 'Puis Laurie Juspeczyk arrive.', research: { characters: [{ name: 'Ozymandias', aliases: ['Adrian Veidt'] }] } } as unknown as Project;
  it('corrige les noms mal transcrits', () => {
    const words = ['Janie', 'Ostermann', 'Laury', 'Ozymandia', 'Veit'].map((x, i) => ({ w: x, s: i, e: i + 0.5 }));
    expect(correctNames(words, comicNames(p)).words.map((x) => x.w)).toEqual(['Janey', 'Osterman', 'Laurie', 'Ozymandias', 'Veidt']);
  });
  it('ne touche pas aux mots ordinaires', () => {
    const words = ['Salut', 'Monde', 'Bonjour', 'Puis'].map((x, i) => ({ w: x, s: i, e: i + 0.5 }));
    expect(correctNames(words, comicNames(p)).fixed).toBe(0);
  });
});

describe('contrôle anti-erreurs', () => {
  it('répare un projet abîmé', () => {
    const p = {
      pages: [{ id: 'pg', width: 1000, height: 1500 }],
      shots: [
        { id: 'a', pageId: 'pg', rect: { x: -50, y: 10, w: 5000, h: 200 }, duration: NaN, transitionDur: 9, intensity: 0.5, shake: 0, layout: 'full', caption: { text: '' } },
        { id: 'b', pageId: 'gone', rect: { x: 0, y: 0, w: 10, h: 10 }, duration: 2, transitionDur: 0, intensity: 0.5, shake: 0, layout: 'full', caption: { text: '' } },
      ],
      audio: [{ id: 'x', start: 0, duration: 99, sourceDuration: 10, offset: 0, volume: 1 }],
      subtitles: [{ s: 2, e: 1, text: 'x', words: [] }],
      aroll: null,
    } as unknown as Project;
    const { project } = validateProject(p);
    expect(project.shots.length).toBe(1);
    const s = project.shots[0];
    expect(s.rect.x).toBe(0);
    expect(s.rect.x + s.rect.w).toBeLessThanOrEqual(1000);
    expect(Number.isFinite(s.duration)).toBe(true);
    expect(s.transitionDur).toBeLessThanOrEqual(s.duration * 0.45);
    expect(project.audio[0].duration).toBe(10);
    expect(project.subtitles.length).toBe(0);
  });
});

describe('narration', () => {
  it('estime le minutage d’un script', () => {
    const s = scriptSentences('Première phrase courte. Une deuxième phrase un peu plus longue que la première !');
    expect(s.length).toBe(2);
    expect(s[0].s).toBe(0);
    expect(s[1].s).toBeGreaterThan(s[0].e);
    expect(s[1].words.length).toBe(11);
  });
  it('associe les phrases aux cases par les noms, dans l’ordre', () => {
    const sents = scriptSentences('Janey quitte Jon. Puis Laurie arrive à Gotham. Enfin Rorschach enquête.');
    const docs = [
      { id: 'p1', order: 0, text: 'JANEY I AM LEAVING YOU JON', chars: [] },
      { id: 'p2', order: 1, text: 'THE CITY AT NIGHT', chars: [] },
      { id: 'p3', order: 2, text: 'LAURIE WELCOME TO GOTHAM', chars: [] },
      { id: 'p4', order: 3, text: 'RORSCHACH JOURNAL OCTOBER', chars: [] },
    ];
    const r = matchLocal(sents, docs);
    expect(r.map((x) => x.shotId)).toEqual(['p1', 'p3', 'p4']);
    expect(r[0].conf).toBeGreaterThan(0.5);
  });
});

describe('zooms d’accent', () => {
  it('monte vite et redescend en douceur', () => {
    expect(emphasisAt([2], 2)).toBeCloseTo(1, 2);
    expect(emphasisAt([2], 2.4)).toBeLessThan(0.3);
    expect(emphasisAt([2], 5)).toBe(0);
  });
});

import { parseUniforms } from '../src/engine/gl/parse';
import { rng, hashSeed } from '../src/engine/rng';
import { cubicBezier, EASE } from '../src/engine/motion';
import { TRANSITIONS, tp } from '../src/engine/effects';

describe('phase 3 : déterminisme, jetons, catalogue', () => {
  it('lit les valeurs par défaut des uniformes GLSL, vecteurs compris', () => {
    const u = parseUniforms('uniform vec4 c; // = vec4(0.78, 0.88, 1.0, 1.0)\nuniform vec2 center; // = vec2(0.5, 0.5)\nuniform float s; // = 0.4\nuniform float x;');
    expect(u).toEqual([
      { name: 'c', type: 'vec4', def: [0.78, 0.88, 1, 1] },
      { name: 'center', type: 'vec2', def: [0.5, 0.5] },
      { name: 's', type: 'float', def: [0.4] },
    ]);
  });
  it('le hasard semé redonne la même suite', () => {
    const a = rng(hashSeed('grain')), b = rng(hashSeed('grain'));
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  it('les courbes bezier respectent leurs bornes et la courbe standard', () => {
    const c = cubicBezier(0.65, 0, 0.35, 1);
    expect(c(0)).toBe(0); expect(c(1)).toBe(1); expect(c(0.5)).toBeCloseTo(0.5, 3);
    const lin = cubicBezier(0, 0, 1, 1);
    for (const x of [0.1, 0.37, 0.8]) expect(lin(x)).toBeCloseTo(x, 4);
    expect(EASE.standard(0.25)).toBeCloseTo(0.0625, 4);
  });
  it('chaque transition a une catégorie, une description et des réglages cohérents', () => {
    const ids = new Set<string>();
    for (const t of TRANSITIONS) {
      expect(ids.has(t.id)).toBe(false); ids.add(t.id);
      expect(t.desc.length).toBeGreaterThan(5);
      for (const p of t.params) { expect(p.min).toBeLessThan(p.max); expect(p.def).toBeGreaterThanOrEqual(p.min); expect(p.def).toBeLessThanOrEqual(p.max); }
    }
    expect(ids.size).toBe(25);
  });
  it('un réglage absent prend la valeur du catalogue', () => {
    const shot = { transition: 'whip', tp: { spread: 1.5 } } as never;
    expect(tp(shot, 'trails')).toBe(6);
    expect(tp(shot, 'spread')).toBe(1.5);
  });
});

import { beatOf } from '../src/engine/narrative';
import { PROFILES, direct } from '../src/engine/direction';
import { budget } from '../src/engine/sfx';
import { TRANSITION } from '../src/engine/effects';

describe('phase 4 : direction créative', () => {
  it('reconnaît les temps forts de la narration', () => {
    expect(beatOf('Il ouvre le rush', 0)).toBe('hook');
    expect(beatOf('En 1986, Alan Moore publie Watchmen')).toBe('date');
    expect(beatOf('Il est plus puissant que Superman')).toBe('compare');
    expect(beatOf('Il voit tout l’univers à la fois')).toBe('cosmic');
    expect(beatOf('Rorschach frappe le criminel')).toBe('action');
    expect(beatOf('Mais en réalité, personne ne sait')).toBe('reveal');
    expect(beatOf('Sa femme meurt dans ses bras')).toBe('emotion');
    expect(beatOf('Le personnage porte un manteau')).toBe('plain');
  });

  const texts = ['Intro', 'En 1985 la guerre froide', 'Il frappe fort', 'Mais en réalité', 'Il voit l’univers', 'plus fort que tout',
    'Il marche', 'Il parle', 'Combat final', 'explosion', 'Le secret', 'Il pleure', 'Il part', 'Puis il revient', 'Ensuite il frappe'];
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: 's' + i, pageId: 'p' + Math.floor(i / 2), rect: { x: 0, y: 0, w: 1, h: 1 }, duration: 2.4, framing: 'fit', motion: 'auto', intensity: 0.6,
    transition: 'whip', transitionDur: 0.3, shake: 0.9, layout: 'full', caption: { text: texts[i % texts.length], preset: 'tiktok', anim: 'pop', y: 0.8, size: 1 },
    auto: { duration: 2.4, layout: 'full', motion: 'auto', style: 'dynamic' },
  })) as never[];

  for (const prof of PROFILES) {
    it(`profil « ${prof.label} » : budget tenu, aucune répétition, palette respectée`, () => {
      const { shots } = direct(mk(60), prof); // 60 plans × 2,4 s = 2 min 24
      const quiet = (t: string) => t === 'cut' || t === 'glide';
      const all = [...prof.palette.calm, ...prof.palette.accent, ...prof.palette.strong, 'whip'];
      let t = 0; const marks: { t: number; strong: boolean }[] = [];
      shots.forEach((s: any, i: number) => {
        if (i > 0) {
          expect(all).toContain(s.transition);
          if (!quiet(s.transition)) expect(s.transition).not.toBe(shots[i - 1].transition);
          expect(s.transitionDur).toBeLessThanOrEqual(s.duration * 0.45 + 1e-9);
          expect(s.transitionDur).toBeGreaterThanOrEqual(quiet(s.transition) ? 0 : TRANSITION[s.transition as 'fade'].minDur ?? 0);
          expect(s.shake).toBeLessThanOrEqual(prof.camera.shake + 1e-9);
          if (prof.palette.strong.includes(s.transition)) marks.push({ t, strong: true });
          else if (prof.palette.accent.includes(s.transition)) marks.push({ t, strong: false });
        }
        t += s.duration;
      });
      for (const m of marks) {
        const win = marks.filter((x) => x.t <= m.t && x.t > m.t - 60);
        expect(win.filter((x) => x.strong).length).toBeLessThanOrEqual(Math.max(1, Math.floor(prof.budget.strong)));
        expect(win.length).toBeLessThanOrEqual(Math.max(1, Math.floor(prof.budget.accent)));
      }
      // never an effect on every cut: at least 40 % plain cuts or fades
      const calm = shots.slice(1).filter((s: any) => prof.palette.calm.includes(s.transition)).length;
      expect(calm / (shots.length - 1)).toBeGreaterThan(0.4);
    });
  }

  it('le son ne tombe jamais sur chaque transition', () => {
    const ev = Array.from({ length: 60 }, (_, i) => ({ t: i * 0.5, kind: 'whoosh' as const, gain: 1 }));
    const b = budget(ev, 4);
    expect(b.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < b.length; i++) expect(b[i].t - b[i - 1].t).toBeGreaterThanOrEqual(1.2);
  });
});

import { itemValues } from '../src/engine/scene3d';
import { PROFILE } from '../src/engine/direction';

describe('phase 5 : schémas et scènes 3D', () => {
  it('lit les valeurs des barres, sinon prend le rang', () => {
    const d = (subs: string[]) => ({ kind: 'scale', title: '', links: [], items: subs.map((s, i) => ({ id: 'i' + i, label: '', sub: s })) }) as never;
    expect(itemValues(d(['10', '1 000', '2,5']))).toEqual([10, 1000, 2.5]);
    expect(itemValues(d(['fort', '', 'x']))).toEqual([1, 2, 3]);
  });
  it('le profil cosmique crée au plus 2 scènes 3D, espacées, à partir des cases', () => {
    const shots = Array.from({ length: 80 }, (_, i) => ({
      id: 's' + i, pageId: 'p' + (i % 7), rect: { x: i, y: 0, w: 10, h: 10 }, duration: 3, framing: 'fit', motion: 'auto', intensity: 0.6,
      transition: 'cut', transitionDur: 0, shake: 0, layout: 'full', caption: { text: i % 5 === 2 ? 'Il voit tout l’univers' : 'Il marche', preset: 'tiktok', anim: 'pop', y: 0.8, size: 1 },
      auto: { duration: 3, layout: 'full', motion: 'auto', style: 'cinematic' },
    })) as never[];
    const { shots: out, report } = direct(shots, PROFILE.cosmic);
    const scenes = out.map((s: any, i: number) => ({ s, t: i * 3 })).filter((x: any) => x.s.diagram);
    expect(report.scenes).toBe(scenes.length);
    expect(scenes.length).toBeGreaterThan(0);
    expect(scenes.length).toBeLessThanOrEqual(2);
    for (const x of scenes) {
      expect(x.s.diagram.kind).toBe('cosmos');
      expect(x.s.pageId).toBeNull();
      expect(x.s.diagram.items.length).toBeGreaterThanOrEqual(2);
      for (const it of x.s.diagram.items) expect(it.pageId).toBeTruthy();
    }
    if (scenes.length === 2) expect(scenes[1].t - scenes[0].t).toBeGreaterThanOrEqual(90);
    // the other profiles never build scenes
    expect(direct(shots, PROFILE.premium).report.scenes).toBe(0);
  });
});

import { measureLoudness, normalize } from '../src/engine/loudness';

describe('phase 6 : volume (ITU-R BS.1770)', () => {
  const sr = 48000;
  const sine = (amp: number, f = 997, secs = 5) => Float32Array.from({ length: sr * secs }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / sr));
  it('un sinus 1 kHz à 0 dBFS sur un seul canal mesure −3,01 LUFS (valeur de référence de la norme)', () => {
    const l = measureLoudness([sine(1), new Float32Array(sr * 5)], sr);
    expect(l.integrated).toBeCloseTo(-3.01, 1);
  });
  it('−20 dB de signal = −20 LU', () => {
    const a = measureLoudness([sine(1), sine(1)], sr).integrated;
    const b = measureLoudness([sine(0.1), sine(0.1)], sr).integrated;
    expect(a - b).toBeCloseTo(20, 1);
  });
  it('le silence est ignoré par le gating', () => {
    const half = Float32Array.from({ length: sr * 10 }, (_, i) => (i < sr * 5 ? 0.1 * Math.sin((2 * Math.PI * 997 * i) / sr) : 0));
    const full = measureLoudness([sine(0.1), sine(0.1)], sr).integrated;
    expect(measureLoudness([half, half], sr).integrated).toBeCloseTo(full, 0);
  });
  it('normalise à −14 LUFS sans dépasser −1,5 dBFS', () => {
    const quiet = sine(0.05);
    const loudBurst = Float32Array.from(quiet, (v, i) => (i > sr && i < sr * 1.05 ? v * 18 : v));
    const r = normalize([loudBurst, loudBurst], sr, -14, -1.5);
    expect(r.after.integrated).toBeGreaterThan(-15);
    expect(r.after.integrated).toBeLessThan(-13);
    expect(r.after.peakDb).toBeLessThanOrEqual(-1.5 + 1e-3);
  });
});

import { valueAt } from '../src/engine/audio';

describe('phase 6 : priorité à la voix', () => {
  it('la musique est baissée dès 0 s quand la voix commence tout de suite', () => {
    const k: [number, number][] = [[0, 1], [0, 1], [0, 0.25], [5, 0.25], [5.45, 1]];
    expect(valueAt(k, 0)).toBe(0.25);
    expect(valueAt(k, 2.5)).toBe(0.25);
    expect(valueAt(k, 5.225)).toBeCloseTo(0.625, 3);
    expect(valueAt(k, 9)).toBe(1);
  });
  it('rampe normale avant une voix plus tardive', () => {
    const k: [number, number][] = [[0, 1], [1.8, 1], [2, 0.25], [4, 0.25], [4.45, 1]];
    expect(valueAt(k, 1)).toBe(1);
    expect(valueAt(k, 1.9)).toBeCloseTo(0.625, 3);
    expect(valueAt(k, 3)).toBe(0.25);
  });
});

import { fmtMin } from '../src/engine/bench';
describe('phase 7 : banc de mesure', () => {
  it('affiche les durées lisiblement', () => {
    expect(fmtMin(0.2)).toBe('1 min');
    expect(fmtMin(12.4)).toBe('12 min');
    expect(fmtMin(84)).toBe('1 h 24');
    expect(fmtMin(349)).toBe('5 h 49');
  });
});

import { analyseNoise, cleanVoice, reductionFor } from '../src/engine/denoise';
import { rng as rng2 } from '../src/engine/rng';

describe('nettoyage de la voix', () => {
  const sr = 48000;
  // a "voice": harmonic syllables of 180 ms separated by 120 ms pauses, and 1 s silences
  const voice = (secs: number) => Float32Array.from({ length: sr * secs }, (_, i) => {
    const t = i / sr, ph = t % 2.2;
    if (ph > 1.8) return 0;
    const syl = (t % 0.3) < 0.18 ? Math.sin(Math.PI * ((t % 0.3) / 0.18)) : 0;
    return 0.25 * syl * (Math.sin(2 * Math.PI * 160 * t) + 0.5 * Math.sin(2 * Math.PI * 320 * t) + 0.25 * Math.sin(2 * Math.PI * 640 * t + 1));
  });
  const withNoise = (x: Float32Array, level: number) => { const r = rng2(7); return Float32Array.from(x, (v) => v + level * (r() * 2 - 1)); };
  it('ne touche pas une prise propre', () => {
    const r = cleanVoice([voice(6)], sr, 'auto');
    expect(r.report.applied).toBe(false);
  });
  it('réduit le bruit de fond sans écraser la voix', () => {
    const clean = voice(8), noisy = withNoise(clean, 0.01);
    const r = cleanVoice([noisy], sr, 'auto');
    expect(r.report.applied).toBe(true);
    expect(r.report.reductionDb).toBeLessThanOrEqual(18);
    // the measured reduction matches the target chosen from the SNR (6 dB here, the take is fairly clean)
    expect(r.report.noiseDb - r.report.noiseAfterDb).toBeGreaterThan(r.report.reductionDb - 1);
    const strong = cleanVoice([noisy], sr, 'strong');
    expect(strong.report.noiseDb - strong.report.noiseAfterDb).toBeGreaterThan(16);
    const before = analyseNoise(noisy, sr).speechDb, after = analyseNoise(r.channels[0], sr).speechDb;
    expect(Math.abs(before - after)).toBeLessThan(2.5);
  });
  it('la force suit le rapport signal/bruit et reste plafonnée', () => {
    expect(reductionFor('auto', 45, -80)).toBe(0);
    expect(reductionFor('auto', 30, -55)).toBe(6);
    expect(reductionFor('auto', 12, -40)).toBe(14);
    expect(reductionFor('auto', 3, -30)).toBe(18);
    expect(reductionFor('off', 3, -30)).toBe(0);
  });
});

import { cameraPath } from '../src/engine/faces';
describe('recadrage vertical', () => {
  const T = Array.from({ length: 40 }, (_, i) => i * 0.5);
  it('ne suit pas les petits balancements', () => {
    const raw = T.map((t) => ({ t, x: 0.5 + 0.02 * Math.sin(t * 3), y: 0.4, s: 0.1 }));
    const cam = cameraPath(raw, T, T.map(() => false));
    expect(Math.max(...cam.map((c) => Math.abs(c.x - cam[0].x)))).toBeLessThan(1e-9);
  });
  it('se déplace sans à-coup quand le visage change de place, et coupe net sur un changement de plan', () => {
    const raw = T.map((t, i) => ({ t, x: i < 20 ? 0.3 : 0.7, y: 0.4, s: 0.1 }));
    const cam = cameraPath(raw, T, T.map(() => false));
    for (let i = 1; i < cam.length; i++) expect(Math.abs(cam[i].x - cam[i - 1].x)).toBeLessThanOrEqual(((9 / 16) / (16 / 9)) * 0.9 * 0.5 + 1e-6); // a 9:16 crop is 0.316 of a 16:9 frame; at most 0.9 crop-width per second
    expect(cam[cam.length - 1].x).toBeCloseTo(0.7, 1);
    const cut = cameraPath(raw, T, T.map((_, i) => i === 20));
    expect(cut[20].x).toBeCloseTo(0.7, 5);
    expect(cut[20].cut).toBe(true);
  });
  it('garde son cadre quand le visage disparaît un instant', () => {
    const raw = T.map((t, i) => (i >= 10 && i < 14 ? null : { t, x: 0.6, y: 0.4, s: 0.1 }));
    const cam = cameraPath(raw, T, T.map(() => false));
    expect(cam[12].x).toBeCloseTo(0.6, 5);
  });
});

import { analyseScript, figureValue, keywordsOf, keyToken } from '../src/engine/scriptIntel';
import { exportAss } from '../src/engine/export';

describe('analyse du script', () => {
  const proj = (script: string) => ({ script, shots: [], audio: [], aroll: null, pages: [] }) as never;
  const THOR = "Saviez-vous que Thor est bien plus puissant que ce que montrent les films ? Tout commence avec l'Odinforce, le pouvoir de son père Odin. En 2004, dans Thor #80, il hérite de cette force et devient roi d'Asgard. Mais en réalité, son vrai pouvoir s'appelle la Thorforce. Par exemple, quand il affronte Zeus, il le bat sans Mjolnir. Il est même plus fort que Hercule, et il soulève 10 millions de tonnes contre 2 millions pour Hulk. Comme il le dit : « Je suis le dieu du tonnerre, et je ne plierai pas ». En 2014, pendant Original Sin, il perd le droit de porter Mjolnir. Au fond, Thor reste le dieu le plus sous-estimé de Marvel.";
  it('rôles, entités et visuels proposés pour Thor', () => {
    const a = analyseScript(proj(THOR));
    expect(a.passages[0].role).toBe('accroche');
    expect(a.passages.at(-1)!.role).toBe('conclusion');
    expect(a.passages.some((p) => p.role === 'revelation' && /Thorforce/.test(p.text))).toBe(true);
    expect(a.passages.some((p) => p.role === 'preuve' && /#80/.test(p.text))).toBe(true);
    const names = a.entities.map((e) => e.name);
    for (const n of ['Thor', 'Odin', 'Odinforce', 'Thorforce', 'Zeus', 'Mjolnir', 'Asgard', '2004']) expect(names).toContain(n);
    expect(names).not.toContain('réalité');
    const kinds = a.suggestions.map((s) => s.kind);
    for (const k of ['chronologie', 'reseau', 'echelle', 'citation', 'titre']) expect(kinds).toContain(k);
    const sc = a.suggestions.find((s) => s.kind === 'echelle')!;
    expect(sc.items.map((i) => Number(i.sub))).toEqual([10e6, 2e6]);
    expect(a.suggestions.find((s) => s.kind === 'citation')!.needs).toBeTruthy();
  });
  it('le Wakanda : carte des lieux (à fournir), chronologie, relations', () => {
    const a = analyseScript(proj("L'Empire intergalactique du Wakanda est l'une des idées les plus folles de Marvel. Dans le futur, le Wakanda conquiert des centaines de planètes. En 2018, Ta-Nehisi Coates raconte cette expansion dans Black Panther #1. T'Challa se réveille esclave dans les mines de vibranium, sur la planète Bast. Mais en réalité, ce T'Challa est un clone. L'empire affronte la Maaga, une alliance de rebelles menée par Nakia et N'Jadaka. En 2021, la série se termine sur Wakanda et Terre réunies. Bref, c'est un Wakanda qui ressemble à Star Wars."));
    const kinds = a.suggestions.map((s) => s.kind);
    expect(kinds).toContain('carte');
    expect(kinds).toContain('chronologie');
    expect(kinds).toContain('reseau');
    expect(a.suggestions.find((s) => s.kind === 'carte')!.needs).toMatch(/invente/);
  });
  it('chiffres et mots-clés des sous-titres', () => {
    expect(figureValue('2,5 milliards')).toBe(2.5e9);
    const k = keywordsOf(['Thor utilise l’Odinforce depuis 2004']);
    expect(k.has(keyToken('Thor'))).toBe(true);
    expect(k.has(keyToken("l'Odinforce"))).toBe(true);
    expect(k.has('2004')).toBe(true);
    expect(k.has(keyToken('utilise'))).toBe(false);
  });
  it('export .ass : karaoké mot à mot et mot-clé en couleur', () => {
    const p = { format: '9:16', accent: '#FFE500', subtitleStyle: { preset: 'tiktok', y: 0.9, size: 1 }, subtitles: [{ s: 1, e: 2, text: 'Thor arrive', words: [{ w: 'Thor', s: 1, e: 1.4 }, { w: 'arrive', s: 1.5, e: 2 }] }] } as never;
    const ass = exportAss(p, new Set(['thor']), keyToken);
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toMatch(/Dialogue: 0,0:00:01\.00,0:00:02\.00,Forge,,0,0,0,,\{\\k50\}\{\\c&H0000E5FF&\}THOR\{\\c&H00FFFFFF&\} \{\\k50\}ARRIVE/);
  });
});

import { transcriptQuality } from '../src/engine/transcriptCheck';
import { scriptOnVoice } from '../src/engine/auto';
describe('fiabilité de la transcription', () => {
  const W = (txt: string) => txt.split(' ').map((w, i) => ({ w, s: i * 0.4, e: i * 0.4 + 0.3 }));
  it('repère une boucle hallucinée de Whisper', () => {
    const q = transcriptQuality(W('je ne sais pas ' + 'je ne me suis pas dit que '.repeat(20)), 40);
    expect(q.ok).toBe(false);
    expect(q.reason).toMatch(/boucle/);
  });
  it('accepte une vraie transcription, même avec une reprise', () => {
    const q = transcriptQuality(W("Saviez-vous que Thor est bien plus puissant que les films ? Tout commence avec l'Odin tout commence avec l'Odinforce le pouvoir de son père Odin"), 10);
    expect(q.ok).toBe(true);
  });
  it('pose le script sur les passages de voix', () => {
    const ws = scriptOnVoice('Thor arrive. Il frappe fort.', [{ s: 0, e: 2, t: 0 }, { s: 5, e: 7, t: 2 }]);
    expect(ws.map((w) => w.w)).toEqual(['Thor', 'arrive.', 'Il', 'frappe', 'fort.']);
    expect(ws[0].s).toBe(0);
    expect(ws.at(-1)!.e).toBeLessThanOrEqual(4);
    for (let i = 1; i < ws.length; i++) expect(ws[i].s).toBeGreaterThanOrEqual(ws[i - 1].s);
  });
});

import { alignScript, wordSim } from '../src/engine/align';
describe('alignement script ↔ transcription', () => {
  const SCRIPT = "Saviez-vous que Thor est bien plus puissant que ce que montrent les films ? Tout commence avec l'Odinforce, le pouvoir de son père Odin. En 2004, dans Thor numéro 80, il hérite de cette force et devient roi d'Asgard. Mais en réalité, son vrai pouvoir s'appelle la Thorforce.";
  // real Whisper output (small model) on the synthetic voice of the 60 s test, timings spread 0.35 s apart
  const HYP = "sa mienne ou que \u00e7a est bien plus puissant que ce que moutent les films. Tu commences avec l 'Odda. Tu commences avec l 'Odda Force, le pouvoir de Super Odda. En 2004, dans son num\u00e9ro quatre -vingt, il est h\u00e9rit\u00e9 cette force et devient ois d 'ascale. Mais en r\u00e9alit\u00e9, son r\u00e9pouvoir s 'appelle la Force.";
  const words = HYP.split(/\s+/).filter(Boolean).map((w, i) => ({ w, s: i * 0.35, e: i * 0.35 + 0.3 }));
  it('donne aux mots du script le minutage de la transcription, même mal reconnue', () => {
    const r = alignScript(SCRIPT, words);
    const text = r.words.map((w) => w.w).join(' ');
    expect(text).toContain("l'Odinforce,");
    expect(text).toContain('Thorforce.');
    expect(r.coverage).toBeGreaterThan(0.5);
    for (let i = 1; i < r.words.length; i++) expect(r.words[i].s).toBeGreaterThanOrEqual(r.words[i - 1].s);
    const thor = r.words.find((w) => w.w === 'Thorforce.')!;
    expect(thor.s).toBeGreaterThan(r.words.find((w) => w.w === 'Asgard.' || w.w === "d'Asgard.")!.s);
  });
  it('similarité des mots', () => {
    expect(wordSim('Odinforce', 'Odda')).toBeLessThan(0.6);
    expect(wordSim('moutent', 'montrent')).toBeGreaterThan(0.6);
  });
});

describe('fichier projet .forge', () => {
  it('liste tous les médias du projet, rush compris', async () => {
    const { mediaRefs } = await import('../src/lib/projectFile');
    const p = { pages: [{ mediaId: 'img1' }], audio: [{ mediaId: 'snd1' }], aroll: { mediaId: 'vid1' } } as never;
    expect(mediaRefs(p)).toEqual([{ id: 'img1', kind: 'image' }, { id: 'snd1', kind: 'audio' }, { id: 'vid1', kind: 'video' }]);
  });
  it('relit le format zip (v2) avec ses médias, et l’ancien format JSON (v1)', async () => {
    const { readProjectFile } = await import('../src/lib/projectFile');
    const { zipSync, strToU8 } = await import('fflate');
    const project = { id: 'p1', name: 'Test', pages: [], audio: [], aroll: { mediaId: 'vid1' } };
    const z = zipSync({ 'project.json': strToU8(JSON.stringify({ magic: 'forge-project@2', project, types: { vid1: 'video/mp4' } })), 'media/vid1': new Uint8Array([1, 2, 3, 4]) });
    const v2 = await readProjectFile(new Blob([z]));
    expect(v2.project.name).toBe('Test');
    expect(v2.media.get('vid1')?.size).toBe(4);
    expect(v2.media.get('vid1')?.type).toBe('video/mp4');
    const v1 = await readProjectFile(new Blob([JSON.stringify({ magic: 'forge-project@1', project, media: { img: 'data:image/png;base64,AAEC' } })]));
    expect(v1.media.get('img')?.size).toBe(3);
    await expect(readProjectFile(new Blob(['{"magic":"autre"}']))).rejects.toThrow(/pas un projet Forge/);
  });
});
