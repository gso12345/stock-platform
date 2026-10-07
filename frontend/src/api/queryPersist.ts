/**
 * 지난번에 받아 둔 것을 브라우저에 남겨 두었다가, 다음에 열 때 곧바로
 * 화면에 올린다.
 *
 * ── 왜 ──────────────────────────────────────────────────
 *
 * 지금은 앱을 열 때마다 화면이 완전히 비어 있는 데서 시작한다. 받아 둔
 * 것이 메모리에만 있어서 탭을 닫으면 사라지기 때문이다. 그래서 어제도
 * 오늘도 본 화면인데, 열 때마다 서버가 답할 때까지 뼈대(스켈레톤)만
 * 보고 기다린다. 서버가 아무리 빨라도 한국에서 싱가포르까지 왕복은
 * 남고, 그 왕복은 자바스크립트를 다 받아 실행한 **뒤에야** 시작된다.
 *
 * 마지막으로 본 값을 디스크에 남겨 두면 그 기다림이 사라진다 — 화면이
 * 곧바로 차고, 새 값이 오면 조용히 바뀐다.
 *
 * ── 무엇을 남기나 ────────────────────────────────────────
 *
 * **누가 보느냐와 무관한 것만** 남긴다. 지수·환율·순위·뉴스가 그렇다.
 * 내 자산·관심종목·알림·피드의 좋아요 여부는 남기지 않는다 — 공용
 * 기기에서 다음 사람에게 그대로 넘어가면 안 되고, 어차피 로그인해야
 * 볼 수 있는 값이라 남겨도 못 쓴다.
 *
 * ── 오래된 값은 안 되살린다 ──────────────────────────────
 *
 * 사흘 전 코스피가 잠깐 떴다 바뀌는 것은 빈 화면보다 나쁘다. 그 값을
 * 보고 판단할 수도 있다. 여섯 시간이 지난 것은 그냥 버린다.
 *
 * 되살릴 때 '받은 시각'을 그때 그대로 넣는 것이 중요하다. 지금 시각으로
 * 넣으면 react-query 가 신선하다고 보고(staleTime 5분) 새로 안 받아
 * 온다 — 옛날 값이 화면에 눌러앉는다.
 */
import type { QueryClient } from "@tanstack/react-query";

const 열쇠 = "qcache_v1";

/** 이보다 오래된 것은 안 되살린다 */
export const 최대나이 = 6 * 60 * 60 * 1000;

/** 통째로 이 크기를 넘으면 안 담는다. localStorage 는 보통 5MB 다 */
export const 최대바이트 = 1_000_000;

/** 한 항목이 이보다 크면 그것만 뺀다 — 뉴스 100건이 여기 걸릴 수 있다 */
export const 항목최대바이트 = 300_000;

/**
 * 남겨도 되는 조회인가.
 *
 * 이름표(queryKey)의 첫 칸만 본다. 여기 없는 것은 안 남긴다 —
 * 허용 목록이라, 새로 만든 조회가 실수로 딸려 들어가지 않는다.
 */
export const 남길것들 = [
  "dashboard-kr",
  "dashboard-us",
  "dashboard-us-rates",
  "news",
  "rankings",
  "exchange-rate",
] as const;

export function 담을만한가(key: unknown): boolean {
  if (!Array.isArray(key) || key.length === 0) return false;
  const 첫칸 = key[0];
  return typeof 첫칸 === "string" && (남길것들 as readonly string[]).includes(첫칸);
}

