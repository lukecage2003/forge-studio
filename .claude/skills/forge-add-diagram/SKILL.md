---
name: forge-add-diagram
description: Add a schema / diagram / 3D scene kind (timeline, network, map, quote, scale…) to Forge.
---
1. Add the kind to `DiagramKind` (`src/types.ts`). Add a 3D kind to `DIAGRAM_3D` as well.
2. Draw it:
   - **2D:** a branch in `drawDiagram` (`src/engine/render.ts`), animated from `local` and `dur` only, with `EASE` from `motion.ts`.
   - **Full-frame kind** (like `map`): draw it before the title.
   - **3D:** `build` and `animate` in `src/engine/scene3d.ts`, plus a 2D fallback in `FALLBACK_2D`.
3. UI: in `KINDS` / `KINDS_3D` and `HELP_KIND` (`src/components/FxDiagram.tsx`), its default title and duration in `addDiagram` (`src/actions.ts`), and a command palette entry.
4. Script link: map a suggestion kind to it in `src/engine/suggest.ts` (`DK`), and detect it in `src/engine/scriptIntel.ts` if text can call for it.
5. Add frames to `tests/visual/scene.ts` (`renderScenes`), then run forge-verify.

## Style
Draw new kinds with `card()` and the helpers of `src/engine/ink.ts` (`inkBox`, `brush`, `caption`, `benDay`, `balloon`) and check `encre` for colours: text is `INK` on paper in the Encre style, white in the Néon style.
