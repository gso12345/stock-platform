import axios from "axios";

const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api/v1`
  : "/api/v1";

export const API_BASE = BASE;

export const AUTH_STORAGE_KEY = "stkplt_auth";

/** 보통 요청의 상한. 목록·시세 같은 것은 이보다 오래 걸리면 뭔가
 *  잘못된 것이므로, 오래 붙잡고 있느니 끊고 다시 묻는 편이 낫다. */
const 보통상한 = 30_000;

/** **무거운 요청**의 상한 — 백테스트처럼 원래 오래 걸리는 것.
 *
 *  ── 왜 따로 두나 ─────────────────────────────────────────
 *
 *  30초를 그대로 쓰면 백테스트는 **정상 동작 중에도 끊긴다.**
 *  화면이 스스로 어림하는 시간과 견줘 보면 바로 드러난다 —
 *
 *      자산  5개  깨어있는 서버  7.2초 · 자던 서버 32.2초  ← 끊김
 *      자산 12개               9.4초 ·          34.4초  ← 끊김
 *      자산 20개              13.8초 ·          38.8초  ← 끊김
 *
 *  무료 서버는 한동안 요청이 없으면 잠들고, 깨우는 데만 20~50초가
 *  든다(그래서 진행바도 첫 요청에 25초를 얹는다). 거기에 계산이 더해져
 *  30초를 넘기면 axios 가 요청을 끊는데, 화면에는 '서버에 연결하지
 *  못했습니다' 로 뜬다 — **서버는 멀쩡히 계산 중인데** 고장으로 읽힌다.
 *
 *  유니버스 백테스트도 같은 자리다. 엔진 쪽에 '계산만으로 23초가 걸려
 *  화면의 30초 시한을 넘겼다(실측)' 는 기록이 남아 있는데, 그때는
 *  서버를 빠르게 만들어 피했을 뿐 상한 자체는 그대로였다.
 *
 *  실제로 걸릴 수 있는 최악(깨우기 50초 + 자산 20개 계산 15초)의
 *  두 배쯤 둔다. 이보다 더 걸리면 그때는 정말 뭔가 잘못된 것이다. */
export const 무거운상한 = 180_000;

const api = axios.create({
  baseURL: BASE,
  timeout: 보통상한,
});

api.interceptors.request.use((config) => {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { token?: string } };
      const token = parsed?.state?.token;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
  } catch {
    // localStorage 파싱 실패 시 무시
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      try {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      } catch {}
      /* 로그인/회원가입 페이지가 아닐 때만 리다이렉트.
         왜 갑자기 로그인 화면인지 알려주지 않으면, 사용자는 '데이터가
         사라졌다'거나 '앱이 고장났다'고 읽는다. 실제로 그런 문의가 있었다. */
      const path = window.location.pathname;
      if (!path.includes("/login") && !path.includes("/register")) {
        window.location.href = "/login?reason=expired";
      }
    }
    return Promise.reject(error);
  }
);

export default api;
