# Rapport de campagne — Forge Complete Creative Production Studio

27 novembre 2026. Commits `363cb65` → `ea34d48`, tous publiés après les contrôles automatiques (Linux, Windows, puis vérification du site en ligne).

## 1. État initial
Voir [ETAT-TECHNIQUE.md](ETAT-TECHNIQUE.md). En résumé :
- Socle opérationnel : planches, caméra BD, montage auto, storyboard, orchestrateur de tâches, médiathèque, son, livraison, Zéro coût.
- Partiel : pas de numéro de schéma, mémoire globale seulement, contexte IA non ciblé, aucun outil d'espace disque, pas de scénario complet dans la CI.
- Absent : espaces de travail (studios).
- Aucune fonction factice trouvée.

## 2. Architecture réellement présente
- Une source de vérité, `store.ts`, avec historique d'annulation.
- Moteurs purs (`engine/`) et un seul rendu pour l'aperçu et l'export.
- Stockage `lib/workspace` : dossier ou OPFS.
- Orchestrateur de production (`production/`) et orchestrateur IA (`ai/`).
- Les huit studios sont des vues sur ce même noyau.
- L'export passe par WebCodecs avec mediabunny. FFmpeg n'est pas utilisé, et ce choix est assumé.

## 3–4. Modifications et fonctionnalités finalisées
| Phase | Réalisé | Validation |
|---|---|---|
| 2–3 Projets | `schemaVersion`, migrations ordonnées ; un projet d'une version plus récente garde ses réglages inconnus et l'utilisateur est prévenu | tests unitaires |
| 2–3 `.forge` | manifeste (schéma, version de Forge, versions des moteurs, médias manquants) ; versions du projet et médias qu'elles utilisent | tests unitaires et e2e |
| 2–3 Ouverture d'un `.forge` | un projet remplacé est d'abord gardé dans ses versions | tests unitaires et e2e |
| 2–3 Stockage | place prise par type ; « Libérer de la place » met à la corbeille (restaurable) et ne touche jamais un média utilisé par un projet ou une version | tests unitaires et navigateur |
| 4/6 Studios | huit studios, état lu dans le projet, vraies commandes ; une seule liste de commandes pour la palette et les studios ; pas de faux « prêt » | tests unitaires et e2e |
| 4/6 Barre du haut | le sélecteur de format ne chevauche plus le reste à 1440 px (bug existant) | mesuré dans le navigateur |
| 5 Contexte IA | l'assistant n'envoie que le passage et les parties concernés, et affiche ce qui est envoyé (4 fois moins de texte pour une demande ciblée) | tests unitaires |
| 5 Mémoire | Forge Brain par projet, par format et en général ; effacement par niveau, annulable ; reprise de l'ancienne mémoire | tests unitaires |
| 5 Zéro coût | vérifié : aucun appel payant ne contourne la garde | tests existants |
| 7 Performance | moteur vidéo retiré du premier chargement | mesuré |
| 7–8 Corrections | rush WebM sans durée (durée infinie) ; versions perdues en ouvrant un `.forge` juste après le démarrage | e2e |
| 8 Scénario complet | les 15 étapes demandées | e2e, CI Linux et Windows |
| 10 Documentation | lancement, compilation, sauvegarde et récupération, studios, licences | — |

## 5. Encore incomplet (non fait dans cette campagne)
- **Montage multipiste** : trois pistes de calques au-dessus de la piste principale. Ce n'est pas une timeline de NLE illimitée : les calques vidéo sont muets, ils n'ont pas de transitions propres et ne sont pas exportés vers DaVinci (OTIO).
- **Historique d'annulation** : il n'est pas conservé après fermeture. Les versions jouent ce rôle.
- **Barre de nouvelle version et fenêtre de rechargement** : testées localement et en CI, pas encore observées en ligne sur un vrai changement de version.

## Suite : aperçus légers (proxies)
Fait après le rapport initial.
- **Fabrication** : un rush de plus de 720p reçoit une copie 540p sans son. C'est une tâche de l'orchestrateur, en basse priorité.
- **Rangement** : la copie est rangée dans `proxies/`, à part des originaux, et retrouvée à la session suivante.
- **Lecture** : l'aperçu lit la copie. L'export lit toujours l'original.
- **Même image** : le rendu dessine le rush à la taille de sa zone, donc la composition est identique. Seule la netteté de l'aperçu change.
- **Suppression** : les copies se suppriment sans risque depuis Projets › Stockage.
- **Mesure** (`tests/e2e/proxy.e2e.cjs`, Chromium sans GPU) : un déplacement dans l'aperçu prend environ 400 ms sur un original 1080p WebM et 26 ms sur la copie. Cet original vient d'un enregistrement du navigateur, sans index, donc particulièrement lent à parcourir. Le gain sur un MP4 de caméra sera plus faible : **non mesuré**.

## Suite : pistes de calques
Fait avec ton accord.
- **Contenu** : trois pistes au-dessus de la piste principale, pour une case, une image ou une vidéo muette.
- **Placement** : plein écran, incrustation façon BD (bord blanc et ombre franche, sans halo), ou moitiés de l'écran.
- **Réglages** : fondu, zoom lent sans toucher au dessin, départ dans la vidéo.
- **Commandes** : réglage dans l'inspecteur, déplacement et raccourcissement à la souris dans la timeline, annulation avec Ctrl+Z.
- **Projets** : schéma 3, avec migration automatique des anciens projets.
- **Médias** : ceux des calques sont sauvegardés, emportés dans le `.forge` et jamais nettoyés.
- **Contrôle qualité** : il signale un calque sans média, avec une correction proposée, et un calque qui dépasse la fin de la vidéo.
- **Mesure** (`tests/e2e/overlays.e2e.cjs`) : sur les images du MP4 exporté, l'écart avec l'aperçu est de 0,1/255 pour la case et de 0,9/255 pour la vidéo, contre 136 et 59 sans calque. L'aperçu et l'export sont donc la même image.
- **Barre du haut** : plus aucun chevauchement de 1 024 à 1 440 px. Sous 1 200 px, elle défile de côté.

## Suite : améliorations des calques (sans export DaVinci, à ta demande)
Toutes vérifiées sur de vraies planches Watchmen.
- **Placement conseillé selon la forme de la case.** Le plein écran n'est conseillé que s'il est nettement meilleur.
- **Case trop rognée montrée entière.** En incrustation ou en calque libre, le cadre prend la forme de la case.
- **Calque libre.** On le glisse et on le redimensionne dans l'aperçu, et il peut se déplacer d'une position à une autre.
- **Entrées** : glissé, pop, volet encré.
- **Son des vidéos en calque.** Il devient un bruitage lié, qui suit le calque et disparaît avec lui.
- **Aperçu léger pour les vidéos en calque de plus de 720p.**
- **Rapport « mon PC ».** C'est un complément au banc d'essai qui existait déjà.
- **Bugs trouvés grâce aux vraies planches et corrigés** : les coordonnées des cases étaient mal lues, la bulle d'une case était rognée en moitié d'écran, et une case large flottait dans un cadre flou en incrustation.

## Suite : optimisations mesurées
| Mesure | Avant | Après |
|---|---|---|
| Mémoire du navigateur, numéro de 24 pages | 1 795 Mo | essai retiré (voir ci-dessous) |
| Relief 2.5D au premier export après rechargement (50 s de vidéo) | 29,3 s | 1,4 s |
| Ctrl+Z après rechargement | 0 étape | 13 sur 13 |
| Hauteur utile, Forge installé | environ 870 px | environ 960 px |

