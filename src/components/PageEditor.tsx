import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eraser, Maximize, ScanSearch, MousePointerSquareDashed, Sparkles } from 'lucide-react';
import { getImage } from '../engine/media';
import { useMediaVersion } from '../lib/hooks';
import { patchShot, setUI, update, useStore } from '../store';
import { addShotRect, aiRecut, clearPage, redetect, wholePage } from '../actions';
import type { Rect } from '../types';
import { clamp } from '../lib/util';

type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type Drag =
  | { type: 'new'; x0: number; y0: number }
  | { type: 'move'; id: string; px: number; py: number; orig: Rect }
  | { type: 'resize'; id: string; h: Handle; px: number; py: number; orig: Rect };

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function PageEditor() {
  useMediaVersion();
  const pageId = useStore((s) => s.ui.activePageId);
  const page = useStore((s) => s.project.pages.find((p) => p.id === s.ui.activePageId));
  const shots = useStore((s) => s.project.shots);
  const sel = useStore((s) => s.ui.selection);
  const rtl = useStore((s) => s.project.readingOrder === 'rtl');
  const stageRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [draft, setDraft] = useState<Rect | null>(null);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el || !page) return;
    const ro = new ResizeObserver(() => {
      const pad = 32;
      setFit(Math.min((el.clientWidth - pad) / page.width, (el.clientHeight - pad) / page.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);

  useEffect(() => { setDraft(null); setDrag(null); }, [pageId]);

  if (!page) {
    return (
      <div className="stage empty">
        <div className="empty-card">
          <MousePointerSquareDashed size={28} />
          <h3>Aucune planche sélectionnée</h3>
          <p>Importe des planches à gauche : Forge détecte automatiquement les cases.</p>
        </div>
      </div>
    );
  }
  const asset = getImage(page.mediaId);
  const W = page.width, H = page.height;
  const pageShots = shots.map((s, i) => ({ s, i })).filter((x) => x.s.pageId === page.id);
  const svgRef = { current: null as SVGSVGElement | null };

  const toPage = (e: React.PointerEvent) => {
    const r = (e.currentTarget.closest('svg') as SVGSVGElement).getBoundingClientRect();
    return { x: clamp(((e.clientX - r.left) / r.width) * W, 0, W), y: clamp(((e.clientY - r.top) / r.height) * H, 0, H) };
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const t = e.target as Element;
    const id = t.getAttribute('data-id');
    const h = t.getAttribute('data-h') as Handle | null;
    const p = toPage(e);
    if (id) {
      const shot = shots.find((s) => s.id === id)!;
      setUI({ selection: { kind: 'shot', id } });
      setDrag(h ? { type: 'resize', id, h, px: p.x, py: p.y, orig: shot.rect } : { type: 'move', id, px: p.x, py: p.y, orig: shot.rect });
    } else {
      setDrag({ type: 'new', x0: p.x, y0: p.y });
      setDraft({ x: p.x, y: p.y, w: 0, h: 0 });
    }
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = toPage(e);
    if (drag.type === 'new') {
      setDraft({ x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) });
      return;
    }
    const dx = p.x - drag.px, dy = p.y - drag.py, o = drag.orig;
    let r: Rect;
    if (drag.type === 'move') {
      r = { ...o, x: clamp(o.x + dx, 0, W - o.w), y: clamp(o.y + dy, 0, H - o.h) };
    } else {
      let { x, y } = o;
      let x2 = o.x + o.w, y2 = o.y + o.h;
      if (drag.h.includes('w')) x = clamp(o.x + dx, 0, x2 - 20);
      if (drag.h.includes('e')) x2 = clamp(x2 + dx, x + 20, W);
      if (drag.h.includes('n')) y = clamp(o.y + dy, 0, y2 - 20);
      if (drag.h.includes('s')) y2 = clamp(y2 + dy, y + 20, H);
      r = { x, y, w: x2 - x, h: y2 - y };
    }
    patchShot(drag.id, { rect: roundRect(r) }, 'drag-' + drag.id + drag.type);
  };

  const onUp = () => {
    if (drag?.type === 'new' && draft && draft.w > W * 0.03 && draft.h > H * 0.02) {
      addShotRect(page.id, roundRect(draft));
    } else if (drag?.type === 'new') {
      setUI({ selection: { kind: 'page', id: page.id } });
    }
    setDrag(null);
    setDraft(null);
  };

  const hs = 9 / fit; // handle size in page px

  return (
    <div className="stage cut">
      <div className="stage-toolbar">
        <button className="btn sm" onClick={() => redetect(page.id)} title="Re-détecte les cases de cette planche (remplace les cases existantes)">
          <ScanSearch size={15} /> Détection auto
        </button>
        <button className="btn sm google" onClick={() => void aiRecut([page.id])} title="Détection précise des cases par Google Gemini (clé dans les réglages)">
          <Sparkles size={15} /> IA Google
        </button>
        <button className="btn sm ghost" onClick={() => wholePage(page.id)} title="Une seule case = la planche entière">
          <Maximize size={15} /> Planche entière
        </button>
        <button className="btn sm ghost" onClick={() => clearPage(page.id)} title="Supprimer toutes les cases de la planche">
          <Eraser size={15} /> Vider
        </button>
        <div className="toolbar-spacer" />
        <div className="seg sm" role="radiogroup" aria-label="Sens de lecture">
          <button className={!rtl ? 'on' : ''} onClick={() => update((p) => ({ ...p, readingOrder: 'ltr' }))} title="Lecture occidentale">BD →</button>
          <button className={rtl ? 'on' : ''} onClick={() => update((p) => ({ ...p, readingOrder: 'rtl' }))} title="Lecture manga">← Manga</button>
        </div>
        <span className="hint">Glisse pour tracer une case · Suppr pour effacer</span>
      </div>
      <div className="stage-canvas" ref={stageRef}>
        <div className="page-wrap" style={{ width: W * fit, height: H * fit }}>
          {asset && <img src={asset.url} alt={page.name} draggable={false} />}
          <svg
            ref={(el) => { svgRef.current = el; }}
            viewBox={`0 0 ${W} ${H}`}
            className={`cut-overlay ${drag ? 'dragging' : ''}`}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <defs>
              <mask id="dim-mask">
                <rect width={W} height={H} fill="white" />
                {pageShots.map(({ s }) => <rect key={s.id} {...s.rect} fill="black" />)}
              </mask>
            </defs>
            <rect width={W} height={H} fill="rgba(5,5,7,0.55)" mask="url(#dim-mask)" pointerEvents="none" />
            {pageShots.map(({ s, i }) => {
              const on = sel?.kind === 'shot' && sel.id === s.id;
              const r = s.rect;
              const badge = Math.max(34, 26 / fit);
              return (
                <g key={s.id} className={`panel ${on ? 'on' : ''}`}>
                  <rect data-id={s.id} x={r.x} y={r.y} width={r.w} height={r.h} className="panel-rect" style={{ strokeWidth: (on ? 3 : 2) / fit }} />
                  <g pointerEvents="none" transform={`translate(${r.x + 8 / fit} ${r.y + 8 / fit})`}>
                    <rect width={badge * 1.25} height={badge} rx={badge * 0.25} className="panel-badge" />
                    <text x={badge * 0.625} y={badge * 0.7} fontSize={badge * 0.6} textAnchor="middle" className="panel-badge-text">{i + 1}</text>
                  </g>
                  {on && HANDLES.map((h) => {
                    const cx = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2;
                    const cy = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2;
                    return <rect key={h} data-id={s.id} data-h={h} className={`handle h-${h}`} x={cx - hs} y={cy - hs} width={hs * 2} height={hs * 2} rx={hs * 0.4} style={{ strokeWidth: 1.5 / fit }} />;
                  })}
                </g>
              );
            })}
            {draft && <rect {...draft} className="panel-draft" style={{ strokeWidth: 2 / fit, strokeDasharray: `${8 / fit} ${6 / fit}` }} />}
          </svg>
        </div>
      </div>
    </div>
  );
}

const roundRect = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
