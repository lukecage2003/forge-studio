import { useEffect, useReducer } from 'react';
import { onMediaChange } from '../engine/media';

/** Re-render when any media finishes decoding. */
export function useMediaVersion() {
  const [v, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const off = onMediaChange(bump);
    return () => { off(); };
  }, []);
  return v;
}
