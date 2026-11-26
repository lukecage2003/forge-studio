import { describe, expect, it } from 'vitest';
import { comicOrder, cutFromDetection } from '../src/engine/panelAI';

const R = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('ordre de lecture des cases', () => {
  it('lit une grille 2×2 ligne par ligne', () => {
    const g = [R(510, 510, 490, 490), R(0, 0, 490, 490), R(0, 510, 490, 490), R(510, 0, 490, 490)];
    expect(comicOrder(g).map((r) => [r.x, r.y])).toEqual([[0, 0], [510, 0], [0, 510], [510, 510]]);
  });
  it('lit une grande case à gauche puis la pile de droite', () => {
    const g = [R(510, 0, 490, 490), R(0, 0, 490, 1000), R(510, 510, 490, 490)];
    expect(comicOrder(g).map((r) => [r.x, r.y])).toEqual([[0, 0], [510, 0], [510, 510]]);
  });
  it('manga : de droite à gauche', () => {
    const g = [R(0, 0, 490, 490), R(510, 0, 490, 490)];
    expect(comicOrder(g, true).map((r) => r.x)).toEqual([510, 0]);
  });
  it('tolère des boîtes qui se chevauchent un peu', () => {
    const g = [R(0, 0, 520, 480), R(500, 0, 500, 480), R(0, 470, 1000, 500)];
    expect(comicOrder(g).map((r) => [r.x, r.y])).toEqual([[0, 0], [500, 0], [0, 470]]);
  });
});

describe('découpe depuis le détecteur IA', () => {
  const det = (panels: ReturnType<typeof R>[], s = 0.9) => ({ panels: panels.map((p) => ({ ...p, s })), bubbles: [], ms: 1, device: 'test' });
  it('une seule grande case = pleine page', () => {
    expect(cutFromDetection(det([R(10, 10, 980, 1480)]), 1000, 1500)?.kind).toBe('splash');
  });
  it('enlève les boîtes imbriquées et les miettes', () => {
    const c = cutFromDetection(det([R(0, 0, 1000, 700), R(100, 100, 200, 200), R(0, 750, 1000, 750), R(5, 5, 20, 20)]), 1000, 1500)!;
    expect(c.kind).toBe('panels');
    expect(c.rects.length).toBe(2);
  });
  it('refuse une détection trop maigre', () => {
    expect(cutFromDetection(det([R(0, 0, 200, 200), R(300, 300, 200, 200)]), 1000, 1500)).toBeNull();
    expect(cutFromDetection(det([R(0, 0, 1000, 700)], 0.2), 1000, 1500)).toBeNull();
  });
});

describe('caméra qui lit les bulles', async () => {
  const { cameraAt, resolveMotion } = await import('../src/engine/render');
  const shot = {
    id: 's', pageId: 'p', rect: R(0, 0, 1000, 600), motion: 'auto', framing: 'fit', intensity: 0.6, duration: 4,
    balloons: [R(50, 40, 160, 100), R(780, 420, 160, 100)],
  } as unknown as Parameters<typeof cameraAt>[0];
  it('choisit le mouvement « bulles » quand elles sont écartées', () => {
    expect(resolveMotion(shot, 9 / 16, false).motion).toBe('read');
    expect(resolveMotion({ ...shot, balloons: [R(50, 40, 100, 80), R(120, 60, 100, 80)] }, 9 / 16, false).motion).not.toBe('read');
  });
  it('part de la 1re bulle et finit sur la dernière, sans sortir de la case', () => {
    const a = cameraAt(shot, 0, 9 / 16, false), b = cameraAt(shot, 1, 9 / 16, false);
    expect(a.cx).toBeLessThan(b.cx);
    expect(a.cy).toBeLessThanOrEqual(b.cy);
    for (const v of [a, b]) {
      expect(v.cx - v.vw / 2).toBeGreaterThanOrEqual(-0.01);
      expect(v.cx + v.vw / 2).toBeLessThanOrEqual(1000.01);
    }
  });
});

describe('garde-fous de cadrage', () => {
  it('ignore une fine bande au bord de la page', () => {
    const det = { panels: [R(0, 0, 1431, 947), R(1345, 1056, 86, 466), R(0, 1568, 1431, 632)].map((p) => ({ ...p, s: 0.9 })), bubbles: [], ms: 1, device: 't' };
    expect(cutFromDetection(det, 1431, 2200)!.rects.length).toBe(2);
  });
});

