const CACHE_NAME = 'nmtnote-cache-auto';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// 1. 설치 과정 (초기 캐싱)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
  // 대기하지 않고 즉시 새로운 서비스 워커를 활성화
  self.skipWaiting();
});

// 2. 활성화 과정 (기존 낡은 캐시 정리)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith('nmtnote-')) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // 활성화 즉시 모든 열린 탭/앱에 대한 제어권 확보
  self.clients.claim();
});

// 3. 데이터 패치 (★ 네트워크 우선, 실패 시 캐시 백업)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    // 항상 서버(네트워크)에서 먼저 최신 파일을 가져오려 시도합니다.
    fetch(event.request)
      .then((response) => {
        // 서버에서 성공적으로 최신 파일을 받아오면 캐시도 최신본으로 갱신합니다.
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // 인터넷이 끊긴 오프라인 상태라면, 기기에 저장된 캐시를 대신 꺼내줍니다.
        return caches.match(event.request);
      })
  );
});
