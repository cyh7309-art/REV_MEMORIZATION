/* ============================================================
   sw.js — 서비스워커 (오프라인 지원)
   ------------------------------------------------------------
   · 앱 셸과 본문 데이터를 캐시에 담아 인터넷 없이도 실행되게 한다.
   · 파일을 수정했다면 CACHE_VERSION 을 올려야 새 파일이 적용된다.
   · https 또는 localhost 에서만 등록된다. (file:// 실행은 영향 없음)
   ============================================================ */
'use strict';

var CACHE_VERSION = 'rev-memory-v1';

var ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './data/revelation_kor.js',
  './data/revelation_kor.json',
  './js/data.js',
  './js/storage.js',
  './js/diff.js',
  './js/scorer.js',
  './js/statistics.js',
  './js/srs.js',
  './js/plan.js',
  './js/voice.js',
  './js/report.js',
  './js/ui.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) {
        // 하나가 실패해도 나머지는 캐시되도록 개별 처리한다.
        return Promise.all(ASSETS.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE_VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) {
        // 캐시를 먼저 주고, 뒤에서 조용히 갱신한다.
        fetch(req).then(function (res) {
          if (res && res.ok) {
            caches.open(CACHE_VERSION).then(function (c) { c.put(req, res.clone()); });
          }
        }).catch(function () { /* 오프라인 */ });
        return cached;
      }
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // 오프라인이고 캐시에도 없다면 앱 셸로 대체한다.
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});

self.addEventListener('message', function (event) {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