describe('grille de cases justifiée', async () => {
  const { justifiedBoxes } = await import('../src/engine/render');
  const area = { x: 0, y: 0, w: 1000, h: 1800 };
  it('empile deux cases larges en pleine largeur dans un cadre vertical', () => {
    const b = justifiedBoxes([2.5, 2.5], area, 20);
    expect(b[0].w).toBeCloseTo(1000, 0);
    expect(b[1].y).toBeGreaterThan(b[0].y + b[0].h);
  });
  it('met deux cases hautes côte à côte', () => {
    const b = justifiedBoxes([0.5, 0.5], area, 20);
    expect(Math.abs(b[0].y - b[1].y)).toBeLessThan(1);
  });
  it('ne déborde jamais du cadre et couvre bien plus que l’ancienne grille', () => {
    for (const asp of [[2.5, 2.5, 2.5], [0.6, 1.8, 0.7, 0.7], [3, 0.5]]) {
      const b = justifiedBoxes(asp, area, 20);
      for (const x of b) { expect(x.x).toBeGreaterThanOrEqual(-0.01); expect(x.y + x.h).toBeLessThanOrEqual(1800.01); expect(x.x + x.w).toBeLessThanOrEqual(1000.01); }
      expect(b.reduce((a, x) => a + x.w * x.h, 0) / (1000 * 1800)).toBeGreaterThan(0.35);
    }
  });
});

describe('genre de page lu dans le texte', async () => {
  const { readPageText, kindFromText } = await import('../src/engine/classify');
  it('« EGO SUM » avec ses crédits est une page de titre, pas une planche', () => {
    const ocr = 'EGO SUM J. MICHAEL STRACZYNSKI script ADAM HUGHES art LAURA MARTIN colors STEVE WANDS letters ADAM HUGHES cover NEAL ADAMS variant cover CAMILLA ZHANG asst. editor CHRIS CONROY assoc. editor MARK CHIARELLO editor WATCHMEN created by ALAN MOORE and DAVE GIBBONS';
    const r = kindFromText(readPageText(ocr), 0, 0.7);
    expect(r?.kind).toBe('title');
  });
  it('crédits en français', () => {
    expect(kindFromText(readPageText('Scénario : Jean Dupont · Dessin : Marie Martin · Couleurs : Studio X'), 0, 0.6)?.kind).toBe('title');
  });
  it('une planche avec des dialogues ne devient pas une page de crédits', () => {
    expect(kindFromText(readPageText('I AM LEAVING THE INTRINSIC FIELD CHAMBER TO HAVE LUNCH WITH JANEY. THE WATCH IS BROKEN.'), 6, 0.3)).toBeNull();
  });
  it('une publicité', () => {
    expect(kindFromText(readPageText('NOW AVAILABLE in stores and on www.dccomics.com — subscribe today, order now'), 0, 0.8)?.kind).toBe('ad');
  });
});

describe('pages hybrides et récitatifs', async () => {
  const { readPageText, kindFromText } = await import('../src/engine/classify');
  it('planche d’ouverture (récit + crédits) reste une planche, crédits retirés', () => {
    const r = kindFromText(readPageText('AMEN. CHANGES IN PERSPECTIVE J. MICHAEL STRACZYNSKI script ADAM HUGHES art LAURA MARTIN colors STEVE WANDS letters'), 2, 0.3, 4);
    expect(r?.kind).toBe('story');
    expect(r?.dropCredits).toBe(true);
  });
  it('une planche pleine de récitatifs n’est pas une page de texte', () => {
    const long = Array.from({ length: 160 }, (_, i) => 'reality' + (i % 7)).join(' ');
    expect(kindFromText(readPageText(long), 1, 0.3, 5)).toBeNull();
    expect(kindFromText(readPageText(long), 0, 0, 0)?.kind).toBe('text');
  });
  it('situe le bloc des crédits', () => {
    const boxes = [
      { t: 'AMEN.', x: 100, y: 300, w: 60, h: 20 },
      { t: 'CHANGES', x: 80, y: 1000, w: 300, h: 70 }, { t: 'PERSPECTIVE', x: 80, y: 1080, w: 400, h: 70 },
      { t: 'STRACZYNSKI', x: 80, y: 1180, w: 150, h: 20 }, { t: 'script', x: 240, y: 1180, w: 50, h: 20 },
      { t: 'HUGHES', x: 320, y: 1180, w: 80, h: 20 }, { t: 'art', x: 410, y: 1180, w: 30, h: 20 },
      { t: 'MARTIN', x: 80, y: 1210, w: 80, h: 20 }, { t: 'colors', x: 170, y: 1210, w: 60, h: 20 },
    ];
    const pt = readPageText(boxes.map((b) => b.t).join(' '), boxes);
    expect(pt.creditsBox).toBeDefined();
    expect(pt.creditsBox!.y).toBeLessThan(1000);
    expect(pt.creditsBox!.y).toBeGreaterThan(400);
  });
});

