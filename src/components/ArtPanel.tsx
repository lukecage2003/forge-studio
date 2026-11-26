import { update, useStore } from '../store';
import { COMPONENTS, COMPONENT_FR, STYLE, STYLES, applyArt, resolveArt, type ArtMix, type Component, type StyleId } from '../engine/styles';
import { toast } from './Toast';

/**
 * Art direction: one base direction, and any of its nine components taken from
 * another one (typography of one, transitions of another…). Applied through
 * update(), so it is undoable; the auto editor and the renderer read it.
 */
export function ArtPanel() {
  const art = useStore((s) => s.project.art) as ArtMix | undefined;
  const base: StyleId = (art?.base as StyleId) ?? 'comic';
  const set = (m: ArtMix) => { update((p) => applyArt(p, m), 'art'); toast(`Direction artistique : ${resolveArt(m).label}`); };
  const cur = art ? resolveArt(art) : null;
  return (
    <div className="art-panel">
      <label className="field">
        <span>Direction artistique</span>
        <select value={art ? base : ''} onChange={(e) => e.target.value && set({ base: e.target.value as StyleId })}>
          {!art && <option value="">— choisir —</option>}
          {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </label>
      {cur && <p className="hint">{STYLE[base].desc}</p>}
      {art && (
        <details>
          <summary>Mélanger : prendre une composante d’une autre direction</summary>
          {COMPONENTS.map((k: Component) => (
            <label key={k} className="field row">
              <span>{COMPONENT_FR[k]}</span>
              <select value={art.from?.[k] ?? base} onChange={(e) => set({ ...art, from: { ...art.from, [k]: e.target.value as StyleId } })}>
                {STYLES.map((s) => <option key={s.id} value={s.id}>{s.id === base ? `${s.label} (base)` : s.label}</option>)}
              </select>
            </label>
          ))}
        </details>
      )}
    </div>
  );
}
