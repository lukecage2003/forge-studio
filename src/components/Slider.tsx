import { useEffect, useRef, useState } from 'react';

/**
 * Precise slider: drag, or click the value and type it (Enter to apply,
 * ↑/↓ to nudge by one step, Maj for ×10). Units are read from the formatter
 * (%, s, ms, dB) so typed values use the same unit as the display.
 */
export function Slider({ label, value, min, max, step, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const shown = fmt ? fmt(value) : String(value);
  const sample = fmt ? fmt(max) : '';
  const scale = /%$/.test(sample) && max <= 2.5 ? 100 : /ms$/.test(sample) ? 1000 : 1;
  const unit = (/(%|ms|s|dB)$/.exec(sample) ?? [''])[0];
  const decimals = scale === 1 && step < 1 ? Math.min(3, Math.max(0, Math.ceil(-Math.log10(step)))) : 0;
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
  useEffect(() => { if (edit !== null) ref.current?.select(); }, [edit !== null]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    if (edit === null) return;
    const n = parseFloat(edit.replace(',', '.'));
    if (Number.isFinite(n)) onChange(snap(n / scale));
    setEdit(null);
  };
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="slider">
      <span className="slider-top">
        <span>{label}</span>
        {edit === null ? (
          <button type="button" className="slider-val" title="Cliquer pour taper une valeur" onClick={() => setEdit((value * scale).toFixed(decimals))}>{shown}</button>
        ) : (
          <span className="slider-edit">
            <input ref={ref} value={edit} inputMode="decimal" aria-label={label}
              onChange={(e) => setEdit(e.target.value)} onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEdit(null);
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                  e.preventDefault();
                  const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
                  const nv = snap(value + d);
                  onChange(nv);
                  setEdit((nv * scale).toFixed(decimals));
                }
              }} />
            {unit && <span className="unit">{unit}</span>}
          </span>
        )}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        style={{ ['--p' as string]: pct + '%' }} onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}
