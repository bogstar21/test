// StarX platform service worker. Cache-first for /platform/assets (URLs carry ?v= so
// a bump invalidates them). Everything else (API, HTML) always hits the network.
var CACHE = "starx-shell-v1";
var ASSETS = ["/platform/assets/app.css?v=1", "/platform/assets/app.js?v=1", "/platform/assets/icon.svg"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (url.pathname.indexOf("/platform/assets") === 0) {
    e.respondWith(caches.match(e.request).then(function (r) { return r || fetch(e.request); }));
  }
});
