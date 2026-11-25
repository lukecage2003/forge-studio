import { useMemo, useState } from 'react';
import { CATEGORIES, LOOK_EFFECTS, type Category } from '../engine/effects';
import { ArrowDown, ArrowUp, Plus, Trash2, Type, Image as ImageIcon, Zap, Droplets, Grid3x3, X } from 'lucide-react';
import type { Diagram, DiagramKind, FxItem, FxKind, Grade, Look, Rect, Shot } from '../types';
import { patchShot, update, useStore } from '../store';
import { addFx, deleteSelection, patchFx } from '../actions';
import { getImage } from '../engine/media';
import { useMediaVersion } from '../lib/hooks';
import { uid } from '../lib/util';
import { Slider } from './Slider';

/* ------------------------------------------------------------ helpers */

function Crop({ pageId, rect, h = 54 }: { pageId: string; rect: Rect; h?: number }) {
  const page = useStore((s) => s.project.pages.find((p) => p.id === pageId));
  const a = page && getImage(page.mediaId);
  if (!page || !a) return <div className="crop empty" style={{ height: h, width: h }} />;
  const k = h / rect.h;
  return (
    <div className="crop" style={{
      width: Math.min(rect.w * k, h * 1.8), height: h, backgroundImage: `url(${a.url})`,
      backgroundSize: `${page.width * k}px ${page.height * k}px`, backgroundPosition: `${-rect.x * k}px ${-rect.y * k}px`,
    }} />
  );
}

/** grid of every panel of the project, to pick one */
export function PanelPicker({ onPick, onClose }: { onPick: (pageId: string, rect: Rect) => void; onClose: () => void }) {
  useMediaVersion();
  const all = useStore((s) => s.project.shots);
  const shots = useMemo(() => all.filter((x) => x.pageId), [all]); // a new array per read would loop React
  return (
    <div className="picker">
      <div className="picker-head"><span>Choisis une case</span><button className="icon-btn sm ghost" onClick={onClose} aria-label="Fermer"><X size={14} /></button></div>
      <div className="picker-grid">
        {shots.map((s) => (
          <button key={s.id} onClick={() => { onPick(s.pageId!, s.rect); onClose(); }} title="Utiliser cette case">
            <Crop pageId={s.pageId!} rect={s.rect} h={58} />
          </button>
        ))}
        {!shots.length && <p className="muted">Importe d’abord des planches.</p>}
      </div>
    </div>
  );
}


/* ------------------------------------------------------------- effects */

export const FX_LABEL: Record<FxKind, string> = {
  textBehind: 'Texte derrière moi', panelBehind: 'Case derrière moi', callout: 'Mot choc', bgBlur: 'Fond flou', bgHalftone: 'Fond trame',
};

export function FxAdd() {
  const items: [FxKind, React.ReactNode][] = [
    ['textBehind', <Type size={16} />], ['panelBehind', <ImageIcon size={16} />], ['callout', <Zap size={16} />],
    ['bgBlur', <Droplets size={16} />], ['bgHalftone', <Grid3x3 size={16} />],
  ];
  return (
    <div className="fx-add">
      {items.map(([k, i]) => (
        <button key={k} className="tile sm" onClick={() => addFx(k)} title={`Ajouter « ${FX_LABEL[k]} » à la tête de lecture`}>{i}<span>{FX_LABEL[k]}</span></button>
      ))}
    </div>
  );
}