describe('script calé sur les respirations de la voix', async () => {
  const { scriptOnVoice } = await import('../src/engine/auto');
  const script = 'Jon est seul sur Mars avec une photo. Il se souvient de Janey. Puis tout bascule dans la chambre.';
  const segs = [{ s: 0, e: 12, t: 0 }];
  it('chaque phrase commence juste après une pause réelle', () => {
    const plain = scriptOnVoice(script, segs);
    const firstOf = (ws: { w: string; s: number }[], word: string) => ws.find((w) => w.w === word)!.s;
    // real breaths 0.5 s away from the proportional guess
    const g1 = firstOf(plain, 'Il'), g2 = firstOf(plain, 'Puis');
    const pauses = [{ t: g1 + 0.5, d: 0.45 }, { t: g2 - 0.5, d: 0.5 }, { t: 3.0, d: 0.13 }];
    const al = scriptOnVoice(script, segs, pauses);
    expect(Math.abs(firstOf(al, 'Il') - (g1 + 0.5))).toBeLessThan(0.05);
    expect(Math.abs(firstOf(al, 'Puis') - (g2 - 0.5))).toBeLessThan(0.05);
    // words stay in order and inside the voice
    for (let i = 1; i < al.length; i++) expect(al[i].s).toBeGreaterThan(al[i - 1].s);
    expect(al[al.length - 1].e).toBeLessThanOrEqual(12.001);
  });
  it('sans pause proche, garde la répartition proportionnelle', () => {
    expect(scriptOnVoice(script, segs, [{ t: 11.5, d: 0.3 }])).toEqual(scriptOnVoice(script, segs));
  });
});

describe('pont français → anglais pour les bulles', async () => {
  const { matchLocal } = await import('../src/engine/understand');
  const doc = (id: string, order: number, text: string) => ({ id, order, text, chars: [] });
  it('relie une narration française aux bulles anglaises par racines et glossaire', () => {
    const docs = [
      doc('a', 0, 'OCTOBER. I AM HOLDING THE PHOTOGRAPH IN MY HAND.'),
      doc('b', 1, 'HOW LONG DID IT TAKE BEFORE YOU WERE GOOD AT FIXING WATCHES?'),
      doc('c', 2, 'IT WAS THE SECOND WORLD WAR. THE TANKS ROLLED INTO TOWN.'),
      doc('d', 3, 'WE WILL TAKE THE WAGON AND LEAVE IN THE SNOW.'),
    ];
    const sents = ['En octobre, il tient une photo.', 'Il demandait combien de temps pour réparer des montres.', 'La guerre arrive, avec les chars.', 'Ils fuient dans la neige avec une charrette.']
      .map((text, i) => ({ text, s: i * 3, e: i * 3 + 2.5, words: [] }));
    expect(matchLocal(sents, docs).map((a) => a.shotId)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('ouverture Marvel : une grande image bavarde avec les crédits dessus', async () => {
  const { readPageText, kindFromText } = await import('../src/engine/classify');
  it('reste du récit, crédits retirés', () => {
    const r = kindFromText(readPageText('NO LONGER MY SON! FATHER, HELP ME. AL EWING writer KENNETH ROCAFORT artist DAN BROWN color artist VC’S JOE SABINO letterer'), 6, 0.9, 1);
    expect(r?.kind).toBe('story');
    expect(r?.dropCredits).toBe(true);
  });
  it('une vraie page de crédits sans bulles reste écartée', () => {
    expect(kindFromText(readPageText('AL EWING writer KENNETH ROCAFORT artist DAN BROWN color artist'), 0, 0.8, 1)?.kind).toBe('title');
  });
});

describe('lecture PaddleOCR : regroupement des lignes', () => {
  const L = (text: string, x: number, y: number, w = 200, h = 20, conf = 0.95) => ({ text, conf, x, y, w, h });
  it('range les lignes par bulle, bulles dans l’ordre de lecture, et chaque bulle dans sa case', async () => {
    const { groupLines } = await import('../src/engine/understand');
    const shots = [{ id: 'a', rect: R(0, 0, 500, 500) }, { id: 'b', rect: R(0, 510, 500, 500) }];
    const bubbles = [R(300, 20, 180, 80), R(20, 20, 220, 100), R(20, 600, 300, 80)];
    const lines = [
      L('SECOND BALLOON', 310, 30, 160), L('FIRST LINE', 30, 30), L('SECOND LINE', 30, 60),
      L('NEXT PANEL', 30, 610), L('~~', 30, 700, 20, 20), L('BLURRY WORDS', 30, 640, 200, 20, 0.4),
    ];
    const r = groupLines(lines, shots, bubbles);
    expect(r.get('a')).toBe('FIRST LINE SECOND LINE SECOND BALLOON');
    expect(r.get('b')).toBe('NEXT PANEL'); // unreadable or doubtful lines are left out
  });
  it('compare pluriel et singulier, et D/P confondus par la lecture', async () => {
    const { ocrCanon } = await import('../src/engine/understand');
    expect(ocrCanon('guns')).toBe(ocrCanon('gun'));
    expect(ocrCanon('problems')).toBe(ocrCanon('problem'));
    expect(ocrCanon('panvers')).toBe(ocrCanon('danvers'));
    expect(ocrCanon('glass')).toBe('glass'); // a double s is not a plural
    expect(ocrCanon('was')).toBe('was');
  });
});
