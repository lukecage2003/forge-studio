import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import '@fontsource/anton';
import '@fontsource/bangers';
import './index.css';
import App from './App';
import { agreement, cutPage, detectBlobs, detectPanels, setFlatMin } from './engine/detect';
import { getImage } from './engine/media';
import { pageStats } from './engine/classify';
import { cutPageSmart, comicOrder } from './engine/panelAI';
import { getState } from './store';

// small hook for automated tests and power users (no effect on the app)
import { layersFor } from './engine/layers';
(window as unknown as { __forge: unknown }).__forge = { layersFor, pageStats, cutPageSmart, comicOrder, agreement, cutPage, detectBlobs, detectPanels, getImage, getState, setFlatMin };

import { loadVault } from './ai/vault';
import { migrateGoogleKey } from './engine/google';

// API keys are decrypted into memory before the app starts (and an old clear-text Gemini key is moved into the vault)
void loadVault().then(migrateGoogleKey).finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
