// v6 — Fix bug page blanche : on ne cache PLUS index.html (servi toujours fresh)
// sinon le SW sert un ancien HTML qui reference des chunks JS dont le hash a
// change entre deploys, et la page casse jusqu'a un hard refresh.
const CACHE_NAME = 'klikphone-v7';
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

function isHtmlNavigation(request) {
  // Navigation (click sur lien, reload, nouvelle URL)
  if (request.mode === 'navigate') return true;
  const url = new URL(request.url);
  if (url.pathname === '/' || url.pathname.endsWith('/index.html')) return true;
  // Accept header qui demande du HTML
  const accept = request.headers.get('accept') || '';
  if (accept.includes('text/html')) return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const request = event.request;

  // 1. HTML / navigations -> TOUJOURS network fresh, JAMAIS du cache.
  //    Garantit que le HTML reference les bons chunks JS du deploy courant.
  if (isHtmlNavigation(request)) {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2. Autres assets (JS/CSS/images) -> network-first + cache fallback
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
