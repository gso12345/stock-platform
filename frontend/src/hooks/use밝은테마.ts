import { useEffect, useState } from "react";

/**
 * 지금 화면이 라이트인가 — html 의 light 클래스를 지켜본다.
 *
 * 캔버스로 그리는 차트(종목 차트)는 CSS 변수를 못 쓰고 색 글자를 받는다. 예전엔 차트를 만들 때 한 번만 클래스를
 * 읽어서, 차트가 떠 있는 동안 테마가 바뀌면(설정에서 바꾸거나 '시스템' 인데 기기가 밤낮으로 바뀌면) 옛 색이 남았다 —
 * 같은 다크모드인데 차트만 하얀 판이었다.
 *
 * 설정값이 아니라 **클래스**를 본다. 클래스는 Layout 이 설정·기기 설정을 합쳐 붙이는 최종 결과라(utils/테마.ts),
 * 여기서 규칙을 다시 짜면 둘이 어긋날 수 있다. 또 자식의 effect 가 Layout 의 effect 보다 먼저 돌아서, 설정값을
 * 보면 아직 옛 클래스인 채로 차트를 다시 그린다 — 클래스가 바뀐 뒤에 알려 주는 쪽이 맞다.
 */
export function use밝은테마(): boolean {
  const [밝음, set밝음] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("light"));
  useEffect(() => {
    const html = document.documentElement;
    const 보기 = () => set밝음(html.classList.contains("light"));
    보기();
    const 지켜보기 = new MutationObserver(보기);
    지켜보기.observe(html, { attributes: true, attributeFilter: ["class"] });
    return () => 지켜보기.disconnect();
  }, []);
  return 밝음;
}
