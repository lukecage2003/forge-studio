import type { ReactNode } from 'react';
import {
  Copy, Trash2, ZoomIn, ZoomOut, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Sparkles, Pause as Still, Scissors, Plus, Minus, FileVideo,
} from 'lucide-react';
import type { AudioClip, CaptionAnim, CaptionPreset, Layout, Motion, Shot, Transition, Background, ARoll } from '../types';
import { getState, patchCaption, patchShot, setUI, update, useStore } from '../store';
import { LAYOUT_FR } from '../engine/brain';
import { patchAroll, rebuildSubtitles, removeRush } from '../rush';
import { Slider } from './Slider';
import { CATEGORIES, TRANSITION, TRANSITIONS, tp, type Category } from '../engine/effects';
import { DiagramPanel, FxAdd, FxPanel, LookSection } from './FxDiagram';
import { applyDefaultCaptionToAll, confirmMatch, deleteSelection, duplicateShot, fitMusicToVideo, swapPanel } from '../actions';
import { PanelPicker } from './FxDiagram';
import { transcribeClip } from '../rush';
import { seek } from '../engine/transport';
import { layoutShots } from '../engine/timeline';
import { useState } from 'react';
import { getImage } from '../engine/media';
import { useMediaVersion } from '../lib/hooks';
import { videoDuration } from '../engine/timeline';

export function Inspector() {
  const sel = useStore((s) => s.ui.selection);
  const shot = useStore((s) => (sel?.kind === 'shot' ? s.project.shots.find((x) => x.id === sel.id) : undefined));
  const clip = useStore((s) => (sel?.kind === 'audio' ? s.project.audio.find((x) => x.id === sel.id) : undefined));
  const ar = useStore((s) => (sel?.kind === 'aroll' ? s.project.aroll : null));
  const fx = useStore((s) => (sel?.kind === 'fx' ? s.project.fx.find((f) => f.id === sel.id) : undefined));
  return (
    <aside className="inspector">
      {shot ? <ShotPanel shot={shot} /> : clip ? <AudioPanel clip={clip} /> : fx ? <FxPanel fx={fx} /> : ar ? <ARollPanel ar={ar} /> : <ProjectPanel />}
    </aside>
  );
}

/* --------------------------------------------------------- primitives */

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="insp-section">
      <div className="insp-head"><h3>{title}</h3>{aside}</div>
      {children}
    </section>
  );
}


