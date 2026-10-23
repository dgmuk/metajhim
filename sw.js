'use strict';

const SCOPE = new URL(self.registration.scope);
const CACHE_PREFIX = `metajhim-shell-${SCOPE.pathname}-`;
const CACHE_NAME = CACHE_PREFIX + 'v4';
const INDEX = new URL('index.html', SCOPE).href;
const SHELL = ['./', './index.html', './cloud-sync.js', './plans/week-2.json', './manifest.webmanifest', './manifest-repair.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'].map(path => new URL(path, SCOPE).href);

self.addEventListener('install', event => {
  // A new worker waits for old windows to close; it never reloads an open diary.
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

async function documentResponse(request) {
  const cache = await caches.open(CACHE_NAME);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    // Network first: local preview and newly deployed versions stay up to date.
    const response = await fetch(request, { signal: controller.signal, cache: 'no-cache' });
    if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
      await cache.put(INDEX, response.clone());
      return response;
    }
    return (await cache.match(INDEX)) || response;
  } catch (error) {
    const saved = await cache.match(INDEX);
    if (saved) return saved;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== SCOPE.origin) return;
  const documentPath = url.pathname === SCOPE.pathname || url.pathname === new URL(INDEX).pathname;
  if (request.mode === 'navigate' && documentPath) {
    event.respondWith(documentResponse(request));
  } else if (SHELL.includes(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const saved = await cache.match(request);
      if (saved) return saved;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    })());
  }
});
