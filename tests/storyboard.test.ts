import { describe, expect, it } from 'vitest';
import { buildBoard, boardToPlan, applyBoardChoices, boardIssues, captionChunks, sentenceKey } from '../src/engine/storyboard';
import { sfxEvents } from '../src/engine/sfx';
import { newProject, newShot } from '../src/store';
import type { StoryPlan } from '../src/engine/story';

const p0 = newProject();
const a = newShot(p0, { pageId: 'pg1', rect: { x: 0, y: 0, w: 100, h: 100 } }), b = newShot(p0, { pageId: 'pg2', rect: { x: 0, y: 0, w: 100, h: 100 } });
const p = { ...p0, shots: [a, b] };
const sents = [{ text: 'Il arrive dans la ville.', s: 0, e: 2, words: [] }, { text: 'Et là, boum !', s: 2.2, e: 3.5, words: [] }, { text: 'Rien ne bouge.', s: 3.6, e: 5, words: [] }];
const plan: StoryPlan = { engine: 'local', schemas: [], assign: [{ sentence: 0, shotId: a.id, conf: 0.8, alts: [b.id], more: [] }, { sentence: 1, shotId: b.id, conf: 0.2, alts: [], more: [] }] };

describe('storyboard', () => {
  it('une ligne par phrase : case sûre, incertaine → visage (rush), manquante, sons des temps forts', () => {
    const bd = buildBoard({ ...p, aroll: {} as never }, sents, plan, { hasFace: true });
    expect(bd.rows.map((r) => r.mode)).toEqual(['panel', 'face', 'face']);
    expect(bd.rows[1].sound).toBe('impact');
    expect(bd.rows[0].alts).toEqual([b.id]);
  });
  it('recalculer garde ce que l’utilisateur a choisi', () => {
    const first = buildBoard(p, sents, plan, { hasFace: false });
    first.rows[0] = { ...first.rows[0], shotId: b.id, camera: 'tour', edited: ['shot', 'camera'] };
    const again = buildBoard(p, sents, plan, { hasFace: false, prev: first });
    expect(again.rows[0].shotId).toBe(b.id);
    expect(again.rows[0].camera).toBe('tour');
    expect(again.rows[0].conf).toBe(1);
    expect(again.rows[1].edited).toBeUndefined();
  });
  it('le montage suit le storyboard, sauf si le script a changé', () => {
    const bd = buildBoard(p, sents, plan, { hasFace: false });
    bd.rows[2] = { ...bd.rows[2], mode: 'face', edited: ['mode'] };
    const pl = boardToPlan(bd, sents)!;
    expect(pl.assign[0].shotId).toBe(a.id);
    expect(pl.assign[2].shotId).toBeNull();
    expect(boardToPlan(bd, [...sents, { text: 'Nouvelle phrase.', s: 6, e: 7, words: [] }])).toBeNull();
    expect(sentenceKey(sents)).not.toBe(sentenceKey(sents.slice(1)));
  });
  it('mouvement et son du storyboard appliqués aux plans de la phrase', () => {
    const bd = buildBoard(p, sents, plan, { hasFace: false });
    bd.rows[0] = { ...bd.rows[0], camera: 'read', sound: 'none', edited: ['camera', 'sound'] };
    const out = applyBoardChoices([{ ...a, match: { sentence: sents[0].text, conf: 1, alts: [], source: 'local' } }, b], bd);
    expect(out[0].motion).toBe('read');
    expect(out[0].sfx).toBe('none');
    expect(out[1]).toBe(b);
  });
  it('signale ce qui manque et ce qui doute', () => {
    const bd = buildBoard(p, sents, plan, { hasFace: false });
    const iss = boardIssues(bd, p);
    expect(iss.some((x) => x.row === 2 && x.level === 'error')).toBe(true);
    expect(iss.some((x) => x.row === 1 && /incertaine/.test(x.text))).toBe(true);
  });
  it('découpe les sous-titres comme le montage', () => {
    expect(captionChunks('un deux trois quatre cinq', 2)).toEqual(['un deux', 'trois quatre', 'cinq']);
  });
});

describe('son par plan', () => {
  it('« aucun » coupe le son automatique du plan ; « impact » le force', () => {
    const base = { ...newProject(), autoSfx: { on: true, volume: 0.6 } };
    const s1 = newShot(base, { transition: 'whip', duration: 3 }), s2 = newShot(base, { transition: 'whip', duration: 3 });
    expect(sfxEvents({ ...base, shots: [s1, { ...s2, sfx: 'none' }] }).length).toBe(sfxEvents({ ...base, shots: [s1] }).length);
    expect(sfxEvents({ ...base, shots: [s1, { ...s2, transition: 'cut', sfx: 'impact' }] }).some((e) => e.kind === 'impact')).toBe(true);
  });
});
