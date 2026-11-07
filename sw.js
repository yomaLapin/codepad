const CACHE_NAME = 'nmtnote-cache-v1';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json'
];

// 설치 시 파일 캐싱
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(urlsToCache);
      })
  );
});

// 패치 (인터넷이 없어도 캐시에서 불러와 구동)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        return response || fetch(event.request);
      })
  );
});

// 새 버전으로 업데이트 될 때 이전 캐시 삭제
self.addEventListener('activate', (event) => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1 && cacheName.startsWith('nmtnote-')) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});