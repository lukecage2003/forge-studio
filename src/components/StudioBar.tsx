import { useEffect, useMemo, useRef } from 'react';
import { FolderKanban, PenLine, Images, Scissors, AudioLines, Sparkles, Palette, Send, Check, Circle, AlertTriangle, Info, ChevronRight } from 'lucide-react';
import { getState, setUI, useStore } from '../store';
import { STUDIOS, studioChecks, studioReady, nextStudio, type CheckState } from '../lib/studios';
import { commands, type StudioId } from '../lib/commands';

const ICON: Record<StudioId, typeof Images> = { production: FolderKanban, script: PenLine, visual: Images, editing: Scissors, audio: AudioLines, motion: Sparkles, finishing: Palette, publishing: Send };
const STATE_ICON: Record<CheckState, typeof Check> = { ok: Check, todo: Circle, warn: AlertTriangle, info: Info };
const STATE_FR: Record<CheckState, string> = { ok: 'fait', todo: 'à faire', warn: 'à vérifier', info: 'information' };

/**
 * The eight studios: one row of workspaces over the same project. Choosing a
 * studio shows the main area that stage works in and a panel with what the
 * stage still needs (read from the project) and its real commands.
 */
export function StudioBar() {
  const project = useStore((s) => s.project);
  const studio = useStore((s) => s.ui.studio) ?? 'production';
  const open = useStore((s) => !!s.ui.studioPanel);
  const ref = useRef<HTMLDivElement>(null);
  const next = useMemo(() => nextStudio(project), [project]);
  const ready = useMemo(() => Object.fromEntries(STUDIOS.map((s) => [s.id, studioReady(project, s.id)])), [project]);
  const checks = useMemo(() => studioChecks(project, studio), [project, studio]);
  const cmds = useMemo(() => commands().filter((c) => c.studios?.includes(studio) && (!c.when || c.when())), [studio, project.aroll]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setUI({ studioPanel: false }); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setUI({ studioPanel: false }); };
    window.addEventListener('mousedown', away); window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [open]);

  const choose = (id: StudioId) => {
    const s = STUDIOS.find((x) => x.id === id)!;
    const same = getState().ui.studio === id;
    const patch: Parameters<typeof setUI>[0] = { studio: id, studioPanel: same ? !open : true };
    // the rush editor only makes sense with a rush; other studios keep the area the user is in
    if (s.mode && !same) patch.mode = id === 'editing' && getState().project.aroll ? 'rush' : s.mode;
    setUI(patch);
  };
  const run = (id?: string) => { const c = id && commands().find((x) => x.id === id); if (!c) return; setUI({ studioPanel: false }); setTimeout(c.run, 0); };
  const cur = STUDIOS.find((s) => s.id === studio)!;

  return (
    <div className="studiobar" ref={ref}>
      <nav className="studio-tabs" role="tablist" aria-label="Studios">
        {STUDIOS.map((s) => {
          const Icon = ICON[s.id];
          return (
            <button key={s.id} role="tab" aria-selected={studio === s.id} aria-expanded={studio === s.id ? open : undefined}
              className={`studio-tab${studio === s.id ? ' on' : ''}${s.id === next ? ' next' : ''}`}
              title={`${s.label} — ${s.hint}${s.id !== 'production' ? (ready[s.id] ? ' (prêt)' : '') : ''}`} onClick={() => choose(s.id)}>
              <Icon size={14} />
              <span className="studio-label">{s.short}</span>
              {s.id !== 'production' && <span className={`studio-dot${ready[s.id] ? ' ok' : ''}`} aria-label={ready[s.id] ? 'prêt' : 'à compléter'} />}
            </button>
          );
        })}
      </nav>
      {open && (
        <div className="studio-panel" role="region" aria-label={`Studio ${cur.label}`}>
          <div className="studio-panel-head"><b>{cur.label}</b><span className="help">{cur.hint}</span></div>
          <ul className="studio-checks">
            {checks.map((c) => {
              const I = STATE_ICON[c.state];
              return (
                <li key={c.label} className={`sc-${c.state}`}>
                  <I size={14} aria-label={STATE_FR[c.state]} />
                  <span className="sc-label">{c.label}</span>
                  {c.detail && <span className="sc-detail">{c.detail}</span>}
                  {c.cmd && c.state !== 'ok' && <button className="btn ghost sm" onClick={() => run(c.cmd)}>{c.state === 'info' ? 'Ouvrir' : 'Faire'} <ChevronRight size={12} /></button>}
                </li>
              );
            })}
          </ul>
          {cmds.length > 0 && <div className="studio-cmds">{cmds.map((c) => <button key={c.id} className="btn sm" onClick={() => run(c.id)}>{c.label}</button>)}</div>}
        </div>
      )}
    </div>
  );
}
