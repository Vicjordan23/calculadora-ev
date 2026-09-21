// Service worker de la PWA: cachea el "cascaron" de la app (HTML/CSS/JS/iconos)
// para que abra rapido, pero SIEMPRE va a red para /api/* (precios y datos
// tienen que ser siempre frescos, nunca servidos desde cache).
const CACHE_NAME = "ev-diesel-shell-v1";
const APP_SHELL = ["/", "/styles.css", "/app.js", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // deja pasar CDNs externos (chart.js) tal cual
  if (url.pathname.startsWith("/api/")) return; // nunca cachear datos/precios

  // Stale-while-revalidate para el cascaron de la app.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
