# Forge Bridge (facultatif)

Forge fonctionne entièrement dans le navigateur. Ce petit programme local sert dans deux cas seulement :
- utiliser **Cloudflare Workers AI**, **NVIDIA NIM** ou un serveur **whisper.cpp**, que le navigateur ne peut pas appeler directement ;
- garder ces clés **hors du navigateur**, dans le coffre de Windows (Gestionnaire d'identification) ou de Linux (Secret Service).

## Installation (Windows ou Linux)

1. Installe Node.js 20 ou plus récent.
2. Facultatif, pour le coffre du système : dans ce dossier, lance `npm install @napi-rs/keyring`. Sans lui, les clés vont dans un fichier chiffré (AES-256-GCM) de ton dossier personnel.
3. Enregistre les clés. La saisie est masquée et rien ne s'affiche en clair :

   ```bash
   node forge-bridge.mjs set-key cloudflare
   ```

   ```bash
   node forge-bridge.mjs set-account cloudflare TON_ID_DE_COMPTE
   ```

   ```bash
   node forge-bridge.mjs set-key nvidia
   ```

4. Démarre le Bridge :

   ```bash
   node forge-bridge.mjs
   ```

5. Colle le **code d'appairage** affiché dans Forge : *Centre de contrôle IA → Coûts et confidentialité → Forge Bridge*.

## Sécurité

- **Écoute locale uniquement :** le Bridge écoute seulement sur `127.0.0.1`.
- **Sites autorisés :** il ne répond qu'à Forge (liste dans `FORGE_BRIDGE_ORIGINS`) et seulement avec le code d'appairage.
- **Clés protégées :** elles ne quittent jamais le Bridge et sont retirées des messages d'erreur.
- **Limite d'appels :** 4 requêtes simultanées au maximum.
