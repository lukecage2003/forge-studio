# Forge : architecture du moteur de production

Ce document décrit comment Forge est construit, pour le maintenir ou l'étendre sans casser l'existant. Pour l'utilisation, voir le [README](../README.md).

## Principes

1. **Local d'abord.** Tout tourne dans le navigateur. Google Gemini est optionnel et jamais requis.
2. **Non destructif.** Un projet est un JSON de décisions : cadrages, coupes, transitions, réglages. Les médias d'origine ne sont jamais modifiés.
3. **Aperçu = rendu final.** Une seule fonction dessine une image à l'instant `t` (`createRenderer().draw`). L'aperçu et l'export l'appellent tous les deux.
4. **Déterministe.** Même projet, même vidéo, au pixel près : aucun `Math.random()` n'atteint le rendu ni le son (`engine/rng.ts`). Le projet note la version du moteur (`engine`).
5. **Sobre par défaut.** Les effets sont un budget, pas une décoration : profils de direction, contrôle des répétitions, son jamais sur chaque coupe.

## Parcours d'un montage

```
PDF / CBZ / images ──► importers ──► classify (couverture, pub…) ──► detect (cases)
rush face caméra ────► speech (silences, « euh », reprises) ──► whisper / gemini (mots)
script ou voix ──────► narration ──► understand (OCR, bulles) ──► story (phrase ↔ case)
                                         │
                                         ▼
                         auto (montage) ──► direction (profil, narrative, budget)
                                         │
                                         ▼
          validate ──► render (Canvas 2D + gl/ WebGL + scene3d three.js) ──► preview
                                         │
                                         ▼
          export : images ► WebCodecs H.264 · son ► audio (voix prioritaire) ► loudness (−14 LUFS)
          report (contrôle qualité) · otio (DaVinci) · srt · chapitres YouTube
```

## Modules du moteur (`src/engine`)

| Domaine | Modules | Rôle |
|---|---|---|
| Import | `importers`, `classify`, `detect`, `media` | PDF (pdf.js), CBZ (fflate, ComicInfo.xml), type de page, découpe des cases (gouttières + XY-cut + consensus), cache des médias |
| Parole | `speech`, `whisper`, `google`, `lexicon`, `faces`, `segment` | dérushage, transcription, correction des noms, suivi du visage, détourage |
| Compréhension | `understand`, `narration`, `story`, `embed`, `narrative` | OCR des bulles, phrases, appariement phrase ↔ case (Viterbi), temps forts du récit |
| Montage | `auto`, `direction`, `brain`, `beats`, `emphasis`, `brand` | montage auto, 8 profils créatifs, apprentissage des corrections, beat, zooms d'accent, identité de chaîne |
| Rendu | `render`, `motion`, `effects`, `gl/`, `scene3d`, `layers`, `vision`, `timeline` | dessin d'une image, jetons de mouvement, catalogue d'effets, transitions GPU, scènes 3D, relief 2.5D |
| Son | `audio`, `sfx`, `loudness` | mixage, voix prioritaire, bruitages budgétés, mesure BS.1770 et limiteur |
| Sortie | `export`, `otio`, `report`, `qc`, `validate`, `bench` | MP4 1080p / 4K, DaVinci, rapport qualité, contrôle avant export, réparation, banc de mesure |

## Étendre Forge

- **Une transition :**
  1. ajoute son nom au type `Transition` (`types.ts`) ;
  2. déclare-la dans `TRANSITIONS` (`engine/effects.ts`) : catégorie, réglages, flou de mouvement, son, durée minimale.

  Pour une transition Canvas, ajoute un `case` dans `render.ts`, en lisant ses réglages avec `tp(shot, 'clé')`. Pour un shader gl-transitions, copie le `.glsl` dans `engine/gl/` et mets son nom dans `gl`. L'inspecteur crée les curseurs tout seul.
- **Un profil créatif :** ajoute une entrée à `PROFILES` (`engine/direction.ts`). Les tests vérifient automatiquement son budget, sa palette et l'absence de répétition.
- **Un type de schéma ou de scène 3D :** ajoute le type à `DiagramKind`. Ensuite, deux cas :
  - schéma 2D : branche dans `drawDiagram` (`render.ts`) ;
  - scène 3D : `build` / `animate` dans `scene3d.ts`, plus un repli 2D dans `FALLBACK_2D`.
- **Un réglage d'image :** ajoute un champ à `Look` et une entrée à `LOOK_EFFECTS`.

## Tests

| Commande | Ce qui est vérifié |
|---|---|
| `npm test` | 34 tests de logique, dont : dérushage, noms, réparation de projet, narration, jetons et courbes, catalogue d'effets, uniformes GLSL, analyse narrative, budget des 8 profils, budget des sons, scènes 3D du montage auto, volume BS.1770 (valeurs de référence de la norme), normalisation, baisse de la musique sous la voix, banc de mesure |
| `npm run test:visual` | 80 images comparées à `tests/visual/baseline` : 22 transitions, mouvements, options d'image, échelle, scènes 3D en 16:9 et 9:16, repli 2D. Le seuil d'écart est de 0,2 % des pixels |
| `npm run test:visual:update` | régénère les références après un changement voulu |

À chaque `git push` sur `main` (`.github/workflows/deploy.yml`) :

1. **Contrôle visuel :** la version précédente est rendue comme référence sur la même machine, puis la nouvelle version est comparée image par image. Une différence bloque la mise en ligne, sauf si le message de commit contient `[visuel]`. Les images fautives sont jointes au rapport GitHub.
2. **Tests de logique :** une erreur bloque la mise en ligne.
3. **Compilation et publication** sur GitHub Pages.

## Performance

**Réglages → Performance de cet ordinateur.** Ce banc mesure sur des pages de test, sans toucher au projet :
- le temps d'une image 1080p et 4K ;
- une transition GPU ;
- une scène 3D ;
- un vrai export MP4 de 3 s ;
- les encodeurs disponibles (H.264, 4K, AAC).

Il traduit ces mesures en conseils : fluidité de l'aperçu, durée d'export de 10 min de vidéo.

**Référence, machine de test sans carte graphique** (4 cœurs, Chromium en rendu logiciel) :

| Mesure | Résultat |
|---|---|
| Image 1080p | 91 ms |
| Image 4K | 374 ms |
| Transition GPU | 676 ms |
| Scène 3D | 140 ms |
| Export | 8,4 × la durée de la vidéo |

Un PC avec carte graphique est nettement plus rapide.

## Licences des briques externes

| Brique | Licence | Usage |
|---|---|---|
| three.js 0.187 | MIT | scènes 3D, chargé à la demande |
| gl-transitions (9 shaders) | MIT, voir `src/engine/gl/LICENSE-gl-transitions` | transitions GPU |
| mediabunny | MPL-2.0 | lecture et écriture MP4 |
| pdf.js | Apache-2.0 | lecture des PDF |
| transformers.js et modèles (Whisper, Depth Anything V2, BiRefNet, MiniLM) | Apache-2.0 / MIT | IA locale |
| MediaPipe Tasks | Apache-2.0 | visage, détourage |
| Tesseract.js | Apache-2.0 | OCR |
| fflate | MIT | CBZ et zip |
| Playwright | Apache-2.0 | tests visuels uniquement (non livré) |

Le format OpenTimelineIO (Apache-2.0) est écrit directement, sans dépendance. Écartés après l'audit : Remotion (licence payante), GSAP (licence restrictive), Natron, Blender et ComfyUI (GPL).
