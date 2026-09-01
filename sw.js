// Service worker de Bitácora de Camiones.
// Objetivo: que la app quede instalada y siga cargando aunque el sistema
// la descargue de memoria (cambiar de app) o no haya señal.
//
// ►► AL PUBLICAR UNA VERSIÓN NUEVA: sube APP_VERSION aquí y el mismo número
//    en window.BF_VERSION dentro de index.html. Con eso, al abrir la app
//    aparece el botón "Actualizar" en los celulares.
const APP_VERSION = "1.2.4";
const BF_CACHE = "bf-cache-" + APP_VERSION;
const CORE = ["./", "./index.html", "./styles.css", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon-maskable.png"];

self.addEventListener("install", (e) => {
  // No hacemos skipWaiting automático: la versión nueva queda "en espera"
  // hasta que el usuario toca "Actualizar" (evita recargas a mitad de tarea).
  e.waitUntil(caches.open(BF_CACHE).then((c) => c.addAll(CORE)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== BF_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// La página pide activar la versión nueva (botón "Actualizar").
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  // Deja pasar CDNs y APIs externas (Firebase, fuentes, Open-Meteo) sin cachear.
  if (url.origin !== self.location.origin) return;

  // Navegación (carga de la página): red primero, cae al index cacheado.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => { const cp = r.clone(); caches.open(BF_CACHE).then((c) => c.put("./index.html", cp)); return r; })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Recursos propios: responde del caché y actualiza en segundo plano.
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req)
        .then((r) => { if (r && r.status === 200) { const cp = r.clone(); caches.open(BF_CACHE).then((c) => c.put(req, cp)); } return r; })
        .catch(() => cached);
      return cached || net;
    })
  );
});
