<p align="center"><img src="docs/forge-mark.svg" width="72" alt="Forge"></p>

<h1 align="center">FORGE</h1>
<p align="center"><b>Comic Motion Studio</b> — tes planches de comics en vidéos rythmées pour TikTok, Shorts et YouTube.</p>

---

Forge est une application web de montage pour les vidéos qui expliquent des comics, en face caméra ou en voix off. Tu importes ton rush et tes planches. Forge coupe les silences, les « euh » et les reprises, alterne ton visage avec les cases, ajoute les zooms et les sous-titres, puis exporte un MP4 prêt pour TikTok, Shorts et YouTube. Tout tourne dans le navigateur : tes fichiers ne quittent pas ton ordinateur, sauf si tu actives Google AI.

> Documentation technique (architecture, extension, tests, performance, licences) : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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

## 17. Fiabilité

- **Aucune boucle d’affichage possible** : les lectures de l’état qui renvoient les mêmes valeurs sont réutilisées (cause du seul plantage rencontré).
- **Filets de sécurité** : chaque zone de l’interface est isolée ; si l’une a un problème, elle se réaffiche sans toucher au projet (sauvegardé en continu). Les erreurs sont évitées et notées dans un **journal** (Réglages → Journal des erreurs, copiable).
- **Contrôle qualité avant export** : plans trop courts, cases trop agrandies (floues), sous-titres sous l’interface TikTok, musique qui couvre la voix, saturation, médias manquants, associations à vérifier — avec correction en un clic.
- **Montage auto** : jamais de case affichée moins de 0,8 s.
- **Tests automatiques** (`npm test`) : dérushage (silences, hésitations, reprises), correction des noms, contrôle anti-erreurs, minutage du script, association script ↔ cases, zooms d’accent. Lancés par GitHub à chaque modification ; un test qui échoue bloque la mise en ligne.

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

Puis ouvrir l'adresse affichée. Navigateur recommandé : **Chrome** ou **Edge** sur Windows (encodage AAC natif, choix d'un dossier de projets sur le disque). Firefox fonctionne, avec l'audio en Opus et les projets gardés dans le navigateur.

## Compiler et vérifier

```bash
npm run build
```

Le site prêt à publier est dans `dist/`. Avant toute publication, la CI (Linux et Windows) lance :

```bash
npx tsc -p tsconfig.app.json --noEmit
```

```bash
npm test
```

```bash
npm run test:visual
```

```bash
node scripts/check-build.mjs dist
```

puis les scénarios de bout en bout de `tests/e2e/` contre `npx vite --port 5199`, dont `production.e2e.cjs` : une production complète, du projet vide à l'export, jusqu'à la réouverture du projet dans un autre navigateur. Une version qui échoue à un de ces contrôles n'est pas publiée.

## Mettre en ligne

Le workflow `.github/workflows/deploy.yml` publie Forge sur la branche `gh-pages` à chaque push sur `main`. Adresse : https://lukecage2003.github.io/forge-studio/ (si elle ne répond pas : *Settings → Pages → Source : Deploy from a branch → gh-pages / root*). Chaque publication garde 30 jours les fichiers de la précédente, pour qu'un onglet déjà ouvert continue de fonctionner, puis le site en ligne est vérifié. Le dossier `dist/` peut aussi être déposé tel quel sur Netlify, Vercel ou tout hébergeur statique.

## Sauvegarder et récupérer son travail

- **Où sont les projets.** *Projets → Stockage* : soit un dossier de ton disque (Chrome, Edge), soit l'espace privé du navigateur. Avec un dossier, chaque projet, ses versions et ses médias sont de vrais fichiers : sauvegarde ce dossier comme n'importe quel autre (disque externe, synchronisation).
- **Enregistrement automatique.** Chaque modification est écrite 2 secondes après, et une version automatique est prise toutes les 10 minutes de travail (les 30 dernières sont gardées).
- **Après une fermeture brutale.** Au redémarrage, Forge compare le journal du navigateur et le dossier et rouvre l'état le plus récent ; un message le signale.
- **Versions.** *Projets → Versions* : prendre une version nommée, comparer, restaurer. Restaurer garde d'abord l'état actuel dans une version, donc tout se défait.
- **Fichier .forge.** Le bouton *Enregistrer le projet* produit un fichier unique avec le projet, tous ses médias (rush compris), ses versions et un manifeste (version du format, de Forge et des moteurs). Ouvrir un .forge sur un autre ordinateur rend le projet complet ; s'il remplace un projet existant, l'état précédent est gardé dans les versions.
- **Projets d'une autre version de Forge.** Un projet ancien est mis à jour à l'ouverture. Un projet enregistré par une version plus récente s'ouvre sans rien perdre de ce que cette version ne connaît pas, avec un avertissement.
- **Faire de la place.** *Projets → Stockage → Libérer de la place* met à la corbeille les médias que plus aucun projet ni aucune version n'utilise (restaurable) et retire les copies en double du cache. Un média utilisé n'est jamais touché. Seul *Vider la corbeille*, après confirmation, supprime des fichiers.

