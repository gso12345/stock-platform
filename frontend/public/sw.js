// 설치형 PWA 요건(installability) 충족 + 빌드 산출물(해시 파일명) 캐싱
// HTML/API 등 변할 수 있는 요청은 항상 네트워크에서 최신 데이터를 가져옴
const STATIC_CACHE = "static-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))
      ),
    ])
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // vite 빌드 산출물은 파일명에 콘텐츠 해시가 포함되어 내용이 바뀌면 파일명도 바뀜
  // → 영구 캐시해도 안전 (cache-first, 미스 시 네트워크 후 캐시에 저장)
  if (req.method === "GET" && url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // 그 외(HTML, API, 웹소켓 등)는 항상 네트워크에서 최신 데이터 사용
  event.respondWith(fetch(req));
});