/**
 * 로그인한 **그 사람의 칸**에만 남기는 것.
 *
 * 예전에는 내 자산·관심종목을 아예 안 남겼다. "공용 기기에서 다음 사람에게
 * 넘어가면 안 되고, 어차피 로그인해야 볼 수 있다" 였는데, 로그인은 기기에
 * 남는다(authStore). 그래서 다시 온 사람은 로그인된 채로 매번 빈 뼈대부터
 * 보고 기다렸다 — 서버가 잠들어 있었으면 수십 초를.
 *
 * 그래서 사람별로 칸을 나눠 남긴다(qcache_v1:u{아이디}).
 *   · 되살릴 때는 지금 로그인한 사람의 칸만 읽는다 — 남의 칸은 열 일이 없다.
 *   · 로그인·로그아웃·인증 만료 때는 사람 칸을 **전부** 지운다(사람칸_모두지우기).
 *   · 시세는 안 남긴다. 몇 시간 전 가격을 지금 값처럼 보여 주는 것은 빈칸보다
 *     나쁘다 — 시세는 서버가 목록에 실어 보내는 것(받아 둔 시세)으로 곧바로 찬다.
 */
export const 사람것들 = [
  "portfolio-items-all",
  "portfolios",
  "watchlist-items",
  "watchlist-folders",
  "quant-compare",
] as const;

export function 사람칸에_담을만한가(key: unknown): boolean {
  if (!Array.isArray(key) || key.length === 0) return false;
  const 첫칸 = key[0];
  return typeof 첫칸 === "string" && (사람것들 as readonly string[]).includes(첫칸);
}

const 사람칸_머리 = `${열쇠}:u`;

/** 지금 로그인한 사람의 칸 이름. 로그인 안 했으면 null.
 *  authStore 를 import 하면 순환 참조라(스토어가 queryClient 를 부른다)
 *  저장된 인증 정보를 직접 읽는다 — recentlyViewed 와 같은 방식 */
export function 사람칸(): string | null {
  try {
    const raw = localStorage.getItem("stkplt_auth");
    if (!raw) return null;
    const o = JSON.parse(raw);
    const id = o?.state?.userId ?? o?.userId;
    const 로그인 = o?.state?.isLoggedIn ?? true;
    return id != null && 로그인 ? `${사람칸_머리}${id}` : null;
  } catch {
    return null;
  }
}

/** 사람 칸을 전부 지운다 — 사람이 바뀌거나 로그인이 끊겼을 때 */
export function 사람칸_모두지우기(): void {
  try {
    const 지울것: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(사람칸_머리)) 지울것.push(k);
    }
    지울것.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* 못 지워도 다음 사람은 자기 칸만 읽는다 */
  }
}

export interface 담긴것 {
  k: unknown[];
  d: unknown;
  /** 서버에서 받은 시각(ms) */
  t: number;
}

/**
 * 캐시에서 남길 것만 골라낸다.
 *
 * 오류로 끝난 조회, 값이 없는 조회는 안 담는다 — 되살려 봐야 화면에
 * 아무것도 못 그리면서 '이미 받았다' 고 표시돼 새로 받는 것만 늦춘다.
 */
export function 골라담기(
  항목들: { queryKey: unknown; state: { data?: unknown; dataUpdatedAt?: number; status?: string } }[],
  지금 = Date.now(),
  허용: (key: unknown) => boolean = 담을만한가,
): 담긴것[] {
  const 결과: 담긴것[] = [];
  let 합계 = 0;
  for (const q of 항목들) {
    if (!허용(q.queryKey)) continue;
    if (q.state.status !== "success" || q.state.data == null) continue;
    const t = q.state.dataUpdatedAt ?? 0;
    if (!t || 지금 - t > 최대나이) continue;
    let 크기: number;
    let 한줄: 담긴것;
    try {
      한줄 = { k: q.queryKey as unknown[], d: q.state.data, t };
      크기 = JSON.stringify(한줄).length;
    } catch {
      continue;   // 돌고 도는 참조 등 — 담을 수 없는 값은 조용히 넘어간다
    }
    if (크기 > 항목최대바이트) continue;
    if (합계 + 크기 > 최대바이트) continue;
    합계 += 크기;
    결과.push(한줄);
  }
  return 결과;
}