## Studios

La barre sous le menu regroupe les outils par étape : Production, Recherche et script, Visuel, Montage, Son, Animation et sous-titres, Finition, Publication. Ce ne sont pas des applications séparées : les huit travaillent sur le même projet. Chaque studio dit ce qu'il reste à faire, lu dans le projet (un point vert quand l'étape est faite), et propose ses vraies commandes, les mêmes que la palette *Ctrl K*.

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

## Moteur de production : phase 3 (fondations motion et effets)

L'audit (phases 1 et 2) a conclu de garder l'architecture et de l'étendre par couches. La phase 3 pose ces fondations sans changer l'aspect des montages existants. Les 27 images de référence sans grain sont restées identiques au pixel près après la migration.

- **Rendu déterministe** (`src/engine/rng.ts`) : le grain, la texture papier et le bruit des bruitages viennent d'un hasard semé. Même projet, même vidéo, à chaque ouverture et sur chaque machine. Chaque projet note la version du moteur qui l'a créé (`engine`).
- **Jetons de mouvement** (`src/engine/motion.ts`) : durées (`DUR`), courbes (`EASE` : standard, soft, enter, pop, cinematic, snap) avec un solveur `cubicBezier` identique au CSS, intensités (`INTENSITY`) et ressort amorti (`spring`).
- **Catalogue d'effets** (`src/engine/effects.ts`) : 22 transitions et 9 effets d'image classés en 5 catégories (Comics, Cinéma, Cosmique / SF, Action, Information). Chaque transition déclare :
  - ses réglages (bornes et valeur par défaut) ;
  - si elle déclenche le flou de mouvement ;
  - le volume de son « whoosh » automatique (zéro pour les transitions muettes) ;
  - sa durée minimale lisible.

  L'inspecteur construit ses curseurs à partir de ce catalogue. Un réglage absent prend la valeur du catalogue, et la validation borne chaque valeur.
- **Transitions GPU** (`src/engine/gl/`) : 9 shaders choisis dans [gl-transitions](https://github.com/gl-transitions/gl-transitions) (licence MIT, voir `LICENSE-gl-transitions`) :

  | Transition | Catégorie |
  |---|---|
  | Zoom flou | Action |
  | Volet déformé | Cinéma |
  | Mise au point | Cinéma |
  | Trame BD | Comics |
  | Encre | Comics |
  | Vitesse lumière | Cosmique / SF |
  | Trou noir | Cosmique / SF |
  | Glitch numérique | Cosmique / SF |
  | Volet doux | Information |

  Elles passent par une petite couche WebGL que l'aperçu et l'export partagent. Sans WebGL, elles retombent sur un fondu.
- **Non-régression visuelle** :
  - `npm run test:visual` rend 50 images d'une scène synthétique (toutes les transitions, mouvements et options d'image, sans image protégée) et les compare aux références de `tests/visual/baseline`.
  - `npm run test:visual:update` régénère ces références.
  - Les références dépendent du rendu des polices et du GPU de la machine : génère-les sur celle qui les vérifie.

## Moteur de production : phase 4 (direction créative et rythme)

Dans « Montage auto », la **direction créative** propose 8 profils. « Classique » garde les styles d'avant. Le dernier choix est mémorisé.

