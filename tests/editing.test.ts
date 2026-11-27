import { describe, expect, it } from 'vitest';

(globalThis as { window?: unknown }).window ??= globalThis;
const st = await import('../src/store');
const A = await import('../src/actions');
import type { Overlay } from '../src/types';

const ov = (o: Partial<Overlay> = {}): Overlay => ({ id: 'o1', track: 1, start: 2, duration: 4, source: { kind: 'video', mediaId: 'v', offset: 1, sourceDuration: 20, width: 2, height: 2 }, place: 'full', zoom: 0, fade: 0, ...o });

describe('montage précis au curseur', () => {
  it('S coupe un calque vidéo en deux : la 2e moitié reprend la vidéo où la 1re s’arrête', () => {
    st.loadProject({ ...st.newProject(), overlays: [ov()] });
    st.setUI({ playhead: 3.5, selection: { kind: 'overlay', id: 'o1' } });
    expect(A.splitAtPlayhead()).toBe(true);
    const [a, b] = st.getState().project.overlays!;
    expect(a.duration).toBeCloseTo(1.5);
    expect(b.start).toBe(3.5);
    expect(b.duration).toBeCloseTo(2.5);
    expect((b.source as { offset: number }).offset).toBeCloseTo(2.5);
    st.undo();
    expect(st.getState().project.overlays).toHaveLength(1);
  });
  it('S coupe un plan : deux plans dont les durées font l’original', () => {
    const p = st.newProject();
    st.loadProject({ ...p, shots: [st.newShot(p, { id: 's1', duration: 4 }), st.newShot(p, { id: 's2', duration: 2 })] });
    st.setUI({ playhead: 1, selection: { kind: 'shot', id: 's1' } });
    expect(A.splitAtPlayhead()).toBe(true);
    const sh = st.getState().project.shots;
    expect(sh.map((x) => +x.duration.toFixed(2))).toEqual([1, 3, 2]);
    expect(sh[1].transition).toBe('cut');
  });
  it('[ et ] : début et fin au curseur ; un curseur hors de l’élément ne coupe rien', () => {
    st.loadProject({ ...st.newProject(), overlays: [ov()] });
    st.setUI({ playhead: 3, selection: { kind: 'overlay', id: 'o1' } });
    expect(A.trimToPlayhead('start')).toBe(true);
    let o = st.getState().project.overlays![0];
    expect([o.start, o.duration, (o.source as { offset: number }).offset]).toEqual([3, 3, 2]);
    st.setUI({ playhead: 5 });
    expect(A.trimToPlayhead('end')).toBe(true);
    o = st.getState().project.overlays![0];
    expect([o.start, o.duration]).toEqual([3, 2]);
    st.setUI({ playhead: 10 });
    expect(A.splitAtPlayhead()).toBe(false);
  });
});
