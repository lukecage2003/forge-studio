<p align="center"><img src="docs/forge-mark.svg" width="72" alt="Forge"></p>

<h1 align="center">FORGE</h1>
<p align="center"><b>Comic Motion Studio</b> — tes planches de comics en vidéos rythmées pour TikTok, Shorts et YouTube.</p>

---

Forge est une application web de montage dédiée aux comics, BD et mangas. On importe des planches, Forge détecte les cases, anime une caméra case par case, pose les sous-titres, cale le rythme sur la musique et exporte un MP4 prêt à publier. Tout se fait dans le navigateur, sans compte ni serveur : les fichiers ne quittent pas l'ordinateur.

## Montage automatique

Le bouton **Montage auto** (touche `A`) fait le montage complet en un clic :

| Étape | Ce que fait Forge |
|---|---|
| Découpe | Détecte les cases de chaque planche (gouttières blanches ou noires, dessins qui débordent, sens BD ou manga). Les découpes faites à la main sont conservées. |
| Caméra | Panoramique sur les cases larges ou hautes, zoom avant/arrière alterné sur les autres, recul et secousse sur les grandes cases (splash). |
| Rythme | Durée de chaque plan selon la densité de la case (détails, bulles) et la longueur du sous-titre, ajustée à la durée cible. |
| Musique | Détection du tempo (BPM) et coupes calées sur le beat. |
| Voix off | La vidéo suit la durée de la narration, la musique baisse automatiquement sous la voix (ducking). |
| Transitions | Glissé caméra entre cases d'une même planche, whip, fondu ou poussée entre planches, flash sur les splash. |
| Accroche | Carton plein écran optionnel pour les 2 premières secondes. |

Trois styles : **Dynamique** (TikTok/Shorts), **Cinématique** (YouTube), **Manga** (lecture droite → gauche, impacts).

Tout reste modifiable ensuite, plan par plan.

## Fonctions

- **Formats** : 9:16 (TikTok, Shorts, Reels), 16:9 (YouTube), 1:1, 4:5, et zones de sécurité TikTok dans l'aperçu.
- **Découpe** : tracer, déplacer et redimensionner les cases à la souris, détection automatique, planche entière.
- **Caméra** : 8 mouvements, cadrage « case entière » ou « plein cadre », intensité, secousse d'impact.
- **Transitions** : cut, glissé caméra, fondu, poussée, whip, zoom, flash.
- **Texte** : 5 styles (TikTok, Récitatif, Impact, Propre, Cinéma), animations pop, machine à écrire, mot à mot ; cartons titres.
- **Audio** : pistes musique, voix off et bruitages, enregistrement micro, volumes, fondus, découpe des clips, ducking automatique.
- **Arrière-plan** : flou de la case, planche assombrie ou couleur unie ; signature @compte.
- **Export** : MP4 H.264 1080p en 24, 30 ou 60 i/s, plus vite que le temps réel (WebCodecs) ; sous-titres `.srt` ; miniature `.png`.
- **Projet** : sauvegarde automatique dans le navigateur, fichier `.forge` portable, annuler/rétablir.

## Raccourcis

| Touche | Action |
|---|---|
| `Espace` | Lecture / pause |
| `←` `→` | Image par image (`Maj` : par seconde) |
| `Suppr` | Supprimer la sélection |
| `Ctrl+Z` / `Ctrl+Maj+Z` | Annuler / rétablir |
| `A` | Montage auto |
| `1` / `2` | Découpe / Aperçu |

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
