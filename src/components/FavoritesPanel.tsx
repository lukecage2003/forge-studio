import { useEffect, useRef, useState } from 'react';
import { getState, update } from '../store';
import { FAV_FR, applySubtitles, applyToShot, capture, exportFavorites, favorites, importFavorites, onFavorites, removeFavorite, saveFavorite, type FavKind, type Favorite } from '../engine/favorites';
import { applyArt, type ArtMix } from '../engine/styles';
import { toast } from './Toast';

/** save / reuse the user's own presets. `shotId` for shot-level kinds (animation, transition). */
export function FavoritesPanel({ kinds, shotId }: { kinds: FavKind[]; shotId?: string }) {
  const [, setV] = useState(0);
  useEffect(() => onFavorites(() => setV((x) => x + 1)), []);
  const file = useRef<HTMLInputElement>(null);

  const save = (kind: FavKind) => {
    const p = getState().project, s = shotId ? p.shots.find((x) => x.id === shotId) : undefined;
    const name = window.prompt(`Nom du favori (${FAV_FR[kind].toLowerCase()}) :`, '');
    if (name == null) return;
    if (kind === 'art') { const a = capture.art(p); if (!a) { toast('Choisis d’abord une direction artistique.', 'error'); return; } saveFavorite('art', name, a); }
    else if (kind === 'subtitles') saveFavorite('subtitles', name, capture.subtitles(p));
    else if (kind === 'animation' && s) saveFavorite('animation', name, capture.animation(s));
    else if (kind === 'transition' && s) saveFavorite('transition', name, capture.transition(s));
    toast(`Favori enregistré : ${name || FAV_FR[kind]}`);
  };
  const apply = (f: Favorite) => {
    if (f.kind === 'art') update((p) => applyArt(p, f.data as ArtMix), 'fav');
    else if (f.kind === 'subtitles') update((p) => applySubtitles(p, f as Favorite<'subtitles'>), 'fav');
    else if (shotId) update((p) => ({ ...p, shots: p.shots.map((s) => (s.id === shotId ? applyToShot(s, f) : s)) }), 'fav');
    toast(`Favori appliqué : ${f.name}`);
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(exportFavorites());
    a.download = 'forge-favoris.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <div className="favorites">
      {kinds.map((k) => (
        <div key={k} className="fav-kind">
          <div className="fav-head">
            <span>★ {FAV_FR[k]}</span>
            <button className="btn sm ghost" onClick={() => save(k)} title="Enregistrer le réglage actuel comme favori, réutilisable dans tous tes projets">Enregistrer</button>
          </div>
          <div className="fav-list">
            {favorites(k).map((f) => (
              <span key={f.id} className="chip fav">
                <button className="link" onClick={() => apply(f)} title="Appliquer">{f.name}</button>
                <button className="link x" onClick={() => removeFavorite(f.id)} title="Supprimer ce favori">×</button>
              </span>
            ))}
            {!favorites(k).length && <small className="hint">aucun pour l’instant</small>}
          </div>
        </div>
      ))}
      {!shotId && (
        <div className="fav-io">
          <button className="btn sm ghost" onClick={download}>Exporter mes favoris</button>
          <button className="btn sm ghost" onClick={() => file.current?.click()}>Importer</button>
          <input ref={file} type="file" accept="application/json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            try { toast(`${await importFavorites(f)} favori(s) importé(s)`); } catch { toast('Fichier de favoris illisible.', 'error'); }
            e.target.value = '';
          }} />
        </div>
      )}
    </div>
  );
}
