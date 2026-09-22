/* sw.js — minimal offline app-shell cache for the web PWA.
 * Not active under file:// (Android WebView shell); used when deployed over http(s). */
'use strict';
var VERSION = 'breakout-pwa-v1';
var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/levels.js',
  './js/audio.js',
  './js/store.js',
  './js/engine.js',
  './js/pwa.js',
  './icons/icon.svg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(VERSION).then(function (cache) { return cache.addAll(ASSETS); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== VERSION; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  // Only handle same-origin GETs; never proxy cross-origin (there are none).
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (resp) {
        var copy = resp.clone();
        caches.open(VERSION).then(function (cache) { cache.put(e.request, copy); });
        return resp;
      }).catch(function () { return caches.match('./index.html'); });
    })
  );
});
