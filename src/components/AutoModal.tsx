import { useState } from 'react';
import { Wand2, X, Zap, Film, BookOpen, Loader2, Mic2, GraduationCap, Sparkles } from 'lucide-react';
import { PROFILE, PROFILES, type ProfileId } from '../engine/direction';
import { MODELS, type ProductionModel } from '../engine/auto';
import { autoMontage, panelThumb, sentencesOf, STYLES, timelineWords, type AutoLength, type AutoStyle } from '../engine/auto';
import { geminiHooks, geminiMatchPanels, hasGoogle } from '../engine/google';
import { getState, setUI, update, useStore } from '../store';
import { aiRecut, analyzeComics, prepareMotion, researchComics } from '../actions';
import { narration } from '../engine/narration';
import { toast } from './Toast';
import { FORMATS } from '../types';

const ICONS = { explainer: GraduationCap, energetic: Mic2, dynamic: Zap, cinematic: Film, manga: BookOpen };
const LENGTHS: { v: AutoLength; l: string }[] = [
  { v: 'auto', l: 'Auto' }, { v: 'voice', l: 'Suivre la voix' }, { v: 15, l: '15 s' }, { v: 30, l: '30 s' },
  { v: 60, l: '1 min' }, { v: 90, l: '90 s' }, { v: 120, l: '2 min' }, { v: 180, l: '3 min' }, { v: 240, l: '4 min' }, { v: 300, l: '5 min' },
];

