import { update, useStore } from '../store';
import type { Shot } from '../types';
import { cameraAt } from '../engine/render';
import { FORMATS } from '../types';
import { seek } from '../engine/transport';
import { layoutShots } from '../engine/timeline';
import { Slider } from './Slider';

type Key = NonNullable<Shot['path']>[number];
const EASE_FR: Record<NonNullable<Key['ease']>, string> = { smooth: 'Doux', linear: 'Constant', in: 'Démarre lentement', out: 'Freine à l’arrivée' };

/**
 * Camera timeline: each key is a framing on the page at a moment of the shot,
 * with a pause and the curve of the move that leaves it. Every edit goes
 * through update() (undoable) and makes the shot the user's (the director
 * leaves it alone).
 */
export function CameraPathEditor({ shot }: { shot: Shot }) {
  const project = useStore((s) => s.project);
  const page = project.pages.find((p) => p.id === shot.pageId);
  if (!page) return null;
  const { w: W, h: H } = FORMATS[project.format];
  const keys = shot.path ?? [];
  const set = (path: Key[] | undefined) => update((p) => ({ ...p, shots: p.shots.map((s) => (s.id === shot.id ? { ...s, path, auto: undefined, why: 'trajectoire réglée à la main' } : s)) }), 'path');
  const patch = (i: number, k: Partial<Key>) => set(keys.map((x, j) => (j === i ? { ...x, ...k } : x)).sort((a, b) => a.t - b.t));
  const start = layoutShots(project).find((t) => t.shot.id === shot.id)?.start ?? 0;
  const preview = (t: number) => seek(start + t * shot.duration);

  if (!keys.length) {
    // any move becomes editable: its start and end framings as two keys
    const toPath = () => {
      const a = cameraAt(shot, 0, W / H, project.readingOrder === 'rtl'), b = cameraAt(shot, 1, W / H, project.readingOrder === 'rtl');
      set([{ t: 0, ...a, hold: 0.1 }, { t: 1, ...b }]);
    };
    return <button className="btn sm ghost" onClick={toPath} title="Transforme le mouvement actuel en trajectoire modifiable étape par étape">Modifier la trajectoire étape par étape</button>;
  }
  return (
    <div className="cam-editor">
      {keys.map((k, i) => (
        <div key={i} className="cam-key">
          <div className="cam-key-head">
            <b>Étape {i + 1}</b> · {(k.t * shot.duration).toFixed(1)} s
            <button className="link" onClick={() => preview(k.t)} title="Aller à ce moment dans l’aperçu">▶ voir</button>
            {keys.length > 2 && <button className="link" onClick={() => set(keys.filter((_, j) => j !== i))} title="Supprimer cette étape">supprimer</button>}
          </div>
          <Slider label="Moment" value={k.t} min={0} max={1} step={0.01} fmt={(v) => `${(v * shot.duration).toFixed(1)} s`} onChange={(v) => patch(i, { t: v })} />
          <Slider label="Pause" value={(k.hold ?? 0) * shot.duration} min={0} max={Math.max(0.1, shot.duration)} step={0.1} fmt={(v) => `${v.toFixed(1)} s`} onChange={(v) => patch(i, { hold: v / shot.duration })} />
          <Slider label="Horizontal" value={k.cx / page.width} min={0} max={1} step={0.005} fmt={(v) => `${Math.round(v * 100)} %`} onChange={(v) => patch(i, { cx: v * page.width })} />
          <Slider label="Vertical" value={k.cy / page.height} min={0} max={1} step={0.005} fmt={(v) => `${Math.round(v * 100)} %`} onChange={(v) => patch(i, { cy: v * page.height })} />
          <Slider label="Cadre (largeur)" value={k.vw / page.width} min={0.1} max={1.2} step={0.01} fmt={(v) => `${Math.round(v * 100)} % de la page`} onChange={(v) => patch(i, { vw: v * page.width })} />
          {i < keys.length - 1 && (
            <label className="field row"><span>Courbe du mouvement</span>
              <select value={k.ease ?? 'smooth'} onChange={(e) => patch(i, { ease: e.target.value as Key['ease'] })}>
                {Object.entries(EASE_FR).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          )}
        </div>
      ))}
      <div className="cam-actions">
        <button className="btn sm ghost" onClick={() => { const l = keys[keys.length - 1]; set([...keys.map((k) => (k === l ? { ...k, t: Math.min(k.t, 0.8) } : k)), { ...l, t: 1, hold: 0 }]); }}>Ajouter une étape</button>
        <button className="btn sm ghost" onClick={() => set(undefined)} title="Revenir au mouvement simple">Retirer la trajectoire</button>
      </div>
    </div>
  );
}