export function FxPanel({ fx }: { fx: FxItem }) {
  const [pick, setPick] = useState(false);
  const k = (f: string) => `${fx.id}-${f}`;
  const hasText = fx.kind === 'textBehind' || fx.kind === 'callout';
  return (
    <>
      <div className="insp-title">
        <div><span className="eyebrow">Effet face caméra</span><h2>{FX_LABEL[fx.kind]}</h2></div>
        <button className="icon-btn ghost danger" title="Supprimer (Suppr)" onClick={deleteSelection}><Trash2 size={16} /></button>
      </div>
      {fx.kind !== 'callout' && <p className="help">Ton visage est détouré automatiquement (Google MediaPipe, sur ton ordinateur) et posé devant l’effet. Visible quand ton visage est plein écran.</p>}
      {hasText && (
        <section className="insp-section">
          <div className="insp-head"><h3>Texte</h3></div>
          <input className="input" value={fx.text ?? ''} onChange={(e) => patchFx(fx.id, { text: e.target.value }, k('t'))} />
          <label className="color-row"><input type="color" value={fx.color ?? (fx.kind === 'callout' ? '#FF5A1F' : '#FFFFFF')} onChange={(e) => patchFx(fx.id, { color: e.target.value }, k('c'))} /><span>Couleur</span></label>
          <Slider label="Taille" value={fx.size ?? 1} min={0.4} max={2} step={0.05} fmt={(v) => Math.round(v * 100) + ' %'} onChange={(v) => patchFx(fx.id, { size: v }, k('s'))} />
          <Slider label="Hauteur" value={fx.y ?? (fx.kind === 'callout' ? 0.45 : 0.33)} min={0.1} max={0.9} step={0.01} fmt={(v) => Math.round(v * 100) + ' %'} onChange={(v) => patchFx(fx.id, { y: v }, k('y'))} />
        </section>
      )}
      {fx.kind === 'panelBehind' && (
        <section className="insp-section">
          <div className="insp-head"><h3>Case</h3><button className="link-btn" onClick={() => setPick(!pick)}>Changer</button></div>
          {fx.pageId && fx.rect && <Crop pageId={fx.pageId} rect={fx.rect} h={90} />}
          {pick && <PanelPicker onClose={() => setPick(false)} onPick={(pageId, rect) => patchFx(fx.id, { pageId, rect })} />}
        </section>
      )}
      <section className="insp-section">
        <div className="insp-head"><h3>Timing</h3></div>
        <Slider label="Début" value={fx.start} min={0} max={Math.max(fx.start + 5, 30)} step={0.05} fmt={(v) => v.toFixed(2) + ' s'} onChange={(v) => patchFx(fx.id, { start: v }, k('st'))} />
        <Slider label="Durée" value={fx.duration} min={0.3} max={15} step={0.05} fmt={(v) => v.toFixed(2) + ' s'} onChange={(v) => patchFx(fx.id, { duration: v }, k('d'))} />
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- look */

const GRADES: [Grade, string][] = [['natural', 'Naturel'], ['cinema', 'Cinéma'], ['warm', 'Chaud'], ['punch', 'Punchy'], ['noir', 'Noir']];

export function LookSection() {
  const look = useStore((s) => s.project.look);
  const hasFace = useStore((s) => !!s.project.aroll);
  const set = (p: Partial<Look>, key?: string) => update((x) => ({ ...x, look: { ...x.look, ...p } }), key);
  const PRESETS: { l: string; look: Partial<Look>; accent?: string }[] = [
    { l: 'Naturel', look: { grade: 'natural', vignette: 0.2, grain: 0, paper: 0, handheld: 0.2, chroma: true } },
    { l: 'Cinéma', look: { grade: 'cinema', vignette: 0.45, grain: 0.35, paper: 0, handheld: 0.35, chroma: false } },
    { l: 'Pop TikTok', look: { grade: 'punch', vignette: 0.1, grain: 0, paper: 0, handheld: 0.15, chroma: true, speedLines: true }, accent: '#FF3D7F' },
    { l: 'Noir comics', look: { grade: 'noir', vignette: 0.6, grain: 0.5, paper: 0.3, handheld: 0.25, chroma: false }, accent: '#E0E0E0' },
    { l: 'Papier rétro', look: { grade: 'warm', vignette: 0.35, grain: 0.25, paper: 0.7, handheld: 0.2, chroma: false }, accent: '#D7261E' },
  ];
  return (
    <section className="insp-section">
      <div className="insp-head"><h3>Image</h3></div>
      <div className="look-presets">
        {PRESETS.map((pr) => (
          <button key={pr.l} className="chip" onClick={() => update((x) => ({ ...x, look: { ...x.look, ...pr.look }, accent: pr.accent ?? x.accent }))}>{pr.l}</button>
        ))}
      </div>
      {hasFace && (
        <div className="seg full">
          {GRADES.map(([g, l]) => <button key={g} className={look.grade === g ? 'on' : ''} onClick={() => set({ grade: g })}>{l}</button>)}
        </div>
      )}
      {(Object.keys(CATEGORIES) as Category[]).map((c) => {
        const items = LOOK_EFFECTS.filter((e) => e.category === c);
        if (!items.length) return null;
        return (
          <div key={c} className="fx-cat">
            <span className="fx-cat-title">{CATEGORIES[c]}</span>
            {items.map((e) => e.kind === 'amount' ? (
              <Slider key={e.key} label={e.label} value={Number(look[e.key] ?? 0)} min={0} max={1} step={0.05}
                fmt={(v) => (v ? Math.round(v * 100) + ' %' : 'off')} onChange={(v) => set({ [e.key]: v } as Partial<Look>, 'look-' + e.key)} />
            ) : (
              <label key={e.key} className="toggle">
                <input type="checkbox" checked={e.key === 'balloonPop' ? !!look[e.key] : look[e.key] !== false} onChange={(ev) => set({ [e.key]: ev.target.checked } as Partial<Look>)} />
                <span className="switch" /><span>{e.label}<small>{e.desc}</small></span>
              </label>
            ))}
          </div>
        );
      })}
      {hasFace && (
        <label className="toggle">
          <input type="checkbox" checked={look.cutout} onChange={(e) => set({ cutout: e.target.checked })} />
          <span className="switch" />
          <span>Détourage du visage<small>Pour les effets derrière toi (MediaPipe, local)</small></span>
        </label>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- diagrams */

const KINDS: [DiagramKind, string][] = [['timeline', 'Frise'], ['network', 'Réseau'], ['versus', 'Duel'], ['ranking', 'Classement']];

export function DiagramPanel({ shot }: { shot: Shot }) {
  useMediaVersion();
  const d = shot.diagram!;
  const [pick, setPick] = useState(false);
  const set = (patch: Partial<Diagram>, key?: string) => patchShot(shot.id, { diagram: { ...d, ...patch } }, key);
  const setItem = (i: number, patch: Partial<Diagram['items'][number]>, key?: string) =>
    set({ items: d.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }, key);
  const move = (i: number, dir: number) => {
    const j = i + dir;
    if (j < 0 || j >= d.items.length) return;
    const items = [...d.items];
    [items[i], items[j]] = [items[j], items[i]];
    set({ items });
  };
  return (
    <section className="insp-section">
      <div className="insp-head"><h3>Schéma</h3></div>
      <div className="seg full">{KINDS.map(([k, l]) => <button key={k} className={d.kind === k ? 'on' : ''} onClick={() => set({ kind: k })}>{l}</button>)}</div>
      <input className="input" placeholder="Titre du schéma" value={d.title} onChange={(e) => set({ title: e.target.value }, shot.id + 'dt')} />
      <div className="dia-items">
        {d.items.map((it, i) => (
          <div key={it.id} className="dia-item">
            {it.pageId && it.rect ? <Crop pageId={it.pageId} rect={it.rect} h={44} /> : <div className="crop empty" style={{ width: 44, height: 44 }} />}
            <div className="dia-fields">
              <input className="input sm" placeholder={d.kind === 'timeline' ? 'Événement' : 'Nom'} value={it.label} onChange={(e) => setItem(i, { label: e.target.value }, it.id + 'l')} />
              <input className="input sm" placeholder={d.kind === 'timeline' ? 'Date, numéro…' : 'Détail'} value={it.sub ?? ''} onChange={(e) => setItem(i, { sub: e.target.value }, it.id + 's')} />
            </div>
            <div className="dia-btns">
              <button className="icon-btn sm ghost" onClick={() => move(i, -1)} disabled={!i} aria-label="Monter"><ArrowUp size={13} /></button>
              <button className="icon-btn sm ghost" onClick={() => move(i, 1)} disabled={i === d.items.length - 1} aria-label="Descendre"><ArrowDown size={13} /></button>
              <button className="icon-btn sm ghost danger" onClick={() => set({ items: d.items.filter((_, j) => j !== i), links: d.links.filter((l) => l.a !== i && l.b !== i).map((l) => ({ ...l, a: l.a > i ? l.a - 1 : l.a, b: l.b > i ? l.b - 1 : l.b })) })} aria-label="Retirer"><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
      </div>
      {pick ? (
        <PanelPicker onClose={() => setPick(false)} onPick={(pageId, rect) => set({ items: [...d.items, { id: uid('di_'), label: '', sub: '', pageId, rect }] })} />
      ) : (
        <button className="btn sm ghost block" onClick={() => setPick(true)} disabled={d.items.length >= 8}><Plus size={14} /> Ajouter une case</button>
      )}
      {d.kind === 'network' && d.items.length > 1 && (
        <div className="dia-links">
          <span className="muted">Liens {d.links.length ? '' : '(sans lien : tout relié au premier)'}</span>
          {d.links.map((l, li) => (
            <div key={li} className="dia-link">
              <select className="input sm" value={l.a} onChange={(e) => set({ links: d.links.map((x, j) => (j === li ? { ...x, a: +e.target.value } : x)) })}>
                {d.items.map((it, i) => <option key={it.id} value={i}>{it.label || `Case ${i + 1}`}</option>)}
              </select>
              <select className="input sm" value={l.b} onChange={(e) => set({ links: d.links.map((x, j) => (j === li ? { ...x, b: +e.target.value } : x)) })}>
                {d.items.map((it, i) => <option key={it.id} value={i}>{it.label || `Case ${i + 1}`}</option>)}
              </select>
              <input className="input sm" placeholder="Relation" value={l.label ?? ''} onChange={(e) => set({ links: d.links.map((x, j) => (j === li ? { ...x, label: e.target.value } : x)) }, shot.id + 'll' + li)} />
              <button className="icon-btn sm ghost" onClick={() => set({ links: d.links.filter((_, j) => j !== li) })} aria-label="Retirer le lien"><X size={13} /></button>
            </div>
          ))}
          <button className="link-btn" onClick={() => set({ links: [...d.links, { a: 0, b: Math.min(1, d.items.length - 1), label: '' }] })}>+ Ajouter un lien</button>
        </div>
      )}
    </section>
  );
}
