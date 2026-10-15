// v8 — Le SW n'intercepte plus que les navigations HTML (réseau, page hors
// ligne en secours). Il ne touche plus aux appels /api/ (il mettait en cache
// les données tickets/clients et ralentissait Safari) ni aux assets /assets/,
// déjà servis avec Cache-Control immutable par le backend.
const CACHE_NAME = 'klikphone-v8';
const STATIC_ASSETS = [
  '/logo_k.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

const OFFLINE_HTML = '<!doctype html><html lang="fr"><meta charset="utf-8">'
  + '<meta name="viewport" content="width=device-width,initial-scale=1">'
  + '<title>Klikphone — hors ligne</title>'
  + '<body style="font-family:system-ui,sans-serif;background:#f8fafc;color:#0f172a;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">'
  + '<div style="text-align:center;padding:24px"><p style="font-weight:700;font-size:18px">Connexion impossible</p>'
  + '<p style="color:#64748b">Vérifiez la connexion internet puis réessayez.</p>'
  + '<button onclick="location.reload()" style="margin-top:12px;padding:12px 20px;border:0;border-radius:12px;background:#7C3AED;color:#fff;font-weight:700;font-size:15px">Réessayer</button>'
  + '</div></body></html>';

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => new Response(OFFLINE_HTML, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }))
    );
  }
});
