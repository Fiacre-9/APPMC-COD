// Service worker Mireb : applications installables + consultation hors connexion.
// Les données (API, commandes, connexions) passent toujours par le réseau et ne sont jamais mises en cache.
const VERSION = 'mireb-v5';
const STATIC = `${VERSION}-static`, PAGES = `${VERSION}-pages`, IMAGES = `${VERSION}-images`;
const PRECACHE = ['/offline.html', '/style.css', '/pwa.js', '/widget.js', '/markdown.js', '/icon.svg',
  '/icons/boutique-192.png', '/icons/vendeur-192.png', '/icons/livreur-192.png', '/icons/admin-192.png'];
const NETWORK_ONLY = /^\/(api|vendor\/(api|auth)|public|auth|health|manifests)(\/|$)/;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(STATIC).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Garde au plus `max` entrées dans un cache (les plus anciennes partent)
async function trim(name, max) {
  const c = await caches.open(name), keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await c.delete(k);
}

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || NETWORK_ONLY.test(url.pathname)) return;

  // Pages : réseau d'abord (prix et stock à jour), copie locale si pas de connexion
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok && url.pathname !== '/suivi') { const copy = res.clone(); caches.open(PAGES).then(c => c.put(req, copy)).then(() => trim(PAGES, 60)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: url.pathname.startsWith('/livreur') })
      .then(r => r || caches.match('/offline.html'))));
    return;
  }

  // Photos produits : cache d'abord (elles ne changent jamais de nom)
  if (url.pathname.startsWith('/uploads/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(IMAGES).then(c => c.put(req, copy)).then(() => trim(IMAGES, 200)); }
      return res;
    })));
    return;
  }

  // Scripts, styles, icônes, polices : réponse immédiate depuis le cache puis mise à jour en arrière-plan
  if (/\.(js|css|png|svg|woff2?)$/.test(url.pathname) || url.hostname.endsWith('gstatic.com')) {
    e.respondWith(caches.open(STATIC).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
  }
});

// ---------- Notifications push ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Mireb', body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Mireb', {
    body: d.body || '', icon: d.icon || '/icons/boutique-192.png', badge: '/icons/boutique-192.png',
    tag: d.tag, renotify: !!d.tag, data: { url: d.url || '/' }, vibrate: [120, 60, 120],
  }));
});
// Un clic ouvre la bonne page : fenêtre de l'app déjà ouverte si possible
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', location.origin).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const same = list.find(c => new URL(c.url).pathname === new URL(url).pathname);
    if (same) return same.focus().then(c => c.navigate ? c.navigate(url) : c);
    return clients.openWindow(url);
  }));
});
