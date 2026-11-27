import type { Project } from '../types';
import { ENGINE_VERSION } from '../engine/rng';

/**
 * PROJECT SCHEMA — every project carries the number of the data layout it was
 * written with. Opening runs the ordered migrations from that number up to the
 * current one, so a project of any earlier version opens; a project written by
 * a NEWER Forge is opened without losing what this version does not know
 * (unknown fields are kept as they are) and the user is told.
 *
 * To change the layout: add a step to MIGRATIONS (it receives the project at
 * version `to - 1`), then raise SCHEMA_VERSION. Never edit a past step.
 */
export const SCHEMA_VERSION = 2;

/** versions of the engines whose output a project depends on: raise one when the same project would render differently */
export const ENGINE_VERSIONS = { render: ENGINE_VERSION, comicCamera: 1, director: 1, storyboard: 1, transcription: 2 } as const;

/** this build of Forge (set at build time; 'dev' when running from sources) */
export const APP_VERSION = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_FORGE_BUILD ?? 'dev';

type Step = { to: number; what: string; run: (p: Project) => Project };
/**
 * Step 1 → 2: projects saved before the schema number existed. Their fields were
 * completed with defaults at every opening (store.migrate does that, and still
 * runs after the steps for safety); nothing to rename here.
 */
export const MIGRATIONS: Step[] = [
  { to: 2, what: 'numéro de schéma ajouté', run: (p) => p },
];

export const schemaOf = (p: Partial<Project> | null | undefined) => (p?.schemaVersion ?? 1);

/** pure: bring a project to the current schema; a newer project keeps its number and its unknown fields */
export function upgrade(p: Project): { project: Project; from: number; steps: string[]; newer: boolean } {
  const from = schemaOf(p);
  if (from > SCHEMA_VERSION) return { project: p, from, steps: [], newer: true };
  let cur = p;
  const steps: string[] = [];
  for (const m of MIGRATIONS) if (m.to > from && m.to <= SCHEMA_VERSION) { cur = m.run(cur); steps.push(m.what); }
  return { project: { ...cur, schemaVersion: SCHEMA_VERSION }, from, steps, newer: false };
}

export const newerMessage = (v: number) =>
  `Ce projet a été enregistré par une version plus récente de Forge (schéma ${v}, celle-ci lit le ${SCHEMA_VERSION}). Il est ouvert sans rien effacer, mais des réglages récents peuvent être ignorés : recharge Forge pour avoir la dernière version.`;

/* one place the interface listens to (the store must not import the interface) */
const subs = new Set<(msg: string) => void>();
export const onSchemaNotice = (f: (msg: string) => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const schemaNotice = (msg: string) => subs.forEach((f) => f(msg));
