/**
 * 인터넷이 이어져 있나 — 끊기면 앱 틀이 '오프라인' 띠를 보인다.
 *
 * 예전에는 지하철 등에서 앱을 열면 브라우저 오류 화면이 떴다(서비스워커가 화면 틀을 늘 네트워크에서만
 * 받았다 — public/sw.js). 이제 마지막 화면 틀로 열고, 끊긴 동안은 그렇다고 말한다. 다시 이어지면
 * 자료는 react-query 가 스스로 다시 받는다(refetchOnReconnect).
 */
import { useEffect, useState } from "react";

export function use인터넷(): boolean {
  const [이어짐, set이어짐] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    const 켬 = () => set이어짐(true);
    const 끔 = () => set이어짐(false);
    window.addEventListener("online", 켬);
    window.addEventListener("offline", 끔);
    return () => {
      window.removeEventListener("online", 켬);
      window.removeEventListener("offline", 끔);
    };
  }, []);
  return 이어짐;
}
