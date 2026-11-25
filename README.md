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

### Comment la découpe fonctionne

1. **Gouttières remplies depuis les bords** (blanches, noires ou couleur du bord, la meilleure est retenue). Les bulles enfermées dans une case n’y sont jamais rattachées.
2. **Chaque bloc restant forme une case**, puis vient un nettoyage repris de Kumiko (njean42/kumiko) : fragments proches regroupés, petites zones retirées, chevauchements corrigés, cases étendues jusqu’à la gouttière voisine.
3. **Contrôle par consensus** : un second détecteur indépendant (découpe XY) doit trouver les mêmes cases. Sinon la page est animée **bande par bande** (ses vraies rangées), jamais n’importe comment.
4. **Option IA Google** : bouton « IA Google » dans Découpe, ou case à cocher dans le montage auto pour recouper les pages incertaines avec Gemini.

Testé sur deux numéros complets de *Before Watchmen: Dr. Manhattan* (55 pages) : import en 8 s, montage auto sans erreur.

### Reconnaissance des pages

Chaque page est classée, comme dans les serveurs de comics (Komga, Kavita) et le standard ComicInfo.xml des CBZ (lu quand il est présent) :

| Type | Comment il est reconnu | Au montage |
|---|---|---|
| Couverture | première page du fichier, une illustration | ouvre le numéro, recul lent, nom du numéro (« #3 ») si plusieurs numéros |
| Couverture variante | suit la couverture ou fin du numéro | exclue (réactivable) |
| Planche | cases ou bandes détectées | découpée et animée case par case |
| Pleine page | une seule image dans l’histoire | recul et impact |
| Double page | environ deux fois la largeur d’une page du numéro | traversée en panoramique |
| Texte / crédits | lignes de texte régulières sur fond uni | exclue |
| Publicité | format différent du reste du numéro (pages de sites de scans) | exclue |
| Page vide | image unie | exclue |

Le type se change d’un clic dans la liste des planches, et **Classer avec Google** fait vérifier toutes les pages par Gemini (une requête pour 40 pages).

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

## 9. Qualité du rendu

- **Zooms intelligents** : chaque case reçoit un point d’intérêt (zone la plus détaillée, bulles exclues) ; les zooms y vont au lieu du centre.
- **Lecture guidée** des pages incertaines : cadrage serré qui longe chaque bande, texte lisible même en 9:16 ; bandeaux de sites de scans écartés.
- **12 transitions** : cut, glissé caméra, fondu, poussée, whip, zoom, flash, coupe BD diagonale, iris, glitch, passage au noir, fondu flou ; chaque style varie ses transitions.
- **Secousse en ressort** (position + rotation, sans bords visibles), **lignes de vitesse** manga sur les impacts, **caméra à l’épaule** réglable.
- **Flou de mouvement** à l’export (4 sous-images, obturateur 180°) sur les mouvements rapides.
- **Bruitages automatiques synthétisés** : souffle sur les transitions, impact sur les pleines pages et les mots chocs, volume réglable, toujours sous la voix.
- **Durée respectée** : si trop de cases pour la durée demandée, Forge en choisit une sélection (couvertures et pleines pages gardées).

## 10. Précision

- **Visage détecté et suivi automatiquement** (Google MediaPipe, local) : recadrage 9:16, zooms de coupe centrés sur les yeux, zoom limité pour que le visage ne dépasse jamais ~45 % de la largeur. Le clic manuel reste possible.
- **Jamais de fond noir** : partout où l’image ne remplit pas le cadre, la page de comics floutée apparaît derrière.
- **Valeurs au clavier** : clic sur une valeur pour la taper (↑/↓ pour ajuster, Maj ×10) ; durées à l’image près (1/30 s), timeline aimantée à l’image.
- **Découpe au pixel** : flèches = 1 px (Maj 10 px), Alt+flèches = taille, aimantation sur les bords des autres cases et de la page (Alt pour désactiver), coordonnées affichées.
- **Chapitres YouTube** copiés en un clic depuis l’export (couvertures, schémas, cartons).

## 11. Confort

- **Palette de commandes** (Ctrl+K) : toutes les actions au clavier (importer, montage auto, effets, schémas, formats, onglets…).
- **Styles visuels en un clic** : Naturel, Cinéma, Pop TikTok, Noir comics, Papier rétro.
- **Appliquer à tous** : même transition ou même mouvement de caméra sur tous les plans.
- **Aperçu** plein écran et en boucle ; heure exacte au survol de la timeline.
- **Effets en plus** : brûlure de pellicule (transition), aberration chromatique sur les impacts, texture papier BD, sous-titres « glissé ».

## 12. Montage qui suit ta narration

Donne ta voix (rush ou voix off transcrite) ou colle ton script, et tes PDF : Forge choisit pour chaque phrase la case qui l’illustre, et ne montre que les passages utiles.

1. **Lire les comics** (barre de gauche) :
   - *Bulles (local)* : OCR des bulles sur ton ordinateur (Tesseract, anglais + français), gratuit ;
   - *Google* : Gemini résume chaque page et décrit chaque case (personnages, action, dialogues) ; les pages incertaines reçoivent ses cases.
2. **Montage auto → « Suivre la narration »** :
   - *Local* : noms propres, nombres et mots communs, puis un alignement qui suit l’ordre de lecture (Viterbi) ;
   - *Google* : compréhension du sens (théories, cosmologie, résumés, narration française sur comics anglais) et schémas proposés (frise, réseau, duel, classement).
3. Le nom d’un personnage s’affiche à sa première mention ; sur un face caméra, une phrase incertaine montre ton visage plutôt qu’une mauvaise case.
4. **À vérifier** : les placements peu sûrs sont listés (inspecteur du projet, point rouge dans la timeline). Pour chacun : la phrase, la confiance, des cases alternatives en un clic, « C’est la bonne », ou n’importe quelle autre case.

Sans voix transcrite, le script donne des durées estimées (~155 mots/minute) et sert de sous-titres. Une voix off se transcrit depuis son inspecteur (local ou Google).

## 13. Compréhension locale (sans Google)

Forge lit et comprend les comics tout seul ; Google n’est qu’un bonus.

- **Lecture des bulles** : les bulles et récitatifs sont repérés (zones claires contenant du lettrage), agrandis puis lus un par un (Tesseract, anglais + français). Les pages sans bulles sont lues en entier.
- **Compréhension du sens** : un modèle multilingue (paraphrase-multilingual-MiniLM, ~118 Mo, une seule fois) tourne dans le navigateur. Une phrase en français et une bulle en anglais qui disent la même chose sont rapprochées, puis l’alignement suit l’ordre de lecture.
- **Lexique des noms** : personnages tirés des cases, du script, des mots récurrents et de la recherche. Il sert à étiqueter les cases avec leurs personnages et à **corriger les noms mal transcrits** (comparaison phonétique : « Laury » → « Laurie », « Ostermann » → « Osterman »).
- **Recherche Google en arrière-plan** (optionnelle) : identifie le numéro, les personnages et leurs autres noms (identité civile, surnoms), le résumé et des faits clés, avec sources. Ces infos enrichissent le lexique, les étiquettes et l’association par Google.

## 14. Motion comic 2.5D

- **Relief** : un modèle de profondeur local (Depth Anything V2 small, Apache-2.0, ~27 Mo) sépare le personnage du décor ; le trou laissé dans le décor est comblé par un flou des alentours. Pendant le mouvement de caméra, le décor glisse peu, le personnage glisse plus et avance légèrement : effet « motion comic ». Calculé en arrière-plan après le montage auto, à la volée dans l’aperçu, et toujours avant l’export.
- **Bulles qui apparaissent une à une** dans l’ordre de lecture (pop), à partir du repérage des bulles.

## 15. Montage calé sur la voix

Les temps forts de ta voix (mot appuyé, montée d’énergie) sont repérés sur le rush et les voix off ; l’image fait un léger zoom d’accent à ces instants, sur les cases comme sur ton visage.

## 16. Ma chaîne

Bouton couronne (ou Ctrl+K → « Ma chaîne ») :
- **Identité** : fond jaune, titres noirs, logo (le logo Forge « creuset griffé » par défaut, ou le tien).
- **Intro logo** (1,2 s), **carton de chapitre** aux couleurs de la chaîne avant chaque numéro, **écran de fin YouTube** (10 s, deux emplacements pour tes vidéos, en 16:9).
- **Miniatures YouTube, en 3 gestes**, sur fond jaune avec aperçu en direct :
  1. tape le titre (1-2 mots) ;
  2. ajoute 1 ou 2 personnages : **« Chercher un PNG »** ouvre Google Images (PNG à fond transparent) → clic droit « Copier l’image » → **Ctrl+V** dans Forge ; ou glisse un fichier ; ou prends une case de tes comics ;
  3. **Télécharger** (PNG 1280×720).
  Les PNG transparents sont utilisés tels quels ; sinon le fond est retiré tout seul (BiRefNet sur WebGPU, Magic Touch de MediaPipe sinon). Contour blanc, ombre, placement façon affiche et logo en bas à gauche sont automatiques.

Le logo et ses variantes sont dans `brand-kit/` (SVG).

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

Le workflow `.github/workflows/deploy.yml` publie Forge sur la branche `gh-pages` à chaque push sur `main`. Adresse : https://lukecage2003.github.io/forge-studio/ (si elle ne répond pas : *Settings → Pages → Source : Deploy from a branch → gh-pages / root*). Le dossier `dist/` produit par `npm run build` peut aussi être déposé tel quel sur Netlify, Vercel ou tout hébergeur statique.

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
