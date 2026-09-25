// Service worker minimal : rend l'app installable, sans cache agressif des données
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => self.clients.claim());
self.addEventListener('fetch', () => {});
