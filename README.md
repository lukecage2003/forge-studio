<p align="center"><img src="docs/forge-mark.svg" width="72" alt="Forge"></p>

<h1 align="center">FORGE</h1>
<p align="center"><b>Comic Motion Studio</b> — tes planches de comics en vidéos rythmées pour TikTok, Shorts et YouTube.</p>

---

Forge est une application web de montage pour les vidéos qui expliquent des comics, en face caméra ou en voix off. Tu importes ton rush et tes planches. Forge coupe les silences, les « euh » et les reprises, alterne ton visage avec les cases, ajoute les zooms et les sous-titres, puis exporte un MP4 prêt pour TikTok, Shorts et YouTube. Tout tourne dans le navigateur : tes fichiers ne quittent pas ton ordinateur, sauf si tu actives Google AI.

## 1. Dérushage du face caméra (onglet Rush)

| Ce qui est coupé | Comment |
|---|---|
| Silences et respirations | Mesure du bruit de la pièce, seuil réglable, marge autour de la voix, coupe calée au creux du son (pas de clic) |
| Hésitations (« euuuh », « mmmh ») | Détectées au son, sans transcription : son tenu, stable, sans consonne, isolé par des pauses |
| « Euh » de la transcription | Repérés dans le texte puis localisés précisément dans le son |
| Reprises et faux départs | « Alors Batman il… Alors Batman il a décidé » : la première prise est retirée |

Tout est révisable : liste des coupes avec écoute, waveform zoomable (glisser = couper), transcription cliquable au mot près (clic = couper/garder, Maj+clic = plage). Les cas douteux sont proposés « à vérifier » au lieu d’être coupés d’office.

Transcription au choix : **Whisper en local** (gratuit, hors ligne après le premier téléchargement du modèle) ou **Google Gemini** (verbatim, garde les « euh »).

## 2. Montage automatique (touche A)

Le rush coupé sert de colonne vertébrale. Les cases se posent dessus en blocs qui commencent et finissent sur les coupes et les fins de phrase, ce qui masque aussi les sauts d’image.

- **Explication** : cases plein écran, page entière avec projecteur, visage en ouverture et en relance (format « comics expliqués », idéal en 16:9).
- **Énergique** : visage très présent, écrans partagés, bulle visage, multi-cases, zooms de coupe marqués (idéal en 9:16).
- Sans face caméra : **Dynamique**, **Cinématique**, **Manga** (calage sur le beat de la musique ou sur la voix off).

**Mises en page** : plein écran · écran partagé visage + case · bulle visage sur la case · multi-cases (2 à 4 ensemble) · page entière avec la case mise en lumière.

**Zooms** : à chaque coupe, alternance de cadrages (100 % / +16 % / +7 %) centrés sur ton visage (clique sur ton visage une fois pour le régler), plus une poussée lente sur les prises longues.

**Habillage** : sous-titres mot à mot synchronisés sur ta voix (6 styles), nom à l’écran (« Bruce Wayne »), accroche d’ouverture posée sur ton visage, fond trame comics, barre de progression, couleur d’accent, signature @compte.

## 3. Forge apprend de toi

Chaque correction d’une décision automatique (durée d’un plan, mise en page, mouvement, intensité, coupe rétablie ou ajoutée, case retirée) ajuste les préférences de Forge. Le montage suivant en tient compte. Ce qu’il a appris est affiché dans les Réglages, avec une remise à zéro. Les données restent dans le navigateur.

## 4. Google AI (optionnel)

Dans Réglages, colle une clé Gemini (gratuite sur aistudio.google.com). Forge peut alors :
- transcrire le rush mot à mot en gardant les hésitations ;
- placer chaque case sur la phrase qu’elle illustre (analyse des images + du script) ;
- proposer des accroches.

La clé est stockée dans ce navigateur et les appels partent directement vers Google.

## 5. Import de comics : PDF, CBZ, images

Glisse un ou plusieurs **PDF**, **CBZ/ZIP** ou images. Chaque page est rendue en haute définition, puis découpée :

