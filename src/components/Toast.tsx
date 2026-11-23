import { useEffect, useState } from 'react';

type T = { id: number; text: string; tone: 'info' | 'error' };
let push: ((t: T) => void) | null = null;
let n = 0;

export const toast = (text: string, tone: 'info' | 'error' = 'info') => push?.({ id: ++n, text, tone });

export function Toasts() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    push = (t) => {
      setItems((x) => [...x, t]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== t.id)), t.tone === 'error' ? 6000 : 3200);
    };
    return () => { push = null; };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>
      ))}
    </div>
  );
}
