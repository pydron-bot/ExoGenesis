/* Exo Genesis service worker. Built into dist/sw.js by vite.config.ts
 * (serviceWorker plugin), which fills in __CACHE__ and __PRECACHE__.
 *
 * - Install: precache the whole game (not the editor), so it plays offline
 *   after the first visit and as an installed app.
 * - Pages, content and media: network first (a release or an editor commit
 *   shows up on the next load), the cache when offline or the network is slow.
 * - assets/*: names carry a content hash, so the cached copy is always right.
 * - Other origins (the editor's GitHub API calls) and the editor page: not touched.
 */
const CACHE = __CACHE__;
const PRECACHE = __PRECACHE__;
const SLOW_MS = 5000;
// one copy per URL: headers like Origin (module scripts send it) mustn't make a cached file miss
const MATCH = { ignoreVary: true };

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // one by one, past any failure: a missing file shouldn't stop the rest; `reload` skips the HTTP cache
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (res.ok) await cache.put(url, res);
      } catch { /* offline mid-install: cached on first use instead */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('exo-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.endsWith('/editor.html')) return; // the editor stays online-only
  if (url.pathname.includes('/assets/')) e.respondWith(cacheFirst(req));
  else e.respondWith(networkFirst(req, req.mode === 'navigate'));
});

async function cacheFirst(req) {
  const hit = await caches.match(req, MATCH);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
  return res;
}

async function networkFirst(req, page) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then((res) => {
    if (res.ok && !req.headers.has('range')) cache.put(page ? './' : req, res.clone());
    return res;
  });
  net.catch(() => {}); // handled below; this just keeps a lost race quiet
  const fallback = async () => (await cache.match(page ? './' : req, { ...MATCH, ignoreSearch: page })) ?? (await cache.match(req, MATCH));
  // on a slow connection, start from the cache rather than wait
  const slow = new Promise((r) => setTimeout(r, SLOW_MS)).then(fallback);
  try {
    return await Promise.race([net, slow.then((hit) => hit ?? net)]);
  } catch {
    return (await fallback()) ?? Response.error();
  }
}
