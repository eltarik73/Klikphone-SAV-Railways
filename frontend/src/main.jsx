import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ─── Fix page blanche : reload auto si chunk lazy() 404 (hash change apres deploy)
// Quand le hash d'un chunk change entre deploys, une navigation vers une route
// lazy() tente d'importer l'ancien filename et echoue -> ecran blanc. On detecte
// et on force un hard reload (une seule fois pour eviter les boucles).
const RELOAD_FLAG = '__kp_chunk_reload_at__';
function shouldReloadOnce() {
  try {
    const last = parseInt(sessionStorage.getItem(RELOAD_FLAG) || '0', 10);
    if (Date.now() - last < 10_000) return false; // protege contre boucle < 10s
    sessionStorage.setItem(RELOAD_FLAG, String(Date.now()));
    return true;
  } catch { return true; }
}
function isChunkLoadError(err) {
  if (!err) return false;
  const msg = (err.message || err.toString() || '').toLowerCase();
  return (
    msg.includes('chunkloaderror') ||
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("importing a module script failed") ||
    msg.includes("loading chunk") ||
    /loading css chunk \d+ failed/.test(msg)
  );
}
window.addEventListener('error', (e) => {
  if (isChunkLoadError(e.error) && shouldReloadOnce()) {
    window.location.reload();
  }
});
window.addEventListener('unhandledrejection', (e) => {
  if (isChunkLoadError(e.reason) && shouldReloadOnce()) {
    window.location.reload();
  }
});
