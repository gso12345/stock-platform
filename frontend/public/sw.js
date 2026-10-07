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
      // 화면(HTML) 요청을 서비스워커가 깨어나는 동안 미리 보내 둔다.
      // 없으면 '서비스워커 깨우기 → 그다음에 요청' 이 차례로 붙는다
      self.registration.navigationPreload
        ? self.registration.navigationPreload.enable()
        : Promise.resolve(),
    ])
  );
});

/** 캐시에 넣어도 되는 응답 — 해시 파일명의 진짜 정적 파일만.
 *  없는 파일을 물으면 호스팅이 index.html 을 200 으로 줄 수 있다. 그걸
 *  JS 이름으로 캐시에 넣으면 그 파일은 영영 HTML 이 된다 */
function 담아도되나(res) {
  if (!res.ok) return false;
  const 종류 = res.headers.get("content-type") || "";
  return !종류.includes("text/html");
}

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // GET 이 아니거나 다른 출처(API 서버 등)면 **손대지 않는다**.
  // 예전에는 모든 요청을 respondWith(fetch(req)) 로 감쌌다. 하는 일은
  // 없는데, 그 요청마다 서비스워커가 깨어나길 기다려야 했다 — 브라우저는
  // 쉬는 서비스워커를 30초쯤이면 재우므로 꽤 자주 기다린다.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // vite 빌드 산출물은 파일명에 콘텐츠 해시가 포함되어 내용이 바뀌면 파일명도 바뀜
  // → 영구 캐시해도 안전 (cache-first, 미스 시 네트워크 후 캐시에 저장)
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        const res = await fetch(req);
        if (담아도되나(res)) cache.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // 화면(HTML) — 미리 보내 둔 응답이 있으면 그것을, 없으면 네트워크에서.
  // 늘 최신을 받는다(캐시하지 않는다)
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => (await event.preloadResponse) || fetch(req))()
    );
  }
  // 그 밖(같은 출처의 아이콘·manifest 등)은 손대지 않는다
});
