/* ============================================================
   sw.js — 서비스워커 (오프라인 지원)
   ------------------------------------------------------------
   · 앱 셸과 본문 데이터를 캐시에 담아 인터넷 없이도 실행되게 한다.
   · 온라인이면 서버의 최신 파일을 먼저 쓰므로, 배포 후 새로고침 한 번이면 반영된다.
   · CACHE_VERSION 은 캐시 대청소가 필요할 때만 올리면 된다. (매번 올릴 필요 없음)
   · https 또는 localhost 에서만 등록된다. (file:// 실행은 영향 없음)
   ============================================================ */
'use strict';

var CACHE_VERSION = 'rev-memory-v9';

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
  './js/read.js',
  './js/puzzle.js',
  './js/voice.js',
  './js/report.js',
  './js/ui.js',
  './js/app.js',
  './icons/favicon-32.png',
  './icons/favicon-64.png',
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

/* 온라인이면 언제나 서버의 최신 파일을 먼저 쓴다. (network-first)
   예전에는 캐시를 먼저 내줘서, 새로 배포해도 CACHE_VERSION 을 올리고
   두 번 새로고침해야 반영됐다. 이제는 배포 후 한 번만 새로고침하면 된다.
   서버가 느리거나 오프라인이면 캐시로 넘어가므로 인터넷 없이도 그대로 열린다. */
var NETWORK_TIMEOUT_MS = 3000;

function fromNetwork(req) {
  // 'no-cache' = 브라우저 HTTP 캐시를 믿지 않고 서버에 바뀌었는지 물어본다(안 바뀌었으면 304로 가볍게 끝난다).
  return fetch(req, { cache: 'no-cache' }).then(function (res) {
    if (res && res.ok && res.type === 'basic') {
      var copy = res.clone();
      caches.open(CACHE_VERSION).then(function (c) { c.put(req, copy); });
    }
    return res;
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  event.respondWith(new Promise(function (resolve) {
    var settled = false;
    function done(res) { if (!settled && res) { settled = true; resolve(res); } }

    function fallback() {
      return caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(function (cached) {
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return null;
      });
    }

    // 서버가 너무 느리면 기다리지 않고 캐시를 먼저 내준다.
    var timer = setTimeout(function () { fallback().then(done); }, NETWORK_TIMEOUT_MS);

    fromNetwork(req).then(function (res) {
      clearTimeout(timer);
      if (res && res.ok) { done(res); return; }
      // 404 등: 캐시에 있으면 그걸, 없으면 서버 응답 그대로
      fallback().then(function (cached) { done(cached || res); });
    }).catch(function () {
      clearTimeout(timer);
      fallback().then(function (cached) {
        done(cached || new Response('', { status: 504, statusText: 'offline' }));
      });
    });
  }));
});

self.addEventListener('message', function (event) {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
