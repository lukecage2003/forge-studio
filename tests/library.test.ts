import { describe, expect, it } from 'vitest';
import { issueOf, entriesFrom, searchText, duplicates, clipQuery } from '../src/lib/mediaLibrary';
import { newProject, newShot } from '../src/store';

describe('médiathèque', () => {
  it('lit série, numéro et année dans le nom du fichier, sans inventer', () => {
    expect(issueOf('The Ultimates (2015) 001.pdf')).toEqual({ series: 'The Ultimates', issue: '1', year: '2015' });
    expect(issueOf('Before_Watchmen_Dr._Manhattan_Issue_3.pdf')).toMatchObject({ series: 'Before Watchmen Dr. Manhattan', issue: '3' });
    expect(issueOf('scan-page.jpg')).toEqual({ series: 'scan-page', issue: undefined, year: undefined });
    expect(issueOf(undefined)).toEqual({});
  });
  it('rassemble les médias de tous les projets : provenance, usage, texte des bulles', () => {
    const a = newProject(), b = newProject();
    const pa = { ...a, name: 'Galactus', pages: [{ id: 'p1', mediaId: 'm1', name: 'page 1', width: 10, height: 15, source: 'The Ultimates (2015) 001.pdf', srcIndex: 3, kind: 'story' } as never], aroll: { mediaId: 'v1', name: 'rush' } as never };
    pa.shots = [{ ...newShot(pa, { pageId: 'p1' }), text: 'OBEY! THE DEVOURER', chars: ['Galactus'] }];
    const pb = { ...b, name: 'Black Panther', pages: [{ id: 'q1', mediaId: 'm1', name: 'page 1', width: 10, height: 15 } as never] };
    const es = entriesFrom([{ project: pa, savedAt: '2026-11-20' }, { project: pb, savedAt: '2026-11-21' }]);
    const m1 = es.find((e) => e.id === 'm1')!;
    expect(m1.projects.map((p) => p.name)).toEqual(['Galactus', 'Black Panther']);
    expect(m1).toMatchObject({ series: 'The Ultimates', issue: '1', srcIndex: 3, shots: 1, pageKind: 'story' });
    expect(m1.chars).toEqual(['Galactus']);
    expect(es.find((e) => e.id === 'v1')?.kind).toBe('video');
  });
  it('cherche par mots, et un mot français trouve son équivalent anglais dans les bulles', () => {
    const es = [
      { id: 'a', kind: 'image', name: 'p1', projects: [], shots: 0, text: 'OBEY THE DEVOURER OF WORLDS', chars: [] },
      { id: 'b', kind: 'image', name: 'p2', projects: [], shots: 0, text: 'WELCOME TO THE TRISKELION', chars: ['Black Panther'] },
    ] as never;
    expect(searchText(es, 'obéissez')[0].e.id).toBe('a');
    expect(searchText(es, 'panther')[0].e.id).toBe('b');
    expect(searchText(es, 'zzz')).toEqual([]);
    expect(searchText(es, 'obey triskelion')).toEqual([]); // every word must match
  });
  it('trouve les doublons par empreinte (même page importée deux fois)', () => {
    const es = [
      { id: 'a', kind: 'image', hash: '1111000011110000111100001111000011110000111100001111000011110000', width: 10, height: 15 },
      { id: 'b', kind: 'image', hash: '1111000011110000111100001111000011110000111100001111000011110001', width: 10, height: 15 },
      { id: 'c', kind: 'image', hash: '0000111100001111000011110000111100001111000011110000111100001111', width: 10, height: 15 },
      // flat pictures: their fingerprints say nothing, never called duplicates
      { id: 'd', kind: 'image', hash: '0'.repeat(64), width: 10, height: 15 },
      { id: 'e', kind: 'image', hash: '0'.repeat(64), width: 10, height: 15 },
    ] as never;
    expect(duplicates(es).map((g) => g.map((x: { id: string }) => x.id))).toEqual([['a', 'b']]);
  });
  it('traduit une description française pour le modèle image ↔ texte', () => {
    expect(clipQuery('géant violet qui mange la terre')).toBe('giant purple eating earth');
    expect(clipQuery('Black Panther dans un vaisseau')).toBe('Black Panther spaceship');
  });
});