- **Doubles pages** : coupées en deux, lecture dans l’ordre (BD ou manga).
- **Contrôles** : petites zones, cases imbriquées, couverture insuffisante, marge non uniforme ou gouttières « sales ».
- **Si la détection n’est pas fiable** (art sans gouttières, peinture, couverture, page texte), la page est animée **par zones** dans l’ordre de lecture avec un projecteur. Une page est donc toujours animée, jamais sautée ni mal découpée.
- **Pleine page** (splash) : recul et secousse d’impact.
- Un clic sur l’œil d’une page l’**exclut** du montage (pub, crédits…).

## 6. Effets face caméra

Ton visage est détouré en local (Google MediaPipe). À placer à la tête de lecture ou ajoutés par le montage auto :

- **Texte derrière moi** : un grand titre posé entre le décor et toi (l’accroche du montage auto l’utilise).
- **Case derrière moi** : une case remplace ton décor (le style Énergique s’en sert pour annoncer la suite).
- **Fond flou**, **fond trame comics**, **mot choc** (texte d’impact devant).
- **Étalonnage** (Naturel, Cinéma, Chaud, Punchy, Noir), **vignette**, **grain**.

## 7. Schémas avec tes cases

Bouton **Schéma** : frise chronologique, réseau de personnages (liens nommés), duel « VS », classement (compte à rebours). Les cartes utilisent tes cases (aucune image générée) et s’animent une à une.

## 8. Contrôle anti-erreurs

Après chaque montage auto et avant chaque export, Forge vérifie et répare le projet : pages manquantes, durées invalides, cases hors page, chevauchements, audio au-delà de sa source, sous-titres vides.

## Autres fonctions

- Formats 9:16, 16:9, 1:1, 4:5 et zones de sécurité TikTok.
- Détection automatique des cases (BD ou manga), retouche à la souris.
- 7 transitions, 8 mouvements de caméra, secousse d’impact.
- Pistes musique, voix off, bruitages, enregistrement micro, ducking automatique sous ta voix.
- Export MP4 1080p image par image (WebCodecs), sous-titres `.srt` depuis la transcription, miniature `.png`.
- Sauvegarde automatique, fichier projet `.forge`, annuler/rétablir.

## Raccourcis

| Touche | Action |
|---|---|
| `Espace` | Lecture / pause |
| `←` `→` | Image par image (`Maj` : par seconde) |
| `Suppr` | Supprimer la sélection |
| `Ctrl+Z` / `Ctrl+Maj+Z` | Annuler / rétablir |
| `A` | Montage auto |
| `1` / `2` / `3` | Rush / Découpe / Aperçu |

## Lancer en local

```bash
npm install
npm run dev
```

Puis ouvrir l'adresse affichée. Navigateur recommandé : **Chrome** ou **Edge** (encodage AAC natif). Firefox fonctionne, avec l'audio en Opus.

## Mettre en ligne

Le workflow `.github/workflows/deploy.yml` publie Forge sur GitHub Pages à chaque push sur `main`. Il suffit d'activer *Settings → Pages → Source : GitHub Actions* sur le dépôt. Le dossier `dist/` produit par `npm run build` peut aussi être déposé tel quel sur Netlify, Vercel ou tout hébergeur statique.

## Architecture

```
src/
  engine/
    render.ts     rendu d'une image à l'instant t (caméra, transitions, sous-titres)
    auto.ts       montage automatique
    detect.ts     détection des cases (découpe XY récursive sur les gouttières)
    speech.ts     analyse de la voix : silences, hésitations, « euh », reprises
    whisper.ts    transcription locale (Whisper, Web Worker)
    google.ts     Google Gemini : transcription verbatim, placement des cases, accroches
    brain.ts      apprentissage des préférences à partir des corrections
    video.ts      lecture du face caméra à travers les coupes
    beats.ts      détection du tempo
    audio.ts      mixage (aperçu temps réel + rendu hors ligne), ducking
    export.ts     encodage MP4 (mediabunny / WebCodecs), SRT
    transport.ts  lecture, pause, déplacement
    media.ts      décodage et cache des images et sons (IndexedDB)
  components/     interface (React)
  brand/          logo
  store.ts        état du projet, historique annuler/rétablir
```

Le rendu est une fonction pure du temps : l'aperçu et l'export utilisent exactement le même moteur, donc ce qu'on voit est ce qu'on exporte.

Identité visuelle : voir [BRAND.md](BRAND.md).
