// 설치형 PWA 요건(installability) 충족 + 빌드 산출물(해시 파일명) 캐싱
// HTML/API 등 변할 수 있는 요청은 항상 네트워크에서 최신 데이터를 가져옴
const STATIC_CACHE = "static-v1";
// 마지막으로 받은 화면 틀(HTML) — 인터넷이 끊겼을 때 이것으로 연다. 예전에는 화면 틀을 늘 네트워크에서만
// 받아서, 지하철 등에서 앱을 열면 브라우저 오류 화면이 떴다(사용자: "실제 앱같이 느껴졌으면" — 6번)
const SHELL_CACHE = "shell-v1";
const 화면틀 = "/__shell";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== STATIC_CACHE && k !== SHELL_CACHE).map((k) => caches.delete(k)))
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

  // 화면(HTML) — 미리 보내 둔 응답이 있으면 그것을, 없으면 네트워크에서. 늘 최신을 받는다.
  // 받은 것은 한 벌 들고 있다가, 네트워크가 안 되면(인터넷이 끊김) 그것으로 연다 — 주소마다 같은 화면
  // 틀(SPA)이라 한 벌이면 된다. 화면이 쓰는 JS·CSS 는 위에서 이미 들고 있다(한 번이라도 열었던 화면)
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = (await event.preloadResponse) || (await fetch(req));
          if (res && res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
            const 사본 = res.clone();
            event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.put(화면틀, 사본)));
          }
          return res;
        } catch (e) {
          const 들고있던 = await (await caches.open(SHELL_CACHE)).match(화면틀);
          if (들고있던) return 들고있던;
          throw e;
        }
      })()
    );
  }
  // 그 밖(같은 출처의 아이콘·manifest 등)은 손대지 않는다
});

// ── 웹 푸시 — 앱이 닫혀 있어도 알림을 띄운다 ──────────────────
// 서버(app/services/push_service.py)가 {title, body, url, tag} 를 암호화해 보낸다.
// 브라우저가 풀어서 여기로 넘긴다. 알림을 띄우지 않으면 브라우저가 구독을 끊는다
// (userVisibleOnly) — 내용을 못 읽어도 무언가는 띄운다.
self.addEventListener("push", (event) => {
  let 내용 = {};
  try {
    내용 = event.data ? event.data.json() : {};
  } catch (e) {
    내용 = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(내용.title || "새 알림", {
      body: 내용.body || "",
      icon: "/pwa-192.png",
      badge: "/pwa-192.png",
      // 같은 tag 는 한 칸으로 — 가격 알림이 여러 번 와도 알림판이 그 종목 하나로 뒤덮이지 않게
      tag: 내용.tag || undefined,
      renotify: Boolean(내용.tag),
      data: { url: 내용.url || "/notifications" },
    })
  );
});

// 알림을 누르면 — 열려 있는 앱 창이 있으면 그 창을 그 화면으로, 없으면 새로 연다
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const 갈곳 = new URL((event.notification.data && event.notification.data.url) || "/notifications",
                      self.location.origin).href;
  event.waitUntil((async () => {
    const 창들 = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const 창 of 창들) {
      if (new URL(창.url).origin === self.location.origin) {
        await 창.focus();
        if ("navigate" in 창) await 창.navigate(갈곳);
        return;
      }
    }
    await self.clients.openWindow(갈곳);
  })());
});
