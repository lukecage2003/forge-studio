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
    expect(ids.size).toBe(22);
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
