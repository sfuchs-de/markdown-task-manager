const CACHE_NAME = 'research-workbench-shell-v2';
const APP_SHELL = [
  '/',
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/research-workbench-icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function shouldBypass(requestUrl) {
  return requestUrl.origin !== self.location.origin
    || requestUrl.pathname.startsWith('/api/')
    || requestUrl.pathname === '/dashboard'
    || requestUrl.pathname.startsWith('/dashboard/')
    || requestUrl.pathname === '/sw.js';
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

async function shellFallback(request) {
  try {
    return await fetch(request);
  } catch (error) {
    if (request.mode === 'navigate') {
      return await caches.match('/') || await caches.match('/offline.html');
    }
    return await caches.match(request) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (shouldBypass(requestUrl)) return;

  if (
    requestUrl.pathname.startsWith('/assets/')
    || requestUrl.pathname.startsWith('/icons/')
    || requestUrl.pathname === '/manifest.webmanifest'
    || requestUrl.pathname === '/offline.html'
  ) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  event.respondWith(shellFallback(event.request));
});
