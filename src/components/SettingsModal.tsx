import { useEffect, useState } from 'react';
import { Brain, KeyRound, Loader2, Settings2, X, CheckCircle2, Eye, EyeOff } from 'lucide-react';
import { DEFAULT_MODEL, getGoogle, setGoogle, testGoogle } from '../engine/google';
import { activeScope, brainAt, brainSummary, canUndoReset, currentScope, onBrain, resetBrain, undoReset, type BrainScope } from '../engine/brain';
import { setUI } from '../store';
import { hasKey, keyOf, masked, removeKey } from '../ai/vault';
import { clearJournal, journal } from '../lib/errors';
import { toast } from './Toast';
import { download } from '../lib/util';
import { APP_VERSION as APP_BUILD } from '../lib/schema';
import { Gauge } from 'lucide-react';
import { lastBench, type BenchResult } from '../engine/bench';

export function SettingsModal() {
  const [g, setG] = useState({ ...getGoogle(), apiKey: '' });
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<'idle' | 'busy' | 'ok' | string>('idle');
  const [, bump] = useState(0);
  const [confirmReset, setConfirmReset] = useState<BrainScope | null>(null);
  useEffect(() => onBrain(() => bump((x) => x + 1)), []);
  const close = () => setUI({ settingsOpen: false });
  const clean = () => ({ ...g, apiKey: g.apiKey.startsWith('new:') ? g.apiKey.slice(4) : keyOf('gemini') ?? '' });
  const save = () => { setGoogle(clean()); setG({ ...clean(), apiKey: '' }); toast('Réglages Google enregistrés (clé chiffrée)'); };
  const runTest = async () => {
    setGoogle(clean());
    setTest('busy');
    try {
      await testGoogle();
      setTest('ok');
    } catch (e) {
      setTest((e as Error).message);
    }
  };
  const scopes: { id: BrainScope; label: string }[] = [
    { id: 'project', label: 'Ce projet' },
    { id: 'format', label: `Format ${currentScope().format}` },
    { id: 'general', label: 'Général' },
  ];
  const active = activeScope();

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal settings-modal" role="dialog" aria-labelledby="set-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><Settings2 size={18} /></span>
            <div><h2 id="set-title">Réglages</h2><p>Google AI, performance et apprentissage de Forge.</p></div>
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
            <label htmlFor="gkey">Clé API (chiffrée, jamais réaffichée)</label>
            <div className="key-row">
              {hasKey('gemini') && !g.apiKey.startsWith('new:') ? (
                <>
                  <span className="key-masked">{masked('gemini')}</span>
                  <button className="btn sm ghost" onClick={() => { void removeKey('gemini').then(() => { setG({ ...g, apiKey: '' }); setTest('idle'); }); }}>Supprimer la clé</button>
                </>
              ) : (
                <>
                  <input id="gkey" className="input" type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false}
                    placeholder="AIza…" value={g.apiKey.replace(/^new:/, '')} onChange={(e) => { setG({ ...g, apiKey: 'new:' + e.target.value.trim() }); setTest('idle'); }} />
                  <button className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? 'Masquer' : 'Afficher'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                </>
              )}
            </div>
            <button className="link-btn" onClick={() => setUI({ settingsOpen: false, aiOpen: true })}>Toutes les IA (Groq, OpenRouter, Agnes, local…) : centre de contrôle IA</button>
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
            <button className="btn sm" onClick={runTest} disabled={(!g.apiKey && !hasKey('gemini')) || test === 'busy'}>
              {test === 'busy' ? <Loader2 size={14} className="spin" /> : null} Tester la connexion
            </button>
            <button className="btn sm primary" onClick={save}>Enregistrer</button>
            {test === 'ok' && <span className="ok-text"><CheckCircle2 size={14} /> Connecté à Google</span>}
          </div>
          {test !== 'idle' && test !== 'ok' && test !== 'busy' && <p className="error-box">{test}</p>}
        </section>

        <BenchSection />

        <section className="set-section">
          <h3>Journal des erreurs</h3>
          {journal().length ? (
            <>
              <p className="help">Les problèmes rencontrés sont évités et notés ici. Copie ce journal si tu veux me le transmettre.</p>
              <pre className="journal">{journal().slice(0, 8).map((e) => `${e.t.slice(0, 19).replace('T', ' ')} · ${e.where} · ${e.message}`).join('\n')}</pre>
              <div className="row-btns gap">
                <button className="btn sm" onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(journal(), null, 1)).then(() => toast('Journal copié')).catch(() => {}); }}>Copier le journal</button>
                <button className="btn sm ghost" onClick={() => { clearJournal(); bump((x) => x + 1); }}>Vider</button>
              </div>
            </>
          ) : <p className="muted">Aucune erreur enregistrée.</p>}
        </section>

        <section className="set-section">
          <h3><Brain size={15} /> Forge apprend de toi</h3>
          <p className="help">
            Chaque fois que tu corriges une décision du montage auto (durée d’un plan, mise en page, mouvement, une coupe rétablie
            ou ajoutée), Forge ajuste ses préférences. Le montage suivant part de ce qu’il a appris. Tout reste sur cet ordinateur.
          </p>
          <p className="help">Trois niveaux : ce projet, le format de la vidéo, et en général. Le montage auto utilise le plus précis qui a vu au moins 5 corrections.</p>
          {scopes.map((sc) => {
            const b = brainAt(sc.id);
            const learned = brainSummary(sc.id);
            return (
              <div key={sc.id} className={`brain-scope${active === sc.id ? ' on' : ''}`} aria-label={`Préférences : ${sc.label}`}>
                <div className="brain-scope-head">
                  <b>{sc.label}</b>
                  {active === sc.id && <span className="pill">utilisé maintenant</span>}
                  <span className="muted">{b.edits} correction{b.edits > 1 ? 's' : ''} · {b.montages} montage{b.montages > 1 ? 's' : ''} auto</span>
                  {b.edits > 0 && (confirmReset === sc.id
                    ? <><button className="btn sm" onClick={() => { resetBrain(sc.id); setConfirmReset(null); toast(`Préférences « ${sc.label} » effacées — tu peux annuler`); }}>Oui, effacer</button><button className="btn sm ghost" onClick={() => setConfirmReset(null)}>Non</button></>
                    : <button className="btn sm ghost" onClick={() => setConfirmReset(sc.id)}>Effacer</button>)}
                </div>
                {learned.length ? <ul className="learned">{learned.map((l) => <li key={l}>{l}</li>)}</ul> : <p className="muted">Rien d’appris à ce niveau.</p>}
              </div>
            );
          })}
          {canUndoReset() && <button className="btn sm ghost" onClick={() => toast(undoReset() ? 'Effacement annulé : préférences rétablies' : 'Rien à rétablir', 'info')}>Annuler le dernier effacement</button>}
        </section>
      </div>
    </div>
  );
}