/** 담아 둔 것 중 아직 쓸 만한 것만 */
export function 되살릴것(
  담긴: unknown, 지금 = Date.now(), 허용: (key: unknown) => boolean = 담을만한가,
): 담긴것[] {
  if (!Array.isArray(담긴)) return [];
  return 담긴.filter((x): x is 담긴것 => {
    if (!x || typeof x !== "object") return false;
    const o = x as 담긴것;
    return (
      Array.isArray(o.k) && 허용(o.k) &&
      o.d != null &&
      typeof o.t === "number" && o.t > 0 && 지금 - o.t <= 최대나이
    );
  });
}

/**
 * 앱이 뜰 때 한 번 — 남겨 둔 것을 캐시에 넣는다.
 *
 * '받은 시각'을 그때 값 그대로 넣는다. 지금 시각을 넣으면 react-query 가
 * 신선하다고 보고 새로 안 받아 온다.
 */
function 읽기(이름: string): unknown {
  try {
    const raw = localStorage.getItem(이름);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;   // 사생활 보호 모드 등 — 못 읽으면 그냥 빈 화면에서 시작한다
  }
}

export function 되살리기(qc: QueryClient, 지금 = Date.now()): number {
  const 쓸것 = 되살릴것(읽기(열쇠), 지금);
  const 내칸 = 사람칸();
  if (내칸) 쓸것.push(...되살릴것(읽기(내칸), 지금, 사람칸에_담을만한가));
  for (const x of 쓸것) {
    qc.setQueryData(x.k, x.d, { updatedAt: x.t });
  }
  return 쓸것.length;
}

/** 지금 캐시를 디스크에 쓴다 */
function 쓰기(이름: string, 담을것: 담긴것[]): void {
  try {
    if (담을것.length === 0) localStorage.removeItem(이름);
    else localStorage.setItem(이름, JSON.stringify(담을것));
  } catch {
    /* 용량 초과·사생활 보호 모드. 다음에 못 되살릴 뿐 지금 화면은 멀쩡하다 */
  }
}

export function 저장하기(qc: QueryClient, 지금 = Date.now()): void {
  let 모두: { queryKey: unknown; state: { data?: unknown; dataUpdatedAt?: number; status?: string } }[];
  try {
    모두 = qc.getQueryCache().getAll().map((q) => ({ queryKey: q.queryKey, state: q.state }));
  } catch {
    return;
  }
  쓰기(열쇠, 골라담기(모두, 지금));
  /* 쓰는 그 순간에 로그인한 사람의 칸에만 쓴다. 로그아웃 직후 몰아쓰기가
     돌아도 칸이 없으니(사람칸() === null) 아무것도 안 남는다 */
  const 내칸 = 사람칸();
  if (내칸) 쓰기(내칸, 골라담기(모두, 지금, 사람칸에_담을만한가));
}

/**
 * 캐시가 바뀔 때마다 쓰되, 몰아서 쓴다.
 *
 * 대시보드 하나 여는 동안 캐시 이벤트가 수십 번 난다. 그때마다
 * JSON.stringify 를 하면 그 자체가 화면을 버벅이게 한다 — 마침
 * 제일 바쁜 순간이다.
 */
export function 붙이기(qc: QueryClient, 뜸들이기 = 3_000): () => void {
  let 예약: ReturnType<typeof setTimeout> | null = null;
  const 쓰기 = () => { 예약 = null; 저장하기(qc); };
  const 그만 = qc.getQueryCache().subscribe(() => {
    if (예약) return;
    예약 = setTimeout(쓰기, 뜸들이기);
  });
  /* 탭을 닫거나 뒤로 보낼 때 한 번 더 쓴다. 뜸 들이는 동안 나가면
     방금 받은 것이 통째로 안 남는다 */
  const 나갈때 = () => { if (document.visibilityState === "hidden") 저장하기(qc); };
  document.addEventListener("visibilitychange", 나갈때);
  return () => {
    그만();
    document.removeEventListener("visibilitychange", 나갈때);
    if (예약) clearTimeout(예약);
  };
}
