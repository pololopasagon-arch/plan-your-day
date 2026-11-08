/* Service worker: caché offline.
   Estrategia "stale-while-revalidate": responde al instante con la copia en caché
   y la actualiza en segundo plano. Cambia CACHE al publicar una versión nueva. */
'use strict';

var CACHE = 'trading-cal-v1';
var PREFIX = 'trading-cal-';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        // Solo borra cachés propias antiguas (el dominio puede alojar otras apps).
        return Promise.all(keys
          .filter(function (k) { return k.indexOf(PREFIX) === 0 && k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  var isNav = req.mode === 'navigate';

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: isNav }).then(function (cached) {
        var network = fetch(req)
          .then(function (res) {
            if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
            return res;
          })
          .catch(function () {
            if (cached) return cached;
            if (isNav) return cache.match('./');
            return Response.error();
          });

        if (cached) {
          event.waitUntil(network.catch(function () {}));
          return cached;
        }
        if (isNav) {
          return network.then(function (res) { return res || cache.match('./'); });
        }
        return network;
      });
    })
  );
});
