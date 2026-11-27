import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { dismissStale, newerBuild, onStale, reloadNow, staleState } from '../lib/staleVersion';

/**
 * Part of the main bundle on purpose: it must still work when the other files
 * of this version are gone from the server.
 * - a newer Forge was published: a discreet bar, the user reloads when ready;
 * - a window could not load its file: a dialog with a controlled reload (saved first),
 *   or, when a reload already did not help, the honest explanation instead of a loop.
 */
export function StaleVersion() {
  const [, bump] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => onStale(() => bump((x) => x + 1)), []);
  const st = staleState();
  const go = async () => { setBusy(true); await reloadNow(); };
  if (st) {
    return (
      <div className="modal-back stale-back" role="alertdialog" aria-labelledby="stale-title" aria-describedby="stale-text">
        <div className="modal stale-modal">
          <h2 id="stale-title">{st.afterReload ? 'Fichier introuvable sur le serveur' : 'Forge a été mis à jour'}</h2>
          {st.afterReload ? (
            <p id="stale-text">Même après le rechargement, le fichier {st.file ? <code>{st.file}</code> : 'demandé'} n’est pas disponible : la publication est peut-être encore en cours. Ton projet est enregistré. Réessaie dans quelques minutes.</p>
          ) : (
            <p id="stale-text">Une nouvelle version de Forge a été publiée pendant que cette page était ouverte, et cette fenêtre fait partie de l’ancienne. Recharge pour passer à la nouvelle version : ton projet est enregistré avant, rien n’est perdu.</p>
          )}
          <div className="stale-actions">
            {!st.afterReload && <button className="btn primary" disabled={busy} onClick={() => void go()}><RefreshCw size={15} className={busy ? 'spin' : ''} /> Enregistrer et recharger</button>}
            <button className="btn ghost" onClick={dismissStale}>{st.afterReload ? 'Fermer' : 'Plus tard'}</button>
          </div>
        </div>
      </div>
    );
  }
  if (newerBuild()) {
    return (
      <div className="update-bar" role="status">
        <span>Une nouvelle version de Forge est disponible.</span>
        <button className="btn sm primary" disabled={busy} onClick={() => void go()}><RefreshCw size={13} className={busy ? 'spin' : ''} /> Enregistrer et recharger</button>
      </div>
    );
  }
  return null;
}
