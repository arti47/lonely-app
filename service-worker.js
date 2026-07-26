/*
 * PWA service worker (CLAUDE.md §2).
 *
 * Network-first for the app shell so a reload always picks up new code, with a
 * cache fallback so the app works fully offline. This is the only network-aware
 * file in the project — there is no backend.
 *
 * Any change to a shipped file must bump CACHE_VERSION (§9.6), and any new
 * src/ module must be added to APP_SHELL (§3, enforced by tests/invariants).
 */

const CACHE_VERSION = 'lonely-v11';

const APP_SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.json',
  'icon.svg',
  'src/main.js',
  'src/core.js',
  'src/ui.js',
  'src/store.js',
  'src/settings.js',
  'src/router.js',
  'src/screens.js',
  'src/logview.js',
  'src/composer.js',
  'src/state.js',
  'src/compare.js',
  'src/resolve.js',
  'src/lifecycle.js',
  'src/templates.js',
  'src/reference.js',
  'src/guide.js',
  'src/addons/index.js',
  'src/addons/combat.js',
  'src/addons/resources.js',
  'src/addons/dungeon.js',
  'src/addons/wargaming.js',
  'src/lonelog/index.js',
  'src/lonelog/lexer.js',
  'src/lonelog/tags.js',
  'src/lonelog/fold.js',
  'src/lonelog/render.js',
  'src/lonelog/lint.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never serve the worker from its own cache, or a bad version pins itself.
  if (url.pathname.endsWith('/service-worker.js')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit ?? caches.match('index.html'))),
  );
});