/** a plain-text report of this computer for Forge: measures, hardware, browser, room left; nothing is sent */
async function pcReport(r: BenchResult): Promise<string> {
  const { detectHardware, devicesInUse } = await import('../engine/hardware');
  const h = await detectHardware().catch(() => null);
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const go = (b?: number) => (b == null ? '?' : `${(b / 1e9).toFixed(1)} Go`);
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'autre';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'autre';
  const ms = (v: number | null) => (v == null ? 'indisponible' : `${Math.round(v)} ms`);
  return [
    'FORGE — DIAGNOSTIC DE CET ORDINATEUR', `Date : ${new Date().toLocaleString('fr-FR')}`, `Version de Forge : ${APP_BUILD}`, '',
    `Système : ${os} · navigateur : ${browser}`,
    `Processeurs : ${r.cores || '?'} · mémoire annoncée : ${r.memoryGb ?? '?'} Go`,
    `Carte graphique : ${h?.gpu || 'inconnue'} · WebGPU : ${r.webgpu ? 'oui' : 'non'} · WebGL : ${r.webgl ? 'oui' : 'non'} · niveau : ${h?.tier ?? '?'}`,
    `Stockage du navigateur : ${go(est?.usage)} utilisés sur ${go(est?.quota)} disponibles`, '',
    `Image 1080p : ${ms(r.frame1080)} · image 4K : ${ms(r.frame4k)} · transition GPU : ${ms(r.frameGl)} · 3D : ${ms(r.frame3d)}`,
    `Export : ${r.exportFactor == null ? 'impossible' : `${r.exportFactor.toFixed(2)} × la durée de la vidéo`}`,
    `Encodeurs : H.264 ${r.h264 ? 'oui' : 'non'} · H.264 4K ${r.h264_4k ? 'oui' : 'non'} · AAC ${r.aac ? 'oui' : 'non'}`,
    `Aperçu : ${r.previewFps} images/s`, '',
    'Carte graphique utilisée par (moteurs déjà lancés pendant cette session) :',
    ...(devicesInUse().length ? devicesInUse().map(([e, d]) => `- ${e} : ${d === 'webgpu' ? 'carte graphique' : 'processeur'}`) : ['- aucun moteur d’IA locale lancé pour l’instant : importe des planches ou lance une transcription, puis refais le rapport']),
    `- Export vidéo : encodeur ${r.h264 ? 'H.264 disponible' : 'H.264 absent'} (l’encodeur de la carte graphique est demandé en priorité)`, '', 'Conseils :', ...r.verdict.map((v) => `- ${v}`), '',
    'Ce rapport reste sur ton ordinateur : Forge n’envoie rien.',
  ].join('\n');
}

