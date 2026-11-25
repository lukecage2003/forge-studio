/**
 * Seeded randomness for everything that ends up in a frame or a sound.
 * Same seed, same numbers, on every machine and every session: a project
 * renders to the same video each time (Math.random() never reaches the render).
 */
export type Rng = () => number;

/** mulberry32: tiny, fast, good enough for textures and noise */
export function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** stable 32-bit hash of a string (FNV-1a), to derive seeds from names */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** version of the rendering engine, stored in projects for reproducibility */
export const ENGINE_VERSION = 3;
