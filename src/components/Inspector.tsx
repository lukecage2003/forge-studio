import type { ReactNode } from 'react';
import {
  Copy, Trash2, ZoomIn, ZoomOut, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Sparkles, Pause as Still, Scissors,
} from 'lucide-react';
import type { AudioClip, CaptionAnim, CaptionPreset, Motion, Shot, Transition, Background } from '../types';
import { patchCaption, patchShot, setUI, update, useStore } from '../store';
import { applyDefaultCaptionToAll, deleteSelection, duplicateShot, fitMusicToVideo } from '../actions';
import { getImage } from '../engine/media';
import { useMediaVersion } from '../lib/hooks';
import { videoDuration } from '../engine/timeline';

export function Inspector() {
  const sel = useStore((s) => s.ui.selection);
  const shot = useStore((s) => (sel?.kind === 'shot' ? s.project.shots.find((x) => x.id === sel.id) : undefined));
  const clip = useStore((s) => (sel?.kind === 'audio' ? s.project.audio.find((x) => x.id === sel.id) : undefined));
  return (
    <aside className="inspector">
      {shot ? <ShotPanel shot={shot} /> : clip ? <AudioPanel clip={clip} /> : <ProjectPanel />}
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

function Slider({ label, value, min, max, step, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="slider">
      <span className="slider-top"><span>{label}</span><output>{fmt ? fmt(value) : value}</output></span>
      <input type="range" min={min} max={max} step={step} value={value}
        style={{ ['--p' as string]: pct + '%' }} onChange={(e) => onChange(+e.target.value)} />
    </label>
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

const TRANSITIONS: [Transition, string][] = [
  ['cut', 'Cut'], ['glide', 'Glisse caméra'], ['fade', 'Fondu'], ['slide', 'Poussée'],
  ['whip', 'Whip'], ['zoom', 'Zoom'], ['flash', 'Flash'],
];

const PRESETS: { v: CaptionPreset; l: string }[] = [
  { v: 'tiktok', l: 'TikTok' }, { v: 'comic', l: 'Récitatif' }, { v: 'impact', l: 'Impact' },
  { v: 'clean', l: 'Propre' }, { v: 'cinema', l: 'Cinéma' },
];
const ANIMS: [CaptionAnim, string][] = [['none', 'Aucune'], ['pop', 'Pop'], ['type', 'Machine'], ['words', 'Mot à mot']];

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
  const k = (f: string) => `${shot.id}-${f}`;
  const isTitle = shot.pageId == null;
  return (
    <>
      <div className="insp-title">
        <div>
          <span className="eyebrow">{isTitle ? 'Carton' : 'Case'} {String(index + 1).padStart(2, '0')}</span>
          <h2>{isTitle ? 'Carton titre' : 'Plan'}</h2>
        </div>
        <div className="row-btns">
          <button className="icon-btn ghost" title="Dupliquer" onClick={() => duplicateShot(shot.id)}><Copy size={16} /></button>
          <button className="icon-btn ghost danger" title="Supprimer (Suppr)" onClick={deleteSelection}><Trash2 size={16} /></button>
        </div>
      </div>
      <ShotThumb shot={shot} />
      {!isTitle && (
        <button className="btn sm ghost block" onClick={() => setUI({ mode: 'cut', activePageId: shot.pageId })}>
          <Scissors size={14} /> Ajuster le cadrage sur la planche
        </button>
      )}

      <Section title="Durée">
        <Slider label="Durée du plan" value={shot.duration} min={0.4} max={12} step={0.1}
          fmt={(v) => v.toFixed(1) + ' s'} onChange={(v) => patchShot(shot.id, { duration: v }, k('dur'))} />
      </Section>

      {!isTitle && (
        <Section title="Caméra">
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
      {isTitle && (
        <Section title="Fond">
          <label className="color-row">
            <input type="color" value={shot.titleBg ?? '#0E0E11'} onChange={(e) => patchShot(shot.id, { titleBg: e.target.value }, k('bg'))} />
            <span>{shot.titleBg ?? '#0E0E11'}</span>
          </label>
        </Section>
      )}

      {index > 0 && (
        <Section title="Transition d’entrée">
          <select className="input" value={shot.transition} onChange={(e) => patchShot(shot.id, { transition: e.target.value as Transition })}>
            {TRANSITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          {shot.transition !== 'cut' && (
            <Slider label="Durée" value={shot.transitionDur} min={0.1} max={1.5} step={0.05}
              fmt={(v) => v.toFixed(2) + ' s'} onChange={(v) => patchShot(shot.id, { transitionDur: v }, k('td'))} />
          )}
        </Section>
      )}

      <Section title={isTitle ? 'Texte' : 'Sous-titre'}>
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
      </Section>
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
      <Section title="Arrière-plan">
        <Seg<Background> value={p.background} options={[['blur', 'Flou'], ['page', 'Planche'], ['color', 'Couleur']]} onChange={(v) => set({ background: v })} />
        {p.background === 'color' && (
          <label className="color-row">
            <input type="color" value={p.bgColor} onChange={(e) => set({ bgColor: e.target.value }, 'bgc')} />
            <span>{p.bgColor}</span>
          </label>
        )}
      </Section>
      <Section title="Audio">
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
      <Section title="Sous-titres par défaut" aside={<button className="link-btn" onClick={applyDefaultCaptionToAll}>Appliquer partout</button>}>
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
        </ul>
      </Section>
    </>
  );
}
