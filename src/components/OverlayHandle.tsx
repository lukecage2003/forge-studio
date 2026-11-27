import { useStore } from '../store';
import { getState, setUI } from '../store';
import { patchOverlay } from '../actions';
import { overlayRect, toNBox } from '../engine/overlays';
import type { NBox } from '../types';

/**
 * The selected overlay's frame over the preview: drag it to place it freely,
 * drag the corner to resize it. The first drag turns its place into « Libre »
 * from where it was. With « régler la fin », the drag sets where it ends: it
 * then moves between the two over its life. Every drag is one undo step.
 */
export function OverlayHandle({ W, H, scale }: { W: number; H: number; scale: number }) {
  const sel = useStore((s) => s.ui.selection);
  const t = useStore((s) => s.ui.playhead);
  const editEnd = useStore((s) => !!s.ui.overlayEditEnd);
  const project = useStore((s) => s.project);
  const o = sel?.kind === 'overlay' ? project.overlays?.find((x) => x.id === sel.id) : undefined;
  if (!o) return null;
  // shown at the playhead when the overlay is on screen, else at its start (or its end when setting the end)
  const at = editEnd && o.place === 'free' ? o.start + o.duration : t >= o.start && t < o.start + o.duration ? t : o.start;
  const b = editEnd && o.place === 'free' && o.boxEnd ? { x: o.boxEnd.x * W, y: o.boxEnd.y * H, w: o.boxEnd.w * W, h: o.boxEnd.h * H } : overlayRect(project, o, at, W, H);
  const down = (e: React.PointerEvent, resize: boolean) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, y0 = e.clientY, start = { ...b };
    const key = `ovbox-${o.id}-${Date.now()}`;
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / scale, dy = (ev.clientY - y0) / scale;
      const nb = resize
        ? { ...start, w: Math.max(W * 0.08, start.w + dx), h: Math.max(H * 0.05, start.h + dy) }
        : { ...start, x: Math.min(W - 20, Math.max(20 - start.w, start.x + dx)), y: Math.min(H - 20, Math.max(20 - start.h, start.y + dy)) };
      const n: NBox = toNBox(nb, W, H);
      const cur = getState().project.overlays?.find((x) => x.id === o.id);
      if (!cur) return;
      if (editEnd && cur.place === 'free') patchOverlay(o.id, { boxEnd: n }, key);
      else patchOverlay(o.id, { place: 'free', box: n }, key);
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  return (
    <div className={`ov-handle${editEnd && o.place === 'free' ? ' end' : ''}`} style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale }}
      onPointerDown={(e) => down(e, false)} title={editEnd ? 'Position de fin du calque' : 'Glisser pour placer le calque'}
      onDoubleClick={() => setUI({ overlayEditEnd: false })}>
      <span className="ov-handle-tag">{editEnd && o.place === 'free' ? 'Fin' : 'Calque'}</span>
      <div className="ov-handle-corner" onPointerDown={(e) => down(e, true)} aria-label="Redimensionner" />
    </div>
  );
}
