/**
 * 앱의 밝기(라이트·다크)를 화면 **밖**에도 알린다 — 앱 설정 하나가 기준이 되게.
 *
 * 사용자: "다크모드의 다크모드 화이트모드의 다크모드 다크모드의 화이트 모드 등 색깔이 다달라 / 시스템설정과 앱설정이
 * 통일이 되지 않아 / 심지어 같은 다크모드여도 색깔이 달라"
 *
 * 앱 색은 html 의 light 클래스로 칠하는데(앱 설정 → 라이트·다크·시스템), 브라우저에는 `color-scheme: dark light`
 * ("둘 다 된다")라고만 알려 두었다. 그러면 브라우저는 **기기 설정**을 보고 색 모드를 고른다 —
 *   · 스크롤바·고르기 목록·날짜 달력·체크박스 같은 브라우저 부품이 기기 설정을 따른다(앱 다크인데 하얀 달력)
 *   · 크롬 '웹사이트 어둡게'·삼성 인터넷 다크 모드가 앱이 칠한 색 위에 제 다크 처리를 덧칠한다 —
 *     앱 라이트가 새까만 '가짜 다크' 가 되고, 앱 다크도 테두리가 하얗게 바뀌었다(같은 다크인데 색이 다르다)
 * 그래서 앱이 고른 밝기를 그대로 알린다: 다크는 `dark`, 라이트는 `only light`('only' 가 있어야 브라우저가 어둡게
 * 덧칠하지 않는다). 휴대폰 상태 표시줄 색도 같이 — 바로 아래 머리 줄(bg-primary)과 같은 색이라야 경계가 안 보인다.
 *
 * 화면이 그려지기 전에는 index.html 의 첫 스크립트가 같은 일을 한다(여기를 못 부른다) — 둘이 같은지는
 * utils/__tests__/테마.test.ts 가 실제로 돌려 본다.
 */
export const 상태줄색 = { light: "#f8fafc", dark: "#0f1117" } as const;

/** 브라우저에 알릴 색 모드 — 라이트는 'only' 를 붙여야 브라우저가 어둡게 덧칠하지 않는다 */
export function 색모드(밝음: boolean): string {
  return 밝음 ? "only light" : "dark";
}

export function 테마적용(밝음: boolean, 문서: Document = document): void {
  const html = 문서.documentElement;
  html.classList.toggle("light", 밝음);
  html.classList.toggle("dark", !밝음);
  문서.querySelector('meta[name="color-scheme"]')?.setAttribute("content", 색모드(밝음));
  문서.querySelector('meta[name="theme-color"]')?.setAttribute("content", 밝음 ? 상태줄색.light : 상태줄색.dark);
}