| Profil | Esprit | Effets forts / min | Accents / min | Sons / min |
|---|---|---|---|---|
| Documentaire comics premium | sobre, trame BD et encre pour les grands moments | 1 | 4 | 3 |
| Cinématique cosmique | lent, mises au point, vitesse lumière, trou noir | 1 | 4 | 4 |
| Action et combat | whips, coupes BD, zoom flou, tremblements sur les coups | 4 | 10 | 10 |
| Analyse de personnage | fondus, iris, encre pour les tournants intimes | 1 | 4 | 3 |
| Explication scientifique | coupes nettes, volets propres | 1 | 3 | 2 |
| Frise historique | papier vieilli, volets sur les dates, brûlure pellicule | 1 | 5 | 3 |
| Échelle de puissance | montée en intensité, vitesse lumière au sommet | 2 | 8 | 8 |
| Commentaire éditorial | coupes sèches, poussées, un flash pour une opinion forte | 1 | 5 | 5 |

Chaque profil (`src/engine/direction.ts`) fixe :
- le rythme : durée des plans, intensité de caméra, mots par sous-titre ;
- la typographie des textes ;
- trois niveaux de transitions : calme, accent, fort ;
- leurs durées ;
- le budget d'effets par minute ;
- le tremblement maximal ;
- l'image : étalonnage, vignette, grain, papier ;
- le volume et le nombre de sons ;
- la densité de mise en page.

**Analyse narrative** (`src/engine/narrative.ts`, locale, français et anglais). Chaque phrase de la narration est classée en accroche, révélation, action, cosmique, date, comparaison, émotion, énumération ou explication.

**Comment le montage applique un profil** :
- **Choix du niveau de transition.** Un temps fort peut obtenir un effet fort. Une date, une comparaison ou une énumération obtient un accent. Le reste passe en coupe franche ou en fondu, dans la catégorie qui répond à la phrase : action pour un combat, cosmique pour l'univers, information pour une date.
- **Un changement de page** ne prend un accent que si la phrase suivante n'en a pas besoin.
- **Le budget est vérifié sur 60 secondes glissantes.**
- **Aucune transition visible n'est répétée deux fois de suite.**
- **Les tremblements sont réservés aux coups.**
- **Le son ne tombe jamais sur chaque transition** : 1,2 s minimum entre deux sons, et une limite par minute selon le profil.

**Contrôle qualité** : il signale une transition répétée deux fois de suite, avec correction en un clic, et plus de 12 transitions marquées par minute.

**Tests** :
- 10 tests vérifient l'analyse des phrases, le budget de chacun des 8 profils sur 2 min 24, l'absence de répétition, la palette, les durées et le son.
- Test réel sur Watchmen n°3 avec un script de 17 phrases : 8 montages, de 1 effet fort par minute (Premium) à 3,4 (Action), aucune répétition, aucune erreur de rendu, export MP4 vérifié.

## Moteur de production : phase 5 (3D et visualisation)

Toutes ces scènes sont construites uniquement avec tes cases de comics : aucune image n'est générée.

**Échelle** (2D, à la manière de manim) : les axes se tracent, les barres montent, les chiffres défilent. Mets une valeur dans « Détail » (10, 1 000, 1000000000). Si les valeurs vont du simple à plus de 40 fois plus, l'échelle devient logarithmique pour rester lisible. Sans valeur, l'ordre de la liste fait le classement.

**Scènes 3D** (`src/engine/scene3d.ts`, three.js 0.187, licence MIT) :

| Scène | Ce qu'on voit |
|---|---|
| Orbite 3D | les cases en cercle dans l'espace ; la caméra tourne puis passe de l'une à l'autre, les cases restent tournées vers elle |
| Cosmos 3D | les cases flottent à différentes profondeurs, la caméra avance à travers les étoiles et finit sur la dernière |
| Paliers 3D | échelle de puissance : des piliers montent du plus faible au plus fort, la caméra grimpe |

Fonctionnement :
- **Où les trouver :** bouton « Scène 3D » sous « Carton titre / Schéma », types dans l'inspecteur (2D et 3D), palette de commandes (Ctrl K).
- **Chargement :** three.js est chargé seulement quand le projet contient une scène 3D (188 Ko compressés, dans un fichier séparé).
- **Reproductible :** chaque image est une fonction du temps (étoiles semées, caméra lissée par les jetons de mouvement). L'aperçu et l'export sont identiques, et deux rendus donnent les mêmes pixels.
- **Formats :** les caméras s'adaptent au vertical 9:16, avec des cases plus petites et une caméra qui suit la montée.
- **Sans WebGL :** la scène se dessine en 2D (classement ou échelle), jamais d'écran vide.

