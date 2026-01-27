/* sw.js - Service Worker (GitHub Pages friendly) */
"use strict";

const VERSION = "v1.0.0";
const STATIC_CACHE = `static-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./script.js",
  "./manifest.json",
  "./icon.png",
  "./filmes.csv"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    await cache.addAll(STATIC_ASSETS);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((res) => {
      // só cacheia responses ok
      if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
      return res;
    })
    .catch(() => cached);

  return cached || fetchPromise;
}

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const res = await fetch(request);
    if (res && (res.ok || res.type === "opaque")) cache.put(request, res.clone());
    return res;
  } catch (e) {
    return cached || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // App Shell para navegação (SPA-like): sempre devolve index do cache
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match("./index.html");
      try {
        const fresh = await fetch(req);
        return fresh;
      } catch {
        return cached || Response.error();
      }
    })());
    return;
  }

  // TMDB posters (runtime cache-first)
  if (url.hostname === "image.tmdb.org") {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Mesma origem: assets (stale-while-revalidate)
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      // arquivos “core” preferem static cache
      const staticCache = await caches.open(STATIC_CACHE);
      const hit = await staticCache.match(req);
      if (hit) return hit;

      return staleWhileRevalidate(req);
    })());
    return;
  }

  // Outros: tenta rede
  event.respondWith(fetch(req));
});
