// Service worker de la PWA: cachea el "cascaron" de la app (HTML/CSS/JS/iconos)
// para que funcione offline, pero SIEMPRE prueba la red primero para ese
// cascaron (esta app se actualiza a menudo y ver la version mas reciente
// importa mas que ahorrarse una peticion) y SIEMPRE va a red para /api/*
// (precios y datos tienen que ser siempre frescos, nunca cacheados).
const CACHE_NAME = "ev-diesel-shell-v2";
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

  // Network-first para el cascaron: si hay red, siempre la version mas
  // reciente (y se actualiza la cache de paso); si no hay red, la cache.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(request)))
  );
});