**Dans le montage auto** :
- **Cinématique cosmique** peut transformer une phrase « cosmique » en scène Cosmos 3D.
- **Échelle de puissance** peut transformer une comparaison en Paliers 3D.
- La scène reprend la case de la phrase et ses voisines.
- Au plus 2 scènes par vidéo, espacées de 90 s ; les autres profils n'en créent pas.

**Corrections d'interface** :
- La page ne défile plus sur le côté quand la frise est longue (grille de l'application bornée à l'écran).
- Après l'ajout d'un schéma, l'aperçu saute dessus.

**Tests** :
- **Unitaires :** 27 tests au total. Les nouveaux vérifient la lecture des valeurs, et le profil cosmique (au plus 2 scènes, espacées, faites de cases, aucune pour les autres profils).
- **Visuels :** 80 images de référence, dont l'échelle, les 3 scènes 3D en 16:9 et en 9:16, et leur version 2D de secours. Elles sont identiques d'un lancement à l'autre.
- **Réel sur Watchmen n°3, avec script :**
  - les profils Cosmique et Puissance placent chacun une scène 3D sur la bonne phrase ;
  - environ 100 ms par image 3D en 1080p, sans carte graphique ;
  - le bouton et l'inspecteur fonctionnent, sans erreur de page ;
  - export MP4 1080p avec la scène vérifié.

## Moteur de production : phase 6 (son, contrôle qualité, échange, 4K)

