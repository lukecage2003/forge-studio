import { useEffect, useState } from 'react';
import { Brain, KeyRound, Loader2, Settings2, X, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { DEFAULT_MODEL, getGoogle, setGoogle, testGoogle } from '../engine/google';
import { brain, brainSummary, onBrain, resetBrain } from '../engine/brain';
import { setUI } from '../store';
import { toast } from './Toast';

export function SettingsModal() {
  const [g, setG] = useState(getGoogle());
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<'idle' | 'busy' | 'ok' | string>('idle');
  const [, bump] = useState(0);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => onBrain(() => bump((x) => x + 1)), []);
  const close = () => setUI({ settingsOpen: false });
  const save = () => { setGoogle(g); toast('Réglages Google enregistrés dans ce navigateur'); };
  const runTest = async () => {
    setGoogle(g);
    setTest('busy');
    try {
      await testGoogle();
      setTest('ok');
    } catch (e) {
      setTest((e as Error).message);
    }
  };
  const b = brain();
  const learned = brainSummary();

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal settings-modal" role="dialog" aria-labelledby="set-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><Settings2 size={18} /></span>
            <div><h2 id="set-title">Réglages</h2><p>Google AI et l’apprentissage de Forge.</p></div>
          </div>
          <button className="icon-btn ghost" onClick={close} aria-label="Fermer"><X size={18} /></button>
        </header>

        <section className="set-section">
          <h3><KeyRound size={15} /> Google AI (Gemini)</h3>
          <p className="help">
            Optionnel. Avec une clé Gemini, Forge transcrit ton rush mot à mot <b>en gardant les « euh »</b> pour mieux les couper,
            place chaque case sur la phrase qu’elle illustre et propose des accroches. Crée une clé gratuite sur
            <b> aistudio.google.com</b> → « Get API key ». La clé reste dans ce navigateur et les appels partent directement vers Google.
          </p>
          <div className="field">
            <label htmlFor="gkey">Clé API</label>
            <div className="key-row">
              <input id="gkey" className="input" type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false}
                placeholder="AIza…" value={g.apiKey} onChange={(e) => { setG({ ...g, apiKey: e.target.value.trim() }); setTest('idle'); }} />
              <button className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Masquer' : 'Afficher'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
            </div>
          </div>
          <div className="two-col">
            <div className="field">
              <label htmlFor="gmodel">Modèle</label>
              <input id="gmodel" className="input" value={g.model} onChange={(e) => setG({ ...g, model: e.target.value.trim() || DEFAULT_MODEL })} />
            </div>
            <div className="field">
              <label htmlFor="glang">Langue des vidéos</label>
              <select id="glang" className="input" value={g.language} onChange={(e) => setG({ ...g, language: e.target.value })}>
                <option value="fr">Français</option>
                <option value="en">Anglais</option>
              </select>
            </div>
          </div>
          <div className="row-btns gap">
            <button className="btn sm" onClick={runTest} disabled={!g.apiKey || test === 'busy'}>
              {test === 'busy' ? <Loader2 size={14} className="spin" /> : null} Tester la connexion
            </button>
            <button className="btn sm primary" onClick={save}>Enregistrer</button>
            {test === 'ok' && <span className="ok-text"><CheckCircle2 size={14} /> Connecté à Google</span>}
          </div>
          {test !== 'idle' && test !== 'ok' && test !== 'busy' && <p className="error-box">{test}</p>}
        </section>

        <section className="set-section">
          <h3><Brain size={15} /> Forge apprend de toi</h3>
          <p className="help">
            Chaque fois que tu corriges une décision du montage auto (durée d’un plan, mise en page, mouvement, une coupe rétablie
            ou ajoutée), Forge ajuste ses préférences. Le montage suivant part de ce qu’il a appris. Tout reste sur cet ordinateur.
          </p>
          <div className="brain-stats">
            <div><b>{b.montages}</b><span>montages auto</span></div>
            <div><b>{b.edits}</b><span>corrections apprises</span></div>
          </div>
          {learned.length ? (
            <ul className="learned">{learned.map((l) => <li key={l}>{l}</li>)}</ul>
          ) : (
            <p className="muted">Rien d’appris pour l’instant : lance un montage auto puis corrige ce qui ne te plaît pas.</p>
          )}
          {confirmReset ? (
            <div className="row-btns gap">
              <span className="muted">Effacer tout ce que Forge a appris ?</span>
              <button className="btn sm" onClick={() => { resetBrain(); setConfirmReset(false); toast('Apprentissage remis à zéro'); }}>Oui, effacer</button>
              <button className="btn sm ghost" onClick={() => setConfirmReset(false)}>Annuler</button>
            </div>
          ) : (
            <button className="btn sm ghost" onClick={() => setConfirmReset(true)}>Remettre à zéro</button>
          )}
        </section>
      </div>
    </div>
  );
}
