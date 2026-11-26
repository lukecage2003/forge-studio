---
name: forge-add-transition
description: Add a transition to Forge (Canvas or gl-transitions shader) so it appears in the inspector, the profiles and the tests.
---
1. Add its id to `Transition` in `src/types.ts`.
2. Declare it in `TRANSITIONS` (`src/engine/effects.ts`): category, French label and description, `params` (min, max, default), `moves` (motion blur), `sfx` (whoosh gain, 0 = silent), `minDur`.
3. Draw it:
   - **Canvas:** add a `case` in the transition switch of `render.ts`, reading its settings with `tp(shot, 'key')`.
   - **Shader:** copy the `.glsl` file (MIT, keep its header) into `src/engine/gl/`, import it in `gl/index.ts` (`SOURCES`), and set `gl: 'Name'` in the catalogue.
4. Optional: put it in a profile palette (`src/engine/direction.ts`). The profile tests check budget and no repetition automatically.
5. Run the forge-verify skill. The visual test adds a reference image for it.
