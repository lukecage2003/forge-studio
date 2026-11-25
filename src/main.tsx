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
import { getState } from './store';

// small hook for automated tests and power users (no effect on the app)
(window as unknown as { __forge: unknown }).__forge = { agreement, cutPage, detectBlobs, detectPanels, getImage, getState, setFlatMin };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