**Voix prioritaire** (`src/engine/audio.ts`, réglable dans l'export) :
- La voix (rush et voix off) passe par un coupe-bas à 80 Hz, un compresseur doux 3:1, un léger relief de présence vers 3 kHz et un gain de compensation.
- La musique baisse sous la voix ; les bruitages aussi, mais moins (−4,4 dB).
- **Correction d'un défaut ancien :** quand la voix commençait dès 0 s, cas de presque tous les rushs, la musique descendait lentement sur toute la vidéo (−3,7 dB) au lieu de baisser tout de suite. Elle baisse maintenant du niveau réglé (−12 dB, mesuré).

**Volume des plateformes** (`src/engine/loudness.ts`) :
- **Mesure :** ITU-R BS.1770-4 / EBU R128 (pondération K, blocs de 400 ms, seuils −70 LUFS et −10 LU), plus l'écart de volume (LRA).
- **Normalisation :** −14 LUFS (YouTube, TikTok, Instagram), −16 LUFS, ou tel quel.
- **Limiteur :** il anticipe les crêtes de 5 ms et les garde sous −1,5 dBFS.
- **Correction en plusieurs passes :** quand le limiteur a écrêté des pics, le volume final atteint quand même la cible.
- Le volume obtenu s'affiche après l'export.

**Rapport qualité** (`src/engine/report.ts`, bouton « Rapport qualité » dans l'export) : une page HTML autonome avec une note sur 100. Elle couvre :
- le rythme ;
- les effets (par minute, répétitions, budget du profil) ;
- le son : volume mesuré, crête, LRA, présence de la voix, bruitages par minute ;
- les sous-titres (vitesse de lecture, durée) ;
- les zones sûres TikTok / Shorts ;
- l'image.

Le contrôle avant export signale aussi les sous-titres trop rapides et les textes sous les boutons, avec correction en un clic.

**DaVinci Resolve** (`src/engine/otio.ts`, bouton « DaVinci (.otio) ») : un .zip qui contient :
- `timeline.otio` (OpenTimelineIO) : pistes face caméra, cases avec transitions en fondus, voix, musique et bruitages ;
- les médias utilisés ;
- les sous-titres .srt ;
- un mode d'emploi.

Les cases arrivent comme leur page en plan fixe ; le cadrage, le mouvement et la transition Forge sont dans les métadonnées. Premiere passe par Resolve ou `otioconvert`.

**4K** : choix 1080p ou 4K (2160×3840 en vertical, 3840×2160 en 16:9), même moteur de rendu, avec un message clair si l'ordinateur ne sait pas encoder en 4K.

**Tests** :
- **Automatiques :** 33 tests, dont :
  - la valeur de référence de la norme (sinus 1 kHz sur un canal = −3,01 LUFS) ;
  - le gating du silence ;
  - la normalisation à −14 avec un pic écrêté ;
  - la baisse de la musique dès 0 s.
- **Réels, avec un rush face caméra, de la musique et des planches Watchmen :**
  - volume final −14,01 LUFS, crête −1,50 dBFS ;
  - musique baissée de 12,1 dB sous la voix ;
  - voix compressée (écart entre crêtes et moyenne de 19,1 à 16,6 dB) ;
  - rapport 97 / 100 ;
  - .otio relu et réécrit par la bibliothèque officielle OpenTimelineIO 0.18 (durées exactes, aucun média manquant) ;
  - export 4K 2160×3840 vérifié ;
  - boutons testés jusqu'au téléchargement.
- **Non-régression :** les 80 images de référence sont inchangées.

## Moteur de production : phase 7 (mesures, non-régression, documentation)

**Banc de mesure** : *Réglages → Performance de cet ordinateur*, moins d'une minute.
- **Ce qu'il mesure :**
  - le temps d'une image 1080p et 4K ;
  - les transitions GPU ;
  - la 3D ;
  - un vrai export MP4 de 3 s ;
  - les encodeurs disponibles.
- **Ce qu'il traduit en clair :**
  - « aperçu fluide » ou non ;
  - durée d'export de 10 min de vidéo en 1080p et en 4K ;
  - repli sans WebGL ;
  - son en AAC ou en Opus.
- Ton projet n'est pas touché, car les pages de test ne sont jamais enregistrées.

**Non-régression visuelle à chaque mise en ligne** :
1. GitHub rend la version précédente et la nouvelle sur la même machine.
2. Il compare les 80 images.
3. Une différence bloque la publication et joint les images fautives au rapport.
4. Un changement voulu passe avec `[visuel]` dans le message de commit.

Les tests de logique bloquent toujours la publication.

**Documentation** : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Elle couvre :
- les principes (local, non destructif, aperçu = rendu final, déterministe, sobre) ;
- le parcours d'un montage et la carte des modules ;
- comment ajouter une transition, un profil, une scène ou un réglage ;
- les tests, les performances de référence et les licences.

## Studio d'explication : script, voix, sous-titres, recadrage

**Analyse du script** (bouton « Analyser le script », `src/engine/scriptIntel.ts`, locale, sans API) :
- **Rôle de chaque passage :** accroche, contexte, argument, révélation, exemple, comparaison, preuve, conclusion, changement de rythme.
- **Ce qui est cité :** personnages, événements, lieux, objets, concepts, dates et chiffres, grâce à un lexique Marvel / DC plus les noms propres.
- **Visuels proposés,** chacun à accepter ou à ignorer :

  | Visuel | Quand il est proposé |
  |---|---|
  | Frise | quand il y a plusieurs dates |
  | Carte des relations | quand des personnages reviennent |
  | Duel ou échelle | sur une comparaison |
  | Citation | sur une réplique entre guillemets, avec un rappel de vérifier la source |
  | Mot-clé en grand | sur une révélation |
  | Lieux | seulement si tu fournis une image tirée des comics |

- **Rien d'inventé :** les images viennent uniquement de tes cases. Ce qui manque est demandé, jamais fabriqué.

**Modèles de production** (« Montage auto ») :
- **Face caméra :** toi avant tout.
- **Face caméra + comics.**
- **Explication graphique :** frises, relations et échelles tirées du script.
- **Révélation et comparaison :** duels, échelles, citations, mots-clés.

Chaque modèle propose son profil de direction, et tout reste modifiable.

**Relations sourcées** : dans les cartes de relations, chaque lien a :
- une nature : allié, ennemi, famille ;
- un degré de certitude : fait sourcé (trait plein), interprétation (tirets), hypothèse (pointillés, avec « ? »).

Une légende apparaît dès que les degrés sont mélangés. Un nouveau schéma **Citation** fait apparaître la réplique au rythme de la lecture, puis sa source.

**Nettoyage de la voix** (`src/engine/denoise.ts`, réglage dans l'export : Auto / Légère / Forte / Aucune) :
1. Le bruit de fond est appris sur les moments calmes de la prise.
2. La force est choisie selon l'écart voix / bruit : rien sur une prise propre, jamais plus de 18 dB.
3. La réduction est un filtre de Wiener spectral, lissé pour éviter le son « sous l'eau ». Un plancher garde les respirations.
4. L'aperçu entend la même voix nettoyée que l'export.
5. Le rapport qualité indique le bruit avant et après.

**Transcription vérifiée** (`src/engine/transcriptCheck.ts`) : une transcription qui tourne en boucle (hallucination de Whisper) ou au débit impossible n'est jamais utilisée pour couper. Les sous-titres prennent alors ton script, calé sur les passages de voix.

**Sous-titres** :
- mots importants dans la couleur d'accent ;
- jamais sous les boutons TikTok / Shorts en 9:16 ;
- correction ligne par ligne dans l'inspecteur ;
- export **.ass** (karaoké mot à mot, mots-clés en couleur) en plus du .srt ;
- choix entre incrustés dans l'image ou livrés à part.

**Recadrage vertical** (`cameraPath` dans `src/engine/faces.ts`, logique reprise de vertical_video_convertor, MIT) :
- la caméra reste immobile tant que le visage reste dans une zone de tolérance ;
- elle se déplace à vitesse limitée ;
- elle coupe net sur un changement de plan, détecté à la couleur ;
- elle garde son cadre quand le visage est perdu un instant ;
- un visage filmé de loin est cherché dans des zones agrandies.

**Export** :
- 1080 × 1920 en H.264, avec contrôle du débit (Haute / Maximale) ;
- AAC quand le navigateur le permet ;
- après le rendu, le MP4 est relu pour vérifier la synchronisation (durées des pistes et décalage au départ).

**Ressources** (`src/engine/jobs.ts`) : un seul traitement lourd à la fois (Whisper, relief, détourage, nettoyage de la voix). Le modèle précédent est déchargé avant le suivant.

## Forge AI Orchestrator (multi-IA, zéro coût par défaut)

**Centre de contrôle IA** (icône robot en haut) :
- **Tableau de bord :** fournisseurs prêts, appels du jour et du mois, coût estimé.
- **Fournisseurs :** clés (chiffrées, jamais réaffichées, supprimables), test de connexion, choix des modèles, type de compte.
- **Routage :** ordre par tâche, avec la raison de chaque fournisseur sauté.
- **Coûts et confidentialité :**
  - modes **Zéro coût** (défaut), **Équilibré**, **Qualité** ;
  - plafond mensuel ;
  - **Local uniquement** ;
  - envois autorisés ;
  - Forge Bridge.
- **Historique :** sans clé ni contenu.

**Fournisseurs** (`src/ai/providers`) :
- **Appel direct depuis le navigateur :** Gemini, Groq, OpenRouter, Agnes AI.
- **Via Forge Bridge :** Cloudflare Workers AI, NVIDIA NIM.
- **Local :** Ollama, LM Studio, le moteur local de Forge.
- **Payants, éteints par défaut :** OpenAI, Anthropic. Les abonnements ChatGPT, Gemini et Claude ne donnent pas d'accès API et ne sont jamais utilisés.

**Règles de l'orchestrateur** (`src/ai/orchestrator.ts`) :
- **Capacités :** une tâche ne va qu'à un modèle capable de la faire (texte, JSON, images, transcription, long contexte).
- **Mode Zéro coût :** IA locale, offres gratuites et modèles au **prix 0 lu dans le catalogue** uniquement (OpenRouter : 14 sur 474 au 25/11/2026).
- **Erreurs :** une clé refusée met le fournisseur de côté. Un quota dépassé impose l'attente indiquée par le service. Une panne ou une réponse illisible fait passer au suivant. L'IA locale reste le dernier recours.
- **Confidentialité :** demande avant le premier envoi de chaque type de données (texte, audio, images) à chaque service.
- **Économie d'appels :** cache des réponses, 2 appels simultanés au plus par fournisseur.

**Dans le montage** :
- **Transcription « IA auto » :** Groq ou Gemini, sinon Whisper local, puis contrôle anti-hallucination.
- **Fenêtre du script :** « Analyse approfondie » et « Deuxième lecture éditoriale ».
- **Sous-titres :** « Corriger la ponctuation », qui refuse toute ligne dont les mots changent.
- **Assistant de montage :** il propose, tu valides chaque changement, Ctrl+Z annule. Les propositions sont vérifiées contre le projet réel : aucun plan ou temps inventé.

**Forge Bridge** (`bridge/`, facultatif, Node 20+) :
- clés dans le coffre de Windows ou de Linux, ou dans un fichier chiffré ;
- relais pour Cloudflare, NVIDIA et whisper.cpp ;
- répond seulement à Forge, avec un code d'appairage.

**Tests** :
- 27 tests de l'orchestrateur (mode Zéro coût, budget, clé invalide, quota, réseau coupé, secours, capacités, consentement, cache, débit, tâches) ;
- 5 tests du Bridge ;
- 5 tests sur les vrais services, lancés avec `FORGE_LIVE=1 npx vitest run tests/live.test.ts` :
  - catalogue OpenRouter réel ;
  - fausses clés refusées par Groq, OpenRouter, Agnes et Gemini.

**Pas encore testé faute de clé :** une vraie réponse de Groq, Gemini, OpenRouter, Agnes, Cloudflare ou NVIDIA.

## Production : voix radio, musique, export, cartes, montage en direct, IA locale

**Voix « radio »** (`src/engine/voicepro.ts`, choix Radio / Naturelle / Brute dans l'export). Elle est calculée une fois sur la prise, et l'aperçu entend la même voix que l'export. La chaîne :
1. coupe-bas 80 Hz (24 dB/octave) ;
2. égaliseur : −3 dB à 250 Hz, +3 dB à 3,5 kHz, +2 dB au-dessus de 12 kHz ;
3. dé-esseur dynamique : la bande 5–9 kHz baisse seulement quand un « s » domine le corps de la voix ;
4. niveleur qui rapproche phrases fortes et faibles ;
5. compresseur 3:1 et limiteur à −1 dBFS.

Le rapport qualité affiche l'écart fort / faible, les « s » et le grondement avant et après.

**Bibliothèque musicale** (bouton « Musique ») :
- **Mémoire :** tes morceaux sont gardés d'un projet à l'autre.
- **Mesures à l'ajout :** volume réel (LUFS), tempo, énergie, ambiance (modifiable).
- **Mixage :**
  - niveau calé sur la mesure (lit musical à −21 LUFS, puis −11 dB sous la voix) ;
  - boucle sur des mesures entières avec fondus croisés si le morceau est trop court ;
  - fondu final calé sur la fin.
- **Montage auto :** il choisit le morceau selon le profil créatif.

**Export 1080p** :
- **Débits :** Haute 16 Mb/s (24 à 60 i/s) ; Maximale 30 Mb/s (45 à 60 i/s), sans perte visible.
- **Son :** AAC 256 kb/s.
- **Encodeur :** celui de la carte graphique quand il existe.
- **Contrôle :** le codec réellement utilisé est affiché, et le fichier relu vérifie la synchronisation.

**Cartes animées** (schéma « Carte ») :
1. tu choisis l'image de la carte, puis tu places chaque lieu d'un clic ;
2. la caméra va de lieu en lieu, le trajet se dessine, les épingles tombent avec leur étiquette ;
3. elle finit sur une vue d'ensemble.

Les schémas sans image affichent des monogrammes, et la carte des relations ne fait plus se chevaucher ses cartes.

**Montage en direct** (option du montage auto) :
1. **Rejeu :**
   - les cases découpées et numérotées sur chaque page ;
   - les coupes du rush sur la forme d'onde ;
   - les plans qui se posent avec leur raison (« révélation → effet fort Trame BD », « illustre "…" »).
2. **Lecture :** le **journal du montage** suit la vidéo.

**IA locale sur la carte graphique** (WebLLM, Apache 2.0, centre de contrôle IA) :
- Qwen 2.5 de 0,5 à 7 milliards de paramètres, hors ligne après le téléchargement ;
- taille choisie selon la mémoire vidéo ;
- versions 32 bits pour les cartes sans calcul 16 bits ;
- jamais utilisée sur une carte graphique émulée.

**Adaptation au PC** (`src/engine/hardware.ts`) :
- profil processeurs, mémoire et carte graphique ;
- Whisper tiny, base ou small selon la machine ;
- aperçu de 50 à 100 % de la définition, baissé automatiquement pendant la lecture s'il saccade.

**Code** :
- les fenêtres se chargent à la demande ;
- les bibliothèques sont dans des fichiers séparés (fichier principal : de 1 225 à 148 Ko) ;
- `CLAUDE.md` et 6 skills dans `.claude/skills` pour travailler avec Claude Code.