export function AutoModal({ onClose }: { onClose: () => void }) {
  const format = useStore((s) => s.project.format);
  const hasFace = useStore((s) => !!s.project.aroll);
  // words to subtitle and match: a transcript, or the pasted script laid on the voice
  const hasWords = useStore((s) => !!s.project.aroll?.words.length || (!!s.project.aroll && !!s.project.script?.trim()));
  const hasVoice = useStore((s) => s.project.audio.some((a) => a.kind === 'voice'));
  const hasMusic = useStore((s) => s.project.audio.some((a) => a.kind === 'music'));
  const pages = useStore((s) => s.project.pages.length);
  const styles = (Object.keys(STYLES) as AutoStyle[]).filter((k) => STYLES[k].face === hasFace || (!hasFace && k === 'explainer'));
  const [style, setStyle] = useState<AutoStyle>(hasFace ? (format === '16:9' ? 'explainer' : 'energetic') : format === '16:9' ? 'cinematic' : 'dynamic');
  const [profile, setProfileState] = useState<ProfileId | null>(() => {
    try { const v = localStorage.getItem('forge.profile'); if (v === 'none') return null; if (v && v in PROFILE) return v as ProfileId; } catch { /* storage off */ }
    return 'premium';
  });
  const setProfile = (v: ProfileId | null) => { setProfileState(v); try { localStorage.setItem('forge.profile', v ?? 'none'); } catch { /* storage off */ } };
  const [model, setModel] = useState<ProductionModel>('face-comics');
  const pickModel = (m: ProductionModel) => { setModel(m); setProfile(MODELS[m].profile); };
  const [live, setLive] = useState(true);
  const [length, setLength] = useState<AutoLength>(hasVoice ? 'voice' : 'auto');
  const [hook, setHook] = useState('');
  const [hooks, setHooks] = useState<string[]>([]);
  const [redetect, setRedetect] = useState(false);
  const [beatSync, setBeatSync] = useState(true);
  // creative director: each kind of decision can be left to the editor (remembered)
  const [dir, setDir] = useState(() => { try { return { transitions: true, camera: true, sequences: true, ...JSON.parse(localStorage.getItem('forge-director') || '{}') }; } catch { return { transitions: true, camera: true, sequences: true }; } });
  const setD = (k: 'transitions' | 'camera' | 'sequences') => (v: boolean) => { const n = { ...dir, [k]: v }; setDir(n); try { localStorage.setItem('forge-director', JSON.stringify(n)); } catch { /* private mode */ } };
  const [captionStyle, setCaptionStyle] = useState(true);
  const [subtitles, setSubtitles] = useState(true);
  const [aiMatch, setAiMatch] = useState(hasGoogle() && hasWords);
  const unsure = useStore((s) => s.project.pages.filter((p) => p.cut === 'zones' && !p.skip).length);
  const [aiCut, setAiCut] = useState(hasGoogle() && unsure > 0);
  const [busy, setBusy] = useState<string | null>(null);
  const script0 = useStore((s) => s.project.script ?? '');
  const [script, setScript] = useState(script0);
  const hasVoiceWords = useStore((s) => !!s.project.aroll?.words.length || s.project.audio.some((a) => a.kind === 'voice' && !!a.words?.length));
  const [story, setStory] = useState<boolean>(hasVoiceWords || !!script0.trim());
  const [storyEngine, setStoryEngine] = useState<'local' | 'google'>(hasGoogle() ? 'google' : 'local');
  const google = hasGoogle();

  const suggest = async () => {
    setBusy('Google cherche des accroches…');
    try {
      const words = timelineWords(getState().project).map((w) => w.w).join(' ');
      setHooks(await geminiHooks(words));
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(null); }
  };

  const run = async () => {
    try {
      let matches: Record<string, number> | undefined;
      const { tagCharacters } = await import('../engine/lexicon');
      update((p) => tagCharacters({ ...p, script }));
      if (story && !narration({ ...getState().project, script }).sentences.length) {
        toast('Pour suivre la narration : transcris la voix (rush ou voix off) ou colle ton script.', 'error');
        return;
      }
      // read the comics first if nothing is known about the panels yet
      if (story && !getState().project.shots.some((x) => x.desc || x.text)) {
        setBusy(storyEngine === 'google' ? 'Google lit les comics…' : 'Lecture des bulles…');
        await analyzeComics(storyEngine);
      } else if (aiCut && google && unsure) { setBusy('Google recoupe les pages incertaines…'); await aiRecut(); }
      if (story && google && !getState().project.research) { setBusy('Recherche Google sur les comics…'); await researchComics(); }
      const p0 = getState().project;
      if (aiMatch && google && hasFace && hasWords) {
        setBusy('Google associe les cases au script…');
        const sentences = sentencesOf(timelineWords(p0));
        const panels = p0.shots.filter((s) => s.pageId).slice(0, 60).map((s) => ({ id: s.id, jpeg: panelThumb(p0, s.pageId!, s.rect, 320) }));
        if (panels.length && sentences.length) matches = await geminiMatchPanels(panels, sentences.map((s) => s.text));
      }
      setBusy('Montage en cours…');
      const { project, report } = await autoMontage(getState().project, { style: profile ? PROFILE[profile].base[hasFace ? 'face' : 'solo'] : style, profile: profile ?? undefined, model, length, hook, redetect, beatSync, captionStyle, subtitles, matches, story: story ? storyEngine : false, director: dir, onProgress: (l, pr) => setBusy(`${l} ${Math.round(pr * 100)} %`) });
      // the state before the auto edit stays one click away in the project's versions
      try { const { takeVersion } = await import('../lib/studio'); await takeVersion('Avant le montage automatique', true); } catch { /* no workspace: undo still works */ }
      update(() => project);
      { const doubt = project.shots.filter((x) => x.match && x.match.conf < 0.5).length;
        if (doubt) toast(`${doubt} association(s) phrase → case à vérifier : ouvre la « Correction express » (inspecteur du projet), au clavier en quelques secondes.`); }
      setUI({ mode: 'preview', playhead: 0, selection: null });
      void prepareMotion({ quiet: true }); // balloons + 2.5D depth in the background
      const bits = [`${report.shots} cases`, `${report.duration.toFixed(1)} s`];
      if (report.faceShare != null) bits.push(`visage ${Math.round(report.faceShare * 100)} %`);
      if (report.subtitles) bits.push(`${report.subtitles} sous-titres`);
      if (report.followedVoice) bits.push('suit la voix off');
      if (matches) bits.push('cases placées par Google');
      if (live) { setUI({ liveOpen: true, lastNotes: [bits.join(' · '), ...report.notes] }); }
      else { toast('Montage prêt : ' + bits.join(' · ')); report.notes.forEach((n) => toast(n)); }
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal auto-modal" role="dialog" aria-labelledby="auto-title">
        <header className="modal-head">
          <div className="modal-title">
            <span className="modal-ico"><Wand2 size={18} /></span>
            <div>
              <h2 id="auto-title">Montage automatique</h2>
              <p>{hasFace
                ? `Ton rush coupé sert de colonne vertébrale, les cases s'y posent sur les coupes et les fins de phrase. ${FORMATS[format].label}.`
                : `Forge découpe, cadre, rythme et mixe ta vidéo ${FORMATS[format].label}.`} Tout reste modifiable ensuite.</p>
            </div>
          </div>
          <button className="icon-btn ghost" onClick={onClose} disabled={!!busy} aria-label="Fermer"><X size={18} /></button>
        </header>

        <div className="field">
          <label>Modèle de production</label>
          <div className="profile-cards models">
            {(Object.keys(MODELS) as ProductionModel[]).filter((m) => hasFace || m !== 'face').map((m) => (
              <button key={m} className={`profile-card ${model === m ? 'on' : ''}`} onClick={() => pickModel(m)} title={MODELS[m].desc}>
                <strong>{m === 'face-comics' && !hasFace ? 'Comics + voix' : MODELS[m].label}</strong>
              </button>
            ))}
          </div>
          <p className="help">{MODELS[model].desc}</p>
        </div>

        <div className="field">
          <label>Direction créative</label>
          <div className="profile-cards">
            {PROFILES.map((pr) => (
              <button key={pr.id} className={`profile-card ${profile === pr.id ? 'on' : ''}`} onClick={() => setProfile(pr.id)} title={pr.desc}>
                <strong>{pr.label}</strong>
              </button>
            ))}
            <button className={`profile-card ${profile === null ? 'on' : ''}`} onClick={() => setProfile(null)} title="Les styles d’avant, sans budget d’effets">
              <strong>Classique</strong>
            </button>
          </div>
          <p className="help">{profile ? PROFILE[profile].desc : 'Styles d’avant : choisis-en un ci-dessous.'}</p>
        </div>

        {!profile && <div className="field">
          <label>Style</label>
          <div className={`style-cards n${styles.length}`}>
            {styles.map((k) => {
              const I = ICONS[k];
              return (
                <button key={k} className={`style-card ${style === k ? 'on' : ''}`} onClick={() => setStyle(k)}>
                  <I size={20} />
                  <strong>{STYLES[k].label}</strong>
                  <span>{STYLES[k].desc}</span>
                </button>
              );
            })}
          </div>
        </div>}

        {!hasFace && (
          <div className="field">
            <label>Durée</label>
            <div className="chips">
              {LENGTHS.map(({ v, l }) => (
                <button key={String(v)} className={`chip ${length === v ? 'on' : ''}`} disabled={v === 'voice' && !hasVoice}
                  title={v === 'voice' && !hasVoice ? 'Ajoute une voix off d’abord' : undefined} onClick={() => setLength(v)}>{l}</button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="hook">Accroche d’ouverture <span className="opt">optionnel</span></label>
          <div className="key-row">
            <input id="hook" className="input" placeholder="Ex. : Le jour où Batman a tout perdu…" value={hook} onChange={(e) => setHook(e.target.value)} maxLength={90} />
            {google && hasWords && (
              <button className="btn sm google" onClick={suggest} disabled={!!busy} title="Google propose des accroches à partir de ton script"><Sparkles size={14} /> Idées</button>
            )}
          </div>
          {hooks.length > 0 && (
            <div className="chips">{hooks.map((h) => <button key={h} className="chip" onClick={() => setHook(h)}>{h}</button>)}</div>
          )}
          <p className="help">Un texte plein écran pendant les 2 premières secondes{hasFace ? ', posé sur ton visage' : ''}.</p>
        </div>

        <div className="field">
          <label htmlFor="script">Script <span className="opt">optionnel · utilisé s’il n’y a pas de voix transcrite</span></label>
          <textarea id="script" className="input" rows={4} placeholder="Colle ton texte : Forge choisira pour chaque phrase la case qui l’illustre…" value={script} onChange={(e) => { setScript(e.target.value); if (e.target.value.trim() && !script.trim()) setStory(true); }} />
        </div>

        <div className="story-box">
          <Toggle on={story} set={setStory} label="Suivre la narration : chaque phrase reçoit la case qui l’illustre"
            hint={hasVoiceWords ? 'Voix transcrite trouvée' : script.trim() ? 'Durées estimées depuis le script' : 'Transcris ta voix ou colle un script'} />
          {story && (
            <div className="seg full">
              <button className={storyEngine === 'local' ? 'on' : ''} onClick={() => setStoryEngine('local')}>Local · noms et mots</button>
              <button className={storyEngine === 'google' ? 'on' : ''} disabled={!google} onClick={() => setStoryEngine('google')}>Google · compréhension</button>
            </div>
          )}
        </div>

        <div className="toggles">
          <Toggle on={dir.sequences} set={setD('sequences')} label="Directeur créatif : traiter le montage par séquences" hint="Introduction, contexte, révélation… chacune reçoit un traitement visuel adapté, jamais deux fois le même d’affilée" />
          <Toggle on={dir.camera} set={setD('camera')} label="Le directeur choisit les mouvements de caméra" hint="Désactivé : mouvements automatiques simples, à régler toi-même" />
          <Toggle on={dir.transitions} set={setD('transitions')} label="Le directeur choisit les transitions" hint="Pas de transition répétée de près, pas de zoom sur zoom, coupe franche quand un effet n’apporte rien" />
          {hasFace ? (
            <>
              <Toggle on={subtitles} set={setSubtitles} disabled={!hasWords} label="Sous-titres automatiques mot à mot" hint={hasWords ? undefined : 'Transcris le rush ou colle ton script pour les activer'} />
              <Toggle on={aiMatch} set={setAiMatch} disabled={!google || !hasWords} label="Placer chaque case sur la phrase qu’elle illustre (Google)"
                hint={!google ? 'Ajoute une clé Google dans les réglages' : !hasWords ? 'Nécessite la transcription ou ton script' : 'Sinon les cases suivent l’ordre de lecture'} />
            </>
          ) : (
            <Toggle on={beatSync} set={setBeatSync} disabled={!hasMusic} label="Couper sur le beat de la musique" hint={hasMusic ? undefined : 'Ajoute une musique pour l’activer'} />
          )}
          {unsure > 0 && (
            <Toggle on={aiCut} set={setAiCut} disabled={!google} label={`Recouper avec Google les ${unsure} page${unsure > 1 ? 's' : ''} incertaine${unsure > 1 ? 's' : ''}`}
              hint={google ? 'Sinon elles sont animées bande par bande' : 'Ajoute une clé Google dans les réglages'} />
          )}
          <Toggle on={live} set={setLive} label="Voir le montage en direct" hint="Rejoue chaque décision : découpe des cases, coupes du rush, plans et leurs raisons, puis lecture avec le journal" />
          <Toggle on={captionStyle} set={setCaptionStyle} label="Appliquer le style de textes du preset" />
          <Toggle on={redetect} set={setRedetect} label="Re-détecter toutes les cases" hint="Sinon, tes découpes manuelles sont conservées" />
        </div>

        <footer className="modal-foot">
          <span className="muted">{pages} planche{pages > 1 ? 's' : ''}{hasFace ? ' · rush face caméra' : ''}{hasVoice ? ' · voix off' : ''}{hasMusic ? ' · musique' : ''}</span>
          <button className="btn primary lg" onClick={run} disabled={!!busy || (!pages && !hasFace)}>
            {busy ? <Loader2 size={17} className="spin" /> : <Wand2 size={17} />} {busy ?? 'Lancer le montage'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Toggle({ on, set, label, hint, disabled }: { on: boolean; set: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`toggle ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={on && !disabled} disabled={disabled} onChange={(e) => set(e.target.checked)} />
      <span className="switch" />
      <span>{label}{hint && <small>{hint}</small>}</span>
    </label>
  );
}
