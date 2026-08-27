/**
 * API 서버에 미리 연결해 두는 태그를 만든다 (빌드할 때 index.html 에 넣는다).
 *
 * 왜 필요한가 — 브라우저는 첫 API 요청을 보내기 전에 그 서버와
 * DNS 조회 → TCP 연결 → TLS 악수를 해야 한다. 한국에서 싱가포르까지
 * 왕복 세 번이니 실제로 수백 ms 다. 그런데 그 일이 시작되는 시점은
 * **자바스크립트를 다 받아 실행한 뒤**다. preconnect 를 붙여 두면
 * 브라우저가 HTML 을 읽자마자 시작해서, 번들을 받는 동안 끝나 있다.
 *
 * 주소를 index.html 에 직접 적어 두었더니 배포 주소가 바뀐 뒤에도 옛
 * 주소가 남아 있었다 — 두 배로 손해다. 정작 필요한 곳은 미리 연결이
 * 안 되고, 쓰지도 않을 곳에 연결을 하나 여느라 제일 붐비는 순간을 더
 * 붐비게 한다. 그래서 VITE_API_URL 에서 만들어 넣는다.
 *
 * 이 파일이 vite.config.ts 밖에 따로 있는 이유 — 검사가 이 함수를
 * 부르려면 import 를 해야 하는데, vite.config 를 import 하면 vite 와
 * esbuild 가 통째로 딸려 와서 jsdom 안에서 터진다.
 */

/** VITE_API_URL 이 없으면 빈 문자열. 같은 도메인에서 API 도 받는
 *  배포라면 이미 연결돼 있어서 preconnect 에 뜻이 없다. */
export function API미리연결(apiUrl: string | undefined): string {
  if (!apiUrl) return "";
  let origin: string;
  try {
    /* preconnect 는 출처(origin)만 받는다. 경로가 붙어 있으면 브라우저가
       그 태그를 통째로 무시한다 — 조용히 아무 일도 안 하게 된다 */
    origin = new URL(apiUrl).origin;
  } catch {
    return "";   // 주소 모양이 아니면 조용히 넘어간다. 빌드를 깨뜨릴 일이 아니다
  }
  /* crossorigin 이 있어야 한다. API 요청은 CORS 요청이라, 그것 없이
     연 연결은 재사용되지 않고 새로 하나 더 연다 — 미리 연결한 뜻이 없다 */
  return (
    `<link rel="preconnect" href="${origin}" crossorigin />\n` +
    `    <link rel="dns-prefetch" href="${origin}" />`
  );
}
