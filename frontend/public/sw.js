// 설치형 PWA 요건(installability)을 충족하기 위한 최소 서비스워커
// 별도 오프라인 캐싱 전략 없이 fetch 이벤트를 패스스루만 처리
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
