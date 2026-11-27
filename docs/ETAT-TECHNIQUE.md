# État technique de Forge — audit du 27 novembre 2026

Audit fait dans le code (commit `523d313`) et par l'exécution des contrôles du dépôt : 196 tests unitaires, 104 images de régression visuelle, 8 scénarios de bout en bout, build de production, intégration continue Linux et Windows. Aucun ancien rapport n'a été pris pour preuve.

## Technologies
- **Interface** : React 19, TypeScript 7, Vite 8 (rolldown), Canvas 2D.
- **Rendu** :
  - un seul moteur, `engine/render.ts`, pour l'aperçu et l'export ;
  - Three.js 0.187 pour les scènes 3D (`scene3d`) ;
  - WebGL pour les transitions (`gl/`).
- **Export** : MP4 par WebCodecs avec mediabunny. **Pas de FFmpeg** : il n'y en a nulle part dans le code. Dans un navigateur, WebCodecs encode sur le GPU sans les 30 Mo de FFmpeg.wasm, et ce choix est gardé.
- **Modèles locaux** :
  - dans le navigateur, par transformers.js 3.5.1 depuis un CDN, version fixée : Whisper tiny/base/small, CLIP, MiniLM, depth-anything, BiRefNet ;
  - livrés avec Forge : YOLO pour les cases et les bulles, PaddleOCR détection et lecture ;
  - WebLLM ;
  - whisper.cpp par Forge Bridge (`bridge/`, facultatif).
- **Stockage** : dossier sur disque (File System Access) ou espace privé du navigateur (OPFS) ; journal et cache dans IndexedDB.

## A. Opérationnel (prouvé par un test qui passe aujourd'hui)
- **Projets** : création, ouverture, duplication, versions, modèles, récupération après fermeture brutale, stockage sur disque (`studio.e2e`, `workspace.test`).
- **Fichier `.forge` v2** : zip contenant tous les médias, y compris le rush.
- **Import de PDF et d'images** : classement des pages, découpage des cases (YOLO + géométrie), bulles, OCR (`panels.test`, `orchestrator.e2e`).
- **Caméra BD** : ordre de lecture avec ambiguïtés signalées, trajectoires, révélations, composition partagée, formes de cases (`camera.test`).
- **Direction** : Creative Director, profils, budget d'effets, `shot.why` (`director.test`).
- **Montage automatique et storyboard éditable** (`storyboard.e2e`).
- **Orchestrateur de production** : file de tâches, pause, reprise, annulation, persistance, protection des modifications manuelles (`queue.test`, `orchestrator.e2e`).
- **Médiathèque** : provenance, usages, doublons, recherche visuelle (`library.e2e`).
- **Finition** : couleur et comparaison de versions (`finish.e2e`).
- **Contrôle qualité et livraison** : relecture du MP4, règles TikTok, Shorts et Reels, kit de publication (`delivery.e2e`).
- **Son** : nettoyage de la voix, loudness, contrôle de l'enregistrement (`voice.test`).
- **Transcription** Whisper locale par fenêtres, sous-titres alignés sur le script.
- **Orchestrateur IA** : Zéro coût, quotas, cache, coffre de clés chiffré (`ai.test`).
- **Publication web** : anciens fichiers gardés, vérification des références, contrôle du site en ligne (`update.e2e`, `verify-live`).

## B. Partiellement opérationnel
- **Format de projet sans numéro de schéma.** `migrate()` complète les champs manquants, mais il n'y a ni `schemaVersion`, ni `appVersion`, ni version des moteurs. Un projet ouvert par une version plus ancienne de Forge n'est pas signalé. Le `.forge` n'emporte pas les versions du projet.
- **Mémoire (Forge Brain)** : elle apprend des corrections, mais seulement de façon globale. Il n'y a de préférence ni par format ni par projet, et l'effacement est tout ou rien.
- **Contexte envoyé à l'IA** (`editContext`) : tout le projet est tronqué à des plafonds fixes, quelle que soit la demande. Rien ne choisit ce qui est utile.
- **Stockage** : les médias du dossier projet ne sont jamais supprimés, ce qui est sûr. En revanche :
  - aucun écran ne montre la place prise ;
  - il n'y a aucun moyen de libérer les médias que plus aucun projet ni aucune version n'utilise ;
  - la copie de cache dans le navigateur n'est libérée qu'après l'écriture d'un projet.
- **Timeline** : il y a plusieurs pistes (plans, rush, voix et musique, sous-titres, effets), mais une seule piste d'images. Ce n'est pas un montage multipiste libre façon NLE.
- **Scénario complet** : la production finale de la campagne précédente a été faite par un script hors du dépôt. Aucun test de la CI ne va de la création jusqu'à l'export puis à la réouverture.

## C. Seulement visuel ou simulé
Aucun trouvé. La recherche de « TODO », « bientôt », « simulé » et « mock » ne donne aucun bouton factice. Les fonctions sans clé ou sans GPU l'affichent déjà.

## D. Absent
- **Espaces de travail (« studios »)** : les outils existent, mais ils sont dispersés entre la barre du haut, la palette de commandes et les fenêtres. Rien ne les organise par étape de production, et rien ne dit ce qui reste à faire.
- **Rapport d'espace disque** et nettoyage sûr avec possibilité de récupération.
- **FFmpeg** : il n'est pas nécessaire (voir plus haut).

## E. Risques
- **Licence du détecteur de cases** : YOLOv13n est déclaré Apache-2.0 sur sa page Hugging Face. L'outil d'entraînement Ultralytics, lui, est sous AGPL. C'est acceptable pour un usage personnel, à revérifier avant toute diffusion commerciale.
- **Dépendance au CDN** : les modèles transformers.js viennent de jsdelivr et de Hugging Face au premier usage. Hors ligne, ils ne fonctionnent qu'une fois en cache.
- **Projets futurs** : un projet enregistré par une version plus récente puis rouvert par une plus ancienne peut perdre des réglages inconnus sans prévenir. C'est corrigé dans cette campagne.
- **Place disque** : les médias d'un projet supprimé restent dans le dossier sans que ce soit visible.