- **Mémoire** : un essai remplaçait le décodage des planches (`ImageBitmap`) par des images que le navigateur peut libérer, soit 1 795 → 1 640 Mo. Il a été retiré : la régression visuelle a montré des traits légèrement moins nets (19 images sur 104, écart jusqu'à 42/255 sur les contours). La qualité passe avant un gain de 9 %.
- **Relief 2.5D** : les cartes de profondeur sont gardées.
- **Encodage vidéo sans carte graphique** : 79 ms par image, alors que le dessin ne prend que 3 ms. C'est l'encodeur du navigateur. Le mode temps réel a été essayé sans aucun gain, puis retiré. Aucun processus de rendu séparé n'a été ajouté, puisque le dessin n'est pas le goulot.
- **Ajouts** : Forge installable comme application ; coupe (S) et ajustements ([ ]) au curseur ; aimantation sur tous les bords ; miniatures dans les blocs de calques ; calques proposés d'après le script.
- **Fichiers PNG du logo** (`brand-kit/logo-forge-*.png`) : ils sont défectueux, ce sont des captures d'une image cassée. Le problème existait déjà. Les icônes de l'application sont générées depuis `favicon.svg`.

## Suite : finition pro et économies d'API
- **Finition pro** (`src/engine/pro.ts`) : interrupteur du montage automatique, activé par défaut, et commande « Finition pro ». Elle ne touche que les plans automatiques que tu n'as jamais modifiés, et chaque plan dit pourquoi il a changé.
  - Impacts sur les onomatopées (BOOM, KRAK…) : la case secoue, zoome sur le mot quand le lettrage a été lu, et reçoit un son d'impact.
  - Rythme selon l'émotion : coupes sèches pour l'action, fondus lents pour l'émotion.
  - Bandeau du nom à la première fois qu'un personnage est nommé par la voix.
  - Cartons de chapitre noir et jaune au début de chaque séquence du directeur.
  - Variété : jamais trois fois le même mouvement de caméra d'affilée.
  - La musique suit l'histoire : plus forte sur les révélations et les combats, plus douce pendant les explications. Cela vaut pour l'aperçu et l'export.
  - Fin en boucle (formats verticaux) : la dernière demi-seconde fond vers la première image.
- **Couverture TikTok automatique** : le bouton « Choix auto » parcourt les cases les plus fortes et n'en garde que les **personnages détourés**, jamais une case entière.
  - Le détourage se fait avec BiRefNet, sur la carte graphique.
  - Les bulles et le lettrage lus sur la page sont effacés, et une seule silhouette est gardée.
  - Un résultat est refusé s'il reste une case : bords opaques, forme plus large que haute (un véhicule, deux personnages collés), ou trou laissé par une bulle sur le corps.
  - Si aucun personnage ne sort proprement, Forge demande de coller un PNG au lieu de poser une case.
  - Testé sur 4 pages de Watchmen avec le modèle exécuté hors navigateur : Rorschach est gardé, les 7 autres cases sont refusées.
  - **Non testé** : le détourage dans le navigateur sur ta carte graphique. Ici, sans carte graphique, le modèle manque de mémoire et les secours (Magic Touch, profondeur) sont refusés par les mêmes règles.
- **Contrôle « première seconde »** dans la revue : ouverture sur un carton, transition depuis le noir, image fixe, voix qui commence tard. Chaque point propose une correction.
- **Moins d'appels payants** :
  - une réponse déjà obtenue est réutilisée, quel que soit le fournisseur ;
  - la même demande envoyée deux fois en même temps ne part qu'une fois ;
  - une transcription déjà faite du même son n'est pas refaite ;
  - les espaces inutiles sont retirés des requêtes ;
  - le cache passe de 60 à 200 réponses ;
  - les instructions système sont mises en cache chez Anthropic.
- **Non testé** : l'économie réelle sur une vraie clé API (pas de clé ici), et le rendu de la musique variable à l'oreille.

## Suite : tournée complète de l'application
- **Tournée automatique** à la taille de ton écran (1896×870) : les 8 studios, les 15 fenêtres, les modes Découpe et Aperçu, plus un écran de 1366×700. On y cherche les erreurs, les débordements, les textes en anglais et « undefined » ou « NaN ». Résultat : rien dans l'application.
- **Défauts trouvés et corrigés** :
  - Dans « Ma chaîne », l'aperçu TikTok était étiré dans un cadre 16:9 et le titre disait « Miniature YouTube ». L'aperçu est maintenant vertical, à côté des réglages, et la fenêtre tient dans l'écran.
  - Le directeur créatif répétait son explication à chaque passage (« Introduction · … — Introduction · … »).
  - Les chapitres affichaient des noms techniques (« IMPACTS ») au lieu de vrais titres (« L'affrontement »).
  - En vertical, les cases très larges étaient de minces bandes perdues dans le fond flou. Elles sont maintenant filmées en panoramique, sur environ la moitié de leur largeur, deux fois plus grandes et sans perte de netteté.
- **Rendu réel** : montage automatique de 4 pages de Watchmen avec un script, finition pro, contrôle qualité corrigé, puis export MP4 1080×1920 à 30 i/s en H.264. Le fichier fait 38 s, est relu sans erreur et montre 3 chapitres, le bandeau « Le Comédien » et la fin en boucle.

## Suite : continuité de caméra (cases qui se suivent)
- **Plus d'effet de pompe** (zoom avant, recul sur la page, zoom avant) : les cases qui se suivent sur une même page forment un seul trajet de caméra. Seule la première case de la page peut s'ouvrir en plan large ; chaque case suivante est atteinte en glissant depuis la précédente, dans l'ordre de lecture, avec une légère dérive vers la case d'après (`withContinuity`).
- **Changement de page** : la page se tourne, avec un glissement latéral dans le sens de lecture, même en vertical.
- **Glissement sur la page** : quand les deux cases sont filmées dans la page, la caméra voyage sur la page elle-même. La petite fenêtre qui se déformait entre deux formes de case a disparu.
- **Bandeaux en vertical** : le panoramique remplace aussi le trajet automatique du directeur, avec un agrandissement jusqu'à 1,8× (le trait reste net).
- **Chapitres** : chacun est rattaché à son plan (`anchor`) et suit le plan si le minutage change. Pas de carton dans les 3 premières secondes, au moins 8 s entre deux, aucun dans les 4 dernières secondes.
- **Bug corrigé à la source** : le montage automatique recalculait les durées sans mettre à jour son empreinte. Tous les plans semblaient donc modifiés à la main : la finition pro les sautait et la mémoire de Forge apprenait de fausses corrections. Le montage terminé est maintenant la référence.

## Suite : refonte des effets (banc d'essai complet)
Un banc d'essai rend chaque mouvement de caméra, chaque transition (24) et la 2.5D sur de vraies cases de Watchmen. Chaque résultat a été regardé, puis corrigé.
- **Cases allongées** (bandeau en vertical, colonne en 16:9) : tous les mouvements choisis par le montage automatique (zoom, panoramique, fixe, lecture des bulles, exploration) les cadrent maintenant en grand et les parcourent le long de leur grand côté, avec au moins la moitié de la case visible et un agrandissement de 1,8× au plus. Il n'y a plus de mince bande dans un fond flou, ni de panoramique dans le mauvais sens. Les mouvements réglés à la main sont respectés.
- **2.5D refaite** :
  - l'effet part de l'image exacte et y revient, donc aucun saut aux coupes ni aux glissés ;
  - le décalage est réduit (1,4 % au lieu de 4,5 %) et le personnage avance à peine ;
  - les bulles et les légendes restent sur le dessin ;
  - les calques sont en pleine résolution (2400 px au lieu de 1200) ;
  - le trou derrière le personnage est reconstruit à partir du décor seul, ce qui supprime le halo sombre ;
  - l'effet est refusé quand le sujet n'est pas une silhouette nette, et sur une image qui couvre plus de 60 % de la page (souvent plusieurs cases mal séparées).
- **Transitions** :
  - « Trame BD » : points 2,3 fois plus fins ;
  - « Tracé de case » : plus de page vide, l'image arrive avec le papier ;
  - « Trou noir » : il noircit tout l'écran, donc il n'est plus choisi par le montage automatique (toujours disponible à la main).
  - Les 21 autres transitions ont été vérifiées sans défaut.
- **Tests visuels** : 4 références mises à jour (trame et tracé de case), après comparaison à l'œil.

## 6. Fichiers importants
- **Nouveaux :**
  - `src/lib/schema.ts`
  - `src/lib/commands.ts`
  - `src/lib/studios.ts`
  - `src/components/StudioBar.tsx`
  - `tests/e2e/production.e2e.cjs`
  - `tests/{schema,studios,context,brain}.test.ts`
  - `docs/ETAT-TECHNIQUE.md`
- **Modifiés :**
  - `src/lib/projectFile.ts`, `src/lib/workspace.ts`, `src/lib/studio.ts`
  - `src/engine/brain.ts`, `src/engine/media.ts`
  - `src/ai/tasks.ts`
  - `src/store.ts`, `src/App.tsx`
  - `ProjectsModal`, `SettingsModal`, `AssistantModal`, `CommandPalette`, `TopBar`
  - `README.md`, `CLAUDE.md`, `deploy.yml`

## 7. Tests
- **Unitaires :** 217 passés, 5 ignorés. Les 5 ignorés sont les tests de services en ligne, lancés seulement à la demande.
- **Régression visuelle :** 104 images, 0 différence.
- **Bout en bout :** 9 scénarios, tous passés. Ils couvrent la production complète, la livraison, le storyboard, la médiathèque, la finition, l'orchestrateur, le studio et la mise à jour de version.
- **Build :** vérification des références passée (102 fichiers).
- **CI :** tout passe sur Linux et sur Windows, puis le site en ligne est vérifié.

## 8. Mesures
Mesurées sur le build de production, sous `/forge-studio/`.

| Mesure | Avant | Après |
|---|---|---|
| Premier chargement | 1,63 Mo | 1,05 Mo |
| Interface visible, local | 0,23 s | 0,21 s |
| Interface visible, 4G simulée | 1,84 s | 1,38 s |
| Import et analyse de 4 planches (modèle compris) | — | 11 à 13 s |
| Rendu 1080×1920 | — | environ 4 × la durée de la vidéo |
| Réouverture d'un `.forge` de 2,2 Mo | — | 0,4 s |

Le rendu a été mesuré sans GPU, dans un conteneur Linux. Il n'a pas été mesuré sur ton PC.

## 9. Compatibilité
- **Linux et Windows :** les scénarios de bout en bout passent sur Linux et sur Windows, dans Chromium sur les machines de GitHub Actions. Le scénario complet passe sur les deux. Ton PC Windows : **non testé**.
- **Firefox et Safari :** non testés de bout en bout.

## 10. Licences
Le tableau est dans [ETAT-TECHNIQUE.md](ETAT-TECHNIQUE.md#licences-vérifiées-le-27-novembre-2026).
- Les licences sont toutes permissives et npm audit ne trouve aucune vulnérabilité.
- À surveiller :
  - **Qwen2.5-3B** (IA locale) est **non commercial** ;
  - **Llama** demande une mention ;
  - pour **YOLOv13**, la licence est à revérifier avant tout usage commercial.

## 11–12. Problèmes connus et risques
- Les modèles transformers.js viennent d'un CDN au premier usage : ils sont indisponibles hors ligne tant qu'ils ne sont pas en cache.
- Le rendu logiciel est lent sans carte graphique.
- La mémoire de préférences reste dans ce navigateur. Elle ne voyage pas dans le `.forge`, et c'est volontaire.
- Un onglet resté ouvert plus de 30 jours après une publication passera par la fenêtre de rechargement.

## 13–15. Lancement, compilation, sauvegarde
Voir le [README](../README.md) : « Lancer en local », « Compiler et vérifier », « Sauvegarder et récupérer son travail ».

## 16. Préparation à la release
**Utilisable en production personnelle.** La chaîne complète, du projet vide à la vidéo exportée puis au projet rouvert, est validée automatiquement à chaque publication, sur Linux et Windows.

**Pas une release « professionnelle » complète.** Il manque la timeline multipiste libre et les proxies, et le test sur ta machine reste à faire.