function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="seg full">
      {options.map(([v, l]) => <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

/* --------------------------------------------------------------- shot */

const MOTIONS: { v: Motion; l: string; i: ReactNode }[] = [
  { v: 'auto', l: 'Auto', i: <Sparkles size={16} /> },
  { v: 'zoom-in', l: 'Zoom +', i: <ZoomIn size={16} /> },
  { v: 'zoom-out', l: 'Zoom −', i: <ZoomOut size={16} /> },
  { v: 'static', l: 'Fixe', i: <Still size={16} /> },
  { v: 'pan-left', l: 'Gauche', i: <ArrowLeft size={16} /> },
  { v: 'pan-right', l: 'Droite', i: <ArrowRight size={16} /> },
  { v: 'pan-up', l: 'Haut', i: <ArrowUp size={16} /> },
  { v: 'pan-down', l: 'Bas', i: <ArrowDown size={16} /> },
];

const TR_GROUPS = (Object.keys(CATEGORIES) as Category[]).map((c) => ({ c, label: CATEGORIES[c], items: TRANSITIONS.filter((t) => t.category === c) }));

const PRESETS: { v: CaptionPreset; l: string }[] = [
  { v: 'tiktok', l: 'TikTok' }, { v: 'comic', l: 'Récitatif' }, { v: 'impact', l: 'Impact' },
  { v: 'clean', l: 'Propre' }, { v: 'cinema', l: 'Cinéma' }, { v: 'neon', l: 'Néon' },
];

const LAYOUTS: Layout[] = ['full', 'split', 'pip', 'grid', 'page'];
function LayoutIcon({ l }: { l: Layout }) {
  return (
    <svg viewBox="0 0 24 32" width="18" height="24" aria-hidden="true" className="lay-ico">
      <rect x="1" y="1" width="22" height="30" rx="2.5" className="lay-frame" />
      {l === 'full' && <rect x="3" y="3" width="18" height="26" rx="1" className="lay-panel" />}
      {l === 'split' && (<><rect x="3" y="3" width="18" height="14" rx="1" className="lay-panel" /><circle cx="12" cy="23.5" r="4" className="lay-face" /></>)}
      {l === 'pip' && (<><rect x="3" y="3" width="18" height="26" rx="1" className="lay-panel" /><circle cx="8" cy="22" r="3.6" className="lay-face" /></>)}
      {l === 'grid' && (<><rect x="3" y="3" width="18" height="8" rx="1" className="lay-panel" /><rect x="3" y="12" width="18" height="8" rx="1" className="lay-panel" /><rect x="3" y="21" width="18" height="8" rx="1" className="lay-panel" /></>)}
      {l === 'page' && (<><rect x="4" y="4" width="16" height="24" rx="1" className="lay-page" /><rect x="5.5" y="12" width="13" height="7" rx="0.5" className="lay-panel" /></>)}
    </svg>
  );
}
const ANIMS: [CaptionAnim, string][] = [['none', 'Aucune'], ['pop', 'Pop'], ['slide', 'Glissé'], ['type', 'Machine'], ['words', 'Mot à mot']];

function ShotThumb({ shot }: { shot: Shot }) {
  useMediaVersion();
  const page = useStore((s) => s.project.pages.find((p) => p.id === shot.pageId));
  const a = page && getImage(page.mediaId);
  if (!page || !a) return <div className="shot-thumb title">Carton titre</div>;
  const r = shot.rect;
  const k = Math.min(240 / r.w, 130 / r.h);
  return (
    <div className="shot-thumb">
      <div style={{
        width: r.w * k, height: r.h * k,
        backgroundImage: `url(${a.url})`, backgroundSize: `${page.width * k}px ${page.height * k}px`,
        backgroundPosition: `${-r.x * k}px ${-r.y * k}px`,
      }} />
    </div>
  );
}

function ShotPanel({ shot }: { shot: Shot }) {
  const index = useStore((s) => s.project.shots.findIndex((x) => x.id === shot.id));
  const hasFace = useStore((s) => !!s.project.aroll);
  const overlay = hasFace;
  const vlen = useStore((s) => videoDuration(s.project));
  const k = (f: string) => `${shot.id}-${f}`;
  const isTitle = shot.pageId == null;
  return (
    <>
      <div className="insp-title">
        <div>
          <span className="eyebrow">{isTitle ? 'Carton' : 'Case'} {String(index + 1).padStart(2, '0')}</span>
          <h2>{shot.diagram ? 'Schéma' : isTitle ? 'Carton titre' : 'Plan'}</h2>
        </div>
        <div className="row-btns">
          <button className="icon-btn ghost" title="Dupliquer" onClick={() => duplicateShot(shot.id)}><Copy size={16} /></button>
          <button className="icon-btn ghost danger" title="Supprimer (Suppr)" onClick={deleteSelection}><Trash2 size={16} /></button>
        </div>
      </div>
      {!shot.diagram && <ShotThumb shot={shot} />}
      {shot.match && <MatchSection shot={shot} />}
      {shot.diagram && <DiagramPanel shot={shot} />}
      {!isTitle && (
        <button className="btn sm ghost block" onClick={() => setUI({ mode: 'cut', activePageId: shot.pageId })}>
          <Scissors size={14} /> Ajuster le cadrage sur la planche
        </button>
      )}

      {!isTitle && (
        <Section title="Mise en page">
          <div className="layout-grid">
            {LAYOUTS.map((l) => (
              <button key={l} className={shot.layout === l ? 'on' : ''} disabled={(l === 'split' || l === 'pip') && !hasFace}
                title={(l === 'split' || l === 'pip') && !hasFace ? 'Nécessite un rush face caméra' : LAYOUT_FR[l]}
                onClick={() => patchShot(shot.id, { layout: l, group: l === 'grid' && !shot.group?.length ? nextPanels(shot, 1) : shot.group })}>
                <LayoutIcon l={l} /><span>{LAYOUT_FR[l]}</span>
              </button>
            ))}
          </div>
          {shot.layout === 'grid' && (
            <div className="row-btns gap">
              <span className="muted">{1 + (shot.group?.length ?? 0)} cases ensemble</span>
              <button className="icon-btn sm" title="Retirer une case" disabled={!shot.group?.length} onClick={() => patchShot(shot.id, { group: shot.group?.slice(0, -1) })}><Minus size={14} /></button>
              <button className="icon-btn sm" title="Ajouter la case suivante" disabled={(shot.group?.length ?? 0) >= 3} onClick={() => patchShot(shot.id, { group: nextPanels(shot, (shot.group?.length ?? 0) + 1) })}><Plus size={14} /></button>
            </div>
          )}
          <input className="input" placeholder="Nom à l’écran (ex. : Bruce Wayne)" value={shot.nameTag ?? ''} onChange={(e) => patchShot(shot.id, { nameTag: e.target.value }, k('tag'))} />
        </Section>
      )}

      <Section title="Durée">
        {overlay && (
          <Slider label="Début" value={shot.start ?? 0} min={0} max={Math.max(1, vlen)} step={0.05}
            fmt={(v) => v.toFixed(2) + ' s'} onChange={(v) => patchShot(shot.id, { start: v }, k('start'))} />
        )}
        <Slider label="Durée du plan" value={shot.duration} min={0.4} max={12} step={1 / 30}
          fmt={(v) => v.toFixed(1) + ' s'} onChange={(v) => patchShot(shot.id, { duration: v }, k('dur'))} />
      </Section>

      {!isTitle && (
        <Section title="Caméra" aside={<button className="link-btn" title="Même mouvement et intensité pour toutes les cases" onClick={() => update((p) => ({ ...p, shots: p.shots.map((x) => (x.pageId ? { ...x, motion: shot.motion, intensity: shot.intensity, framing: shot.framing } : x)) }))}>Appliquer à tous</button>}>
          <Seg value={shot.framing} options={[['fit', 'Case entière'], ['fill', 'Plein cadre']]}
            onChange={(v) => patchShot(shot.id, { framing: v })} />
          <div className="motion-grid">
            {MOTIONS.map((m) => (
              <button key={m.v} className={shot.motion === m.v ? 'on' : ''} onClick={() => patchShot(shot.id, { motion: m.v })} title={m.l}>
                {m.i}<span>{m.l}</span>
              </button>
            ))}
          </div>
          <Slider label="Intensité" value={shot.intensity} min={0} max={1} step={0.05}
            fmt={(v) => Math.round(v * 100) + ' %'} onChange={(v) => patchShot(shot.id, { intensity: v }, k('int'))} />
          <Slider label="Secousse d’impact" value={shot.shake} min={0} max={1} step={0.05}
            fmt={(v) => (v ? Math.round(v * 100) + ' %' : 'off')} onChange={(v) => patchShot(shot.id, { shake: v }, k('shake'))} />
        </Section>
      )}
      {isTitle && !shot.diagram && (
        <Section title="Fond">
          <label className="color-row">
            <input type="color" value={shot.titleBg ?? '#0E0E11'} onChange={(e) => patchShot(shot.id, { titleBg: e.target.value }, k('bg'))} />
            <span>{shot.titleBg ?? '#0E0E11'}</span>
          </label>
        </Section>
      )}

      {(index > 0 || overlay) && (
        <Section title="Transition d’entrée" aside={<button className="link-btn" title="Même transition pour tous les plans" onClick={() => update((p) => ({ ...p, shots: p.shots.map((x, i) => (i === 0 && !p.aroll ? x : { ...x, transition: shot.transition, tp: shot.tp, transitionDur: Math.min(shot.transitionDur, x.duration * 0.45) })) }))}>Appliquer à tous</button>}>
          <select className="input" value={shot.transition} onChange={(e) => {
            const tr = e.target.value as Transition;
            const min = TRANSITION[tr]?.minDur ?? 0;
            patchShot(shot.id, { transition: tr, tp: undefined, transitionDur: Math.min(shot.duration * 0.45, Math.max(shot.transitionDur, min)) });
          }}>
            {TR_GROUPS.map((g) => (
              <optgroup key={g.c} label={g.label}>
                {g.items.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </optgroup>
            ))}
          </select>
          {TRANSITION[shot.transition] && <p className="help">{TRANSITION[shot.transition].desc}</p>}
          {shot.transition !== 'cut' && (
            <Slider label="Durée" value={shot.transitionDur} min={0.1} max={1.5} step={0.05}
              fmt={(v) => v.toFixed(2) + ' s'} onChange={(v) => patchShot(shot.id, { transitionDur: v }, k('td'))} />
          )}
          {TRANSITION[shot.transition]?.params.map((pa) => (
            <Slider key={pa.key} label={pa.label} value={tp(shot, pa.key)} min={pa.min} max={pa.max} step={pa.step}
              fmt={pa.fmt ?? ((v) => String(+v.toFixed(3)))}
              onChange={(v) => patchShot(shot.id, { tp: { ...(shot.tp ?? {}), [pa.key]: v } }, k('tp' + pa.key))} />
          ))}
        </Section>
      )}

      {!shot.diagram && <Section title={isTitle ? 'Texte' : 'Sous-titre'}>
        <textarea className="input" rows={3} placeholder={isTitle ? 'Titre…' : 'Ce que dit le narrateur sur cette case…'}
          value={shot.caption.text} onChange={(e) => patchCaption(shot.id, { text: e.target.value }, k('txt'))} />
        <div className="preset-grid">
          {PRESETS.map((p) => (
            <button key={p.v} className={`preset p-${p.v} ${shot.caption.preset === p.v ? 'on' : ''}`} onClick={() => patchCaption(shot.id, { preset: p.v })}>
              <span className="preset-sample">Aa</span><span>{p.l}</span>
            </button>
          ))}
        </div>
        <Seg value={shot.caption.anim} options={ANIMS} onChange={(v) => patchCaption(shot.id, { anim: v })} />
        {!isTitle && (
          <Slider label="Position verticale" value={shot.caption.y} min={0.06} max={0.94} step={0.01}
            fmt={(v) => (v < 0.34 ? 'Haut' : v > 0.66 ? 'Bas' : 'Centre')} onChange={(v) => patchCaption(shot.id, { y: v }, k('y'))} />
        )}
        <Slider label="Taille" value={shot.caption.size} min={0.5} max={2} step={0.05}
          fmt={(v) => Math.round(v * 100) + ' %'} onChange={(v) => patchCaption(shot.id, { size: v }, k('size'))} />
      </Section>}
    </>
  );
}

/* -------------------------------------------------------------- audio */

const KIND_LABEL = { music: 'Musique', voice: 'Voix off', sfx: 'Bruitage' };

function AudioPanel({ clip }: { clip: AudioClip }) {
  const vlen = useStore((s) => videoDuration(s.project));
  const patch = (p: Partial<AudioClip>, key?: string) =>
    update((pr) => ({ ...pr, audio: pr.audio.map((c) => (c.id === clip.id ? { ...c, ...p } : c)) }), key);
  const k = (f: string) => `${clip.id}-${f}`;
  return (
    <>
      <div className="insp-title">
        <div>
          <span className="eyebrow">{KIND_LABEL[clip.kind]}</span>
          <h2 className="ellipsis" title={clip.name}>{clip.name}</h2>
        </div>
        <button className="icon-btn ghost danger" title="Supprimer (Suppr)" onClick={deleteSelection}><Trash2 size={16} /></button>
      </div>
      <Section title="Piste">
        <Seg value={clip.kind} options={[['music', 'Musique'], ['voice', 'Voix'], ['sfx', 'Bruitage']]} onChange={(v) => patch({ kind: v })} />
      </Section>
      <Section title="Niveau">
        <Slider label="Volume" value={clip.volume} min={0} max={1.5} step={0.01}
          fmt={(v) => Math.round(v * 100) + ' %'} onChange={(v) => patch({ volume: v }, k('vol'))} />
        <Slider label="Fondu d’entrée" value={clip.fadeIn} min={0} max={5} step={0.1}
          fmt={(v) => v.toFixed(1) + ' s'} onChange={(v) => patch({ fadeIn: v }, k('fi'))} />
        <Slider label="Fondu de sortie" value={clip.fadeOut} min={0} max={5} step={0.1}
          fmt={(v) => v.toFixed(1) + ' s'} onChange={(v) => patch({ fadeOut: v }, k('fo'))} />
      </Section>
      {clip.kind === 'voice' && (
        <Section title="Transcription">
          <p className="help">{clip.words?.length ? `${clip.words.length} mots transcrits : le montage auto peut suivre cette voix et la sous-titrer.` : 'Transcris cette voix off pour que le montage suive ce que tu dis.'}</p>
          <div className="row-btns gap">
            <button className="btn sm" onClick={() => void transcribeClip(clip.id, 'whisper')}>Transcrire (local)</button>
            <button className="btn sm google" onClick={() => void transcribeClip(clip.id, 'gemini')}>Google</button>
          </div>
        </Section>
      )}
      <Section title="Placement">
        <Slider label="Début" value={clip.start} min={0} max={Math.max(vlen, clip.start + 1)} step={0.05}
          fmt={(v) => v.toFixed(2) + ' s'} onChange={(v) => patch({ start: v }, k('st'))} />
        {clip.kind === 'music' && (
          <button className="btn sm ghost block" onClick={() => fitMusicToVideo(clip.id, vlen)}>Caler sur la durée de la vidéo</button>
        )}
      </Section>
    </>
  );
}

/* ------------------------------------------------------------ project */

function ProjectPanel() {
  const p = useStore((s) => s.project);
  const set = (patch: Partial<typeof p>, key?: string) => update((x) => ({ ...x, ...patch }), key);
  const dc = p.defaultCaption;
  return (
    <>
      <div className="insp-title">
        <div><span className="eyebrow">Projet</span><h2>Réglages</h2></div>
      </div>
      <ReviewList />
      <Section title="Arrière-plan">
        <Seg<Background> value={p.background} options={[['blur', 'Flou'], ['halftone', 'Trame'], ['page', 'Planche'], ['color', 'Uni']]} onChange={(v) => set({ background: v })} />
        {p.background === 'color' && (
          <label className="color-row">
            <input type="color" value={p.bgColor} onChange={(e) => set({ bgColor: e.target.value }, 'bgc')} />
            <span>{p.bgColor}</span>
          </label>
        )}
      </Section>
      <Section title="Audio">
        <label className="toggle">
          <input type="checkbox" checked={p.autoSfx?.on ?? true} onChange={(e) => set({ autoSfx: { volume: p.autoSfx?.volume ?? 0.6, on: e.target.checked } })} />
          <span className="switch" />
          <span>Bruitages automatiques<small>Souffle sur les transitions, impact sur les pleines pages</small></span>
        </label>
        {(p.autoSfx?.on ?? true) && (
          <Slider label="Volume des bruitages" value={p.autoSfx?.volume ?? 0.6} min={0} max={1.5} step={0.05}
            fmt={(v) => Math.round(v * 100) + ' %'} onChange={(v) => set({ autoSfx: { on: true, volume: v } }, 'sfxv')} />
        )}
        <label className="toggle">
          <input type="checkbox" checked={p.ducking} onChange={(e) => set({ ducking: e.target.checked })} />
          <span className="switch" />
          <span>Baisser la musique sous la voix<small>Ducking automatique</small></span>
        </label>
        {p.ducking && (
          <Slider label="Musique sous la voix" value={p.duckLevel} min={0} max={1} step={0.05}
            fmt={(v) => Math.round(v * 100) + ' %'} onChange={(v) => set({ duckLevel: v }, 'duck')} />
        )}
      </Section>
      <LookSection />
      <Section title="Habillage">
        <label className="color-row">
          <input type="color" value={p.accent} onChange={(e) => set({ accent: e.target.value }, 'accent')} />
          <span>Couleur d’accent · {p.accent}</span>
        </label>
        <label className="toggle">
          <input type="checkbox" checked={p.progressBar} onChange={(e) => set({ progressBar: e.target.checked })} />
          <span className="switch" />
          <span>Barre de progression<small>Aide la rétention sur TikTok et Shorts</small></span>
        </label>
      </Section>
      {p.aroll && (
        <Section title="Sous-titres auto" aside={<button className="link-btn" onClick={rebuildSubtitles}>Régénérer</button>}>
          <label className="toggle">
            <input type="checkbox" checked={p.subtitleStyle.on} onChange={(e) => set({ subtitleStyle: { ...p.subtitleStyle, on: e.target.checked } })} />
            <span className="switch" />
            <span>Afficher les sous-titres<small>{p.subtitles.length ? `${p.subtitles.length} lignes, issues de la transcription` : 'Transcris le rush pour les générer'}</small></span>
          </label>
          <div className="preset-grid">
            {PRESETS.map((x) => (
              <button key={x.v} className={`preset p-${x.v} ${p.subtitleStyle.preset === x.v ? 'on' : ''}`} onClick={() => set({ subtitleStyle: { ...p.subtitleStyle, preset: x.v } })}>
                <span className="preset-sample">Aa</span><span>{x.l}</span>
              </button>
            ))}
          </div>
          <Slider label="Mots par ligne" value={p.subtitleStyle.maxWords} min={1} max={10} step={1} fmt={(v) => String(v)}
            onChange={(v) => { set({ subtitleStyle: { ...p.subtitleStyle, maxWords: v } }, 'subw'); rebuildSubtitles(); }} />
          <Slider label="Position verticale" value={p.subtitleStyle.y} min={0.1} max={0.92} step={0.01}
            fmt={(v) => (v < 0.34 ? 'Haut' : v > 0.66 ? 'Bas' : 'Centre')} onChange={(v) => set({ subtitleStyle: { ...p.subtitleStyle, y: v } }, 'suby')} />
          <Slider label="Taille" value={p.subtitleStyle.size} min={0.5} max={1.8} step={0.05}
            fmt={(v) => Math.round(v * 100) + ' %'} onChange={(v) => set({ subtitleStyle: { ...p.subtitleStyle, size: v } }, 'subs')} />
        </Section>
      )}
      <Section title="Textes des cases" aside={<button className="link-btn" onClick={applyDefaultCaptionToAll}>Appliquer partout</button>}>
        <div className="preset-grid">
          {PRESETS.map((x) => (
            <button key={x.v} className={`preset p-${x.v} ${dc.preset === x.v ? 'on' : ''}`} onClick={() => set({ defaultCaption: { ...dc, preset: x.v } })}>
              <span className="preset-sample">Aa</span><span>{x.l}</span>
            </button>
          ))}
        </div>
        <Seg value={dc.anim} options={ANIMS} onChange={(v) => set({ defaultCaption: { ...dc, anim: v } })} />
      </Section>
      <Section title="Signature">
        <input className="input" placeholder="@toncompte" value={p.watermark} onChange={(e) => set({ watermark: e.target.value }, 'wm')} />
        <p className="help">Affichée discrètement en haut à droite de la vidéo.</p>
      </Section>
      <Section title="Raccourcis">
        <ul className="shortcuts">
          <li><kbd>Espace</kbd> Lecture / pause</li>
          <li><kbd>←</kbd><kbd>→</kbd> Image par image</li>
          <li><kbd>Suppr</kbd> Supprimer la sélection</li>
          <li><kbd>Ctrl</kbd><kbd>Z</kbd> Annuler</li>
          <li><kbd>A</kbd> Montage auto</li>
          <li><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> Rush · Découpe · Aperçu</li>
        </ul>
      </Section>
    </>
  );
}

/** the next panels in reading order after this one, for multi-panel shots */
function nextPanels(shot: Shot, n: number) {
  const all = getState().project.shots.filter((s) => s.pageId);
  const i = all.findIndex((s) => s.id === shot.id);
  return all.slice(i + 1, i + 1 + n).filter((s) => s.id !== shot.id).map((s) => ({ pageId: s.pageId!, rect: s.rect }));
}

/* ------------------------------------------------------------- face cam */

function ARollPanel({ ar }: { ar: ARoll }) {
  return (
    <>
      <div className="insp-title">
        <div><span className="eyebrow">Rush face caméra</span><h2 className="ellipsis" title={ar.name}>{ar.name}</h2></div>
        <button className="icon-btn ghost danger" title="Retirer le rush du projet" onClick={removeRush}><Trash2 size={16} /></button>
      </div>
      <button className="btn sm ghost block" onClick={() => setUI({ mode: 'rush' })}><FileVideo size={14} /> Ouvrir le dérushage</button>
      <Section title="Zooms">
        <Slider label="Zoom à chaque coupe" value={ar.punchIn} min={0} max={1} step={0.05}
          fmt={(v) => (v ? '+' + Math.round(v * 16) + ' %' : 'off')} onChange={(v) => patchAroll({ punchIn: v }, 'punch')} />
        <p className="help">Alterne les cadrages à chaque coupe pour masquer les sauts d’image, centré sur ton visage.</p>
        <Slider label="Poussée lente" value={ar.drift} min={0} max={1} step={0.05}
          fmt={(v) => (v ? Math.round(v * 100) + ' %' : 'off')} onChange={(v) => patchAroll({ drift: v }, 'drift')} />
      </Section>
      <Section title="Effets à la tête de lecture">
        <FxAdd />
      </Section>
      <LookSection />
      <Section title="Son">
        <Slider label="Volume de la voix" value={ar.volume} min={0} max={2} step={0.05}
          fmt={(v) => Math.round(v * 100) + ' %'} onChange={(v) => patchAroll({ volume: v }, 'avol')} />
      </Section>
      <Section title="Cadrage">
        <p className="help">Point de focus : {Math.round(ar.focus.x * 100)} % · {Math.round(ar.focus.y * 100)} %. Change-le dans l’onglet Rush avec « Centrer sur le visage ».</p>
      </Section>
    </>
  );
}

/* ---------------------------------------------------------- narration */

function MatchSection({ shot }: { shot: Shot }) {
  const [pick, setPick] = useState(false);
  const all = useStore((s) => s.project.shots);
  const m = shot.match!;
  const alts = m.alts.map((id) => all.find((x) => x.id === id)).filter((x): x is Shot => !!x && !!x.pageId);
  const level = m.conf >= 0.7 ? 'sûr' : m.conf >= 0.5 ? 'probable' : 'à vérifier';
  return (
    <Section title="Narration" aside={<span className={`conf c-${m.conf >= 0.7 ? 'hi' : m.conf >= 0.5 ? 'mid' : 'lo'}`}>{level} · {Math.round(m.conf * 100)} %</span>}>
      <blockquote className="said">« {m.sentence} »</blockquote>
      <p className="help">Case choisie par {m.source === 'google' ? 'Google (sens de la phrase)' : 'Forge (noms, mots et ordre de lecture)'}.</p>
      {alts.length > 0 && (
        <>
          <span className="muted">Autres cases possibles :</span>
          <div className="alts">
            {alts.map((a) => (
              <button key={a.id} title="Utiliser cette case" onClick={() => swapPanel(shot.id, a.pageId!, a.rect)}><AltThumb s={a} /></button>
            ))}
          </div>
        </>
      )}
      <div className="row-btns gap">
        {m.conf < 1 && <button className="btn sm" onClick={() => confirmMatch(shot.id)}>C’est la bonne</button>}
        <button className="btn sm ghost" onClick={() => setPick(!pick)}>Choisir une autre case…</button>
      </div>
      {pick && <PanelPicker onClose={() => setPick(false)} onPick={(pageId, rect) => swapPanel(shot.id, pageId, rect)} />}
    </Section>
  );
}

function AltThumb({ s }: { s: Shot }) {
  const page = useStore((st) => st.project.pages.find((p) => p.id === s.pageId));
  const a = page && getImage(page.mediaId);
  if (!page || !a) return null;
  const k = 54 / s.rect.h;
  return <div className="crop" style={{ width: Math.min(s.rect.w * k, 96), height: 54, backgroundImage: `url(${a.url})`, backgroundSize: `${page.width * k}px ${page.height * k}px`, backgroundPosition: `${-s.rect.x * k}px ${-s.rect.y * k}px` }} />;
}

/** placements the matcher wasn't sure about, to check one by one */
function ReviewList() {
  const project = useStore((s) => s.project);
  const timed = layoutShots(project).filter((t) => t.shot.match && t.shot.match.conf < 0.5);
  if (!timed.length) return null;
  return (
    <Section title={`À vérifier · ${timed.length}`}>
      <p className="help">Cases placées avec peu de certitude. Clique pour aller au plan, puis confirme ou choisis une autre case.</p>
      <div className="review-list">
        {timed.slice(0, 30).map((t) => (
          <button key={t.shot.id} className="review-item" onClick={() => { setUI({ selection: { kind: 'shot', id: t.shot.id }, mode: 'preview' }); seek(t.start + 0.01); }}>
            <span className="tc">{Math.floor(t.start / 60)}:{String(Math.floor(t.start % 60)).padStart(2, '0')}</span>
            <span className="ellipsis">{t.shot.match!.sentence}</span>
          </button>
        ))}
      </div>
    </Section>
  );
}
