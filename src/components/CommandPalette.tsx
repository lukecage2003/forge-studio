import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { commands, type Cmd } from '../lib/commands';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean);
    return commands().filter((c) => (!c.when || c.when()) && words.every((w) => norm(c.label + ' ' + c.group).includes(w)));
  }, [q]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { setI(0); }, [q]);
  const run = (c?: Cmd) => { if (!c) return; onClose(); setTimeout(c.run, 0); };
  return (
    <div className="modal-back palette-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-label="Commandes">
        <div className="palette-search">
          <Search size={16} />
          <input ref={input} value={q} placeholder="Que veux-tu faire ?" onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(list.length - 1, x + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              if (e.key === 'Enter') run(list[i]);
              if (e.key === 'Escape') onClose();
            }} />
          <kbd>Échap</kbd>
        </div>
        <ul className="palette-list" role="listbox">
          {list.map((c, k) => (
            <li key={c.id} role="option" aria-selected={k === i} className={k === i ? 'on' : ''} onMouseEnter={() => setI(k)} onClick={() => run(c)}>
              <span className="pg">{c.group}</span>
              <span className="pl">{c.label}</span>
              {c.keys && <kbd>{c.keys}</kbd>}
            </li>
          ))}
          {!list.length && <li className="empty">Aucune commande</li>}
        </ul>
      </div>
    </div>
  );
}