function BenchSection() {
  const [r, setR] = useState<BenchResult | null>(lastBench());
  const [run, setRun] = useState<{ label: string; p: number } | null>(null);
  const start = async () => {
    setRun({ label: 'Préparation…', p: 0 });
    try {
      const { runBench } = await import('../engine/bench');
      setR(await runBench((label, p) => setRun({ label, p })));
    } catch (e) { toast('Mesure impossible : ' + (e as Error).message, 'error'); }
    setRun(null);
  };
  const ms = (v: number | null) => (v == null ? 'indisponible' : `${Math.round(v)} ms`);
  return (
    <section className="set-section">
      <h3><Gauge size={15} /> Performance de cet ordinateur</h3>
      <p className="help">Forge mesure le rendu, les transitions GPU, la 3D et un vrai export MP4 de 3 s, sur des pages de test. Ton projet n’est pas touché. Moins d’une minute.</p>
      {run ? (
        <div className="progress-wrap">
          <div className="progress"><div style={{ width: `${run.p * 100}%` }} /></div>
          <div className="progress-label"><Loader2 size={15} className="spin" /><span>{run.label}</span></div>
        </div>
      ) : <button className="btn sm" onClick={start}>{r ? 'Mesurer à nouveau' : 'Mesurer'}</button>}
      {r && !run && (
        <>
          <ul className="learned">{r.verdict.map((v) => <li key={v}>{v}</li>)}</ul>
          <table className="bench">
            <tbody>
              <tr><td>Image 1080p</td><td>{ms(r.frame1080)}</td></tr>
              <tr><td>Image 4K</td><td>{ms(r.frame4k)}</td></tr>
              <tr><td>Transition GPU</td><td>{ms(r.frameGl)}</td></tr>
              <tr><td>Scène 3D</td><td>{ms(r.frame3d)}</td></tr>
              <tr><td>Export (temps / durée vidéo)</td><td>{r.exportFactor == null ? 'impossible' : `× ${r.exportFactor.toFixed(2).replace('.', ',')}`}</td></tr>
              <tr><td>Encodeur H.264 · 4K · AAC</td><td>{[r.h264, r.h264_4k, r.aac].map((x) => (x ? 'oui' : 'non')).join(' · ')}</td></tr>
              <tr><td>Processeurs · WebGL · WebGPU</td><td>{r.cores || '?'} · {r.webgl ? 'oui' : 'non'} · {r.webgpu ? 'oui' : 'non'}</td></tr>
            </tbody>
          </table>
          <p className="muted">Mesuré le {new Date(r.date).toLocaleString('fr-FR')}.</p>
          <button className="btn sm ghost" onClick={() => void pcReport(r).then((txt) => { void navigator.clipboard?.writeText(txt).catch(() => {}); download(new Blob([txt], { type: 'text/plain' }), 'forge-diagnostic.txt'); toast('Rapport copié et enregistré (forge-diagnostic.txt) : rien n’est envoyé'); })}>Rapport « mon PC » (copier et enregistrer)</button>
        </>
      )}
    </section>
  );
}
