import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { setConsentAsker } from '../ai/orchestrator';
import { INFO } from '../ai/providers';
import type { ProviderId } from '../ai/types';
import { setConfig } from '../ai/config';

/**
 * Privacy Manager, on screen: the first time a kind of data (text, audio,
 * images) would go to an outside service, Forge says what, to whom and on
 * which terms, and waits for a yes.
 */
export function ConsentDialog() {
  const [ask, setAsk] = useState<{ p: ProviderId; data: string[]; done: (ok: boolean) => void } | null>(null);
  useEffect(() => {
    setConsentAsker((p, data) => new Promise<boolean>((done) => setAsk({ p, data, done })));
    return () => setConsentAsker(async () => false);
  }, []);
  if (!ask) return null;
  const i = INFO[ask.p];
  const answer = (ok: boolean) => { ask.done(ok); setAsk(null); };
  return (
    <div className="modal-back consent-back">
      <div className="modal consent" role="alertdialog" aria-labelledby="cs-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><ShieldAlert size={18} /></span>
            <div><h2 id="cs-title">Envoyer à {i.label} ?</h2><p>Première fois que Forge enverrait ces données à ce service.</p></div>
          </div>
        </header>
        <p>Ce qui partirait : <b>{ask.data.join(', ')}</b> de ton projet.</p>
        <p className="help">{i.privacy}</p>
        <p className="help">{i.free}</p>
        <div className="row-btns gap">
          <button className="btn primary" onClick={() => answer(true)}>Autoriser pour {i.label}</button>
          <button className="btn" onClick={() => answer(false)}>Refuser</button>
          <button className="btn ghost" onClick={() => { setConfig({ localOnly: true }); answer(false); }}>Tout garder en local</button>
        </div>
      </div>
    </div>
  );
}
