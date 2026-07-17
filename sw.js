// This service worker previously cached the app shell, but a stale cache could get
// "stuck" and keep serving old files forever after an update. That's a worse experience
// than no offline support, so this version self-destructs: it clears all caches,
// unregisters itself, and tells every open tab to reload once with a clean slate.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      await self.registration.unregister();
      const clientsList = await self.clients.matchAll({ type: 'window' });
      clientsList.forEach((client) => client.navigate(client.url));
    })()
  );
});

// No fetch handler: everything passes straight through to the network.
