export function fmtKRW(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `${(v / 1e12).toFixed(2)}조`;
  if (abs >= 1e8)  return `${(v / 1e8).toFixed(0)}억`;
  if (abs >= 1e4)  return `${(v / 1e4).toFixed(0)}만`;
  return v.toLocaleString("ko-KR");
}

export function fmtUSD(v: number | null | undefined): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `$${(v / 1e9).toFixed(2)}B`;
  if (abs >= 1e6)  return `$${(v / 1e6).toFixed(2)}M`;
  return `$${v.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** 원화 축약 표시 (₩ 기호 포함, 차트 툴팁 등 공간이 좁은 곳에 사용) */
export function fmtKRWCompact(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}₩${(abs / 1e12).toFixed(2)}조`;
  if (abs >= 1e8)  return `${sign}₩${(abs / 1e8).toFixed(2)}억`;
  if (abs >= 1e4)  return `${sign}₩${(abs / 1e4).toFixed(1)}만`;
  return `${sign}₩${Math.round(abs).toLocaleString("ko-KR")}`;
}

/** 원화 일의 자리까지 표시(축약 없음) */
export function fmtKRWFull(v: number): string {
  const sign = v < 0 ? "-" : "";
  return `${sign}₩${Math.round(Math.abs(v)).toLocaleString("ko-KR")}`;
}

/** 원화 일의 자리까지 표시 + 양수 부호(+) */
export function fmtKRWFullSign(v: number): string {
  return `${v >= 0 ? "+" : ""}${fmtKRWFull(v)}`;
}

/** 달러 일의 자리까지 표시(축약 없음) */
export function fmtUSDFull(v: number): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 종목의 원화/달러 표시 통화에 맞춰 일의 자리까지 표시 */
export function fmtNative(market: string, currency: string, price: number): string {
  if (market === "KR" || currency === "KRW") return fmtKRWFull(price);
  return fmtUSDFull(price);
}

/** 거래량 표시: KR은 만주/억주 단위, US/ETF는 K/M/B 단위 */
export function fmtVolume(v: number | null | undefined, isKR: boolean): string {
  if (v == null) return "—";
  if (isKR) {
    if (v >= 1e8) return `${(v / 1e8).toFixed(1)}억주`;
    if (v >= 1e4) return `${(v / 1e4).toFixed(1)}만주`;
    return v.toLocaleString("ko-KR");
  }
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toLocaleString("en-US");
}

export function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v == null) return "—";
  return v.toFixed(digits);
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return d.replace(/(\d{4})-?(\d{2})-?(\d{2})/, "$1년 $2월 $3일");
}

/** 뉴스 발행시각 문자열("MM/DD HH:MM" 또는 "YYYY/MM/DD HH:MM", KST) → Date */
export function parseNewsKstDate(published: string): Date | null {
  let m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/.exec(published);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi) - 9 * 60 * 60 * 1000);
  }
  m = /^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/.exec(published);
  if (m) {
    const [, mo, d, h, mi] = m;
    const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    let year = nowKst.getUTCFullYear();
    // 12월 기사인데 현재가 1월이면 작년 기사
    if (+mo === 12 && nowKst.getUTCMonth() === 0) year -= 1;
    return new Date(Date.UTC(year, +mo - 1, +d, +h, +mi) - 9 * 60 * 60 * 1000);
  }
  return null;
}

/** 뉴스 발행시각(문자열 또는 unix seconds) → 정렬용 ms 타임스탬프. 파싱 불가 시 0(최하위로 정렬) */
export function newsTimestampMs(published: string | number | null | undefined): number {
  if (published == null) return 0;
  if (typeof published === "number") return published * 1000;
  const date = parseNewsKstDate(published);
  return date ? date.getTime() : 0;
}

/** 뉴스 발행시각 → "N분 전"/"N시간 전"/"N일 전" + "YYYY/MM/DD" 결합 표시 */
export function fmtNewsDateTime(published: string | null | undefined): string {
  if (!published) return "";
  const date = parseNewsKstDate(published);
  if (!date) return published;

  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  let rel: string;
  if (diffMin < 1) rel = "방금 전";
  else if (diffMin < 60) rel = `${diffMin}분 전`;
  else if (diffMin < 60 * 24) rel = `${Math.floor(diffMin / 60)}시간 전`;
  else if (diffMin < 60 * 24 * 7) rel = `${Math.floor(diffMin / (60 * 24))}일 전`;
  else rel = "";

  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const mo = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const abs = `${y}/${mo}/${d}`;

  return rel ? `${rel} · ${abs}` : abs;
}

/** "3분 전", "2시간 전" — 지금으로부터 얼마나 지났는지.
 *
 *  같은 함수가 일곱 파일에 각각 있었다. 그중 다섯은 앞의 가드가 빠져
 *  있어서, 날짜가 없는 글에 "NaN분 전" 이 떴다. 커뮤니티·피드·
 *  내 프로필·마이페이지·알림 목록이 그 다섯이다 — 같은 시각을
 *  화면마다 다르게 보여 주고 있었던 셈이다.
 *
 *  한 벌로 모은다. 고칠 일이 생기면 여기만 고치면 된다. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";        // "2026-13-45" 같은 값도 막는다
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금 전";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}


/**
 * 막대 위 라벨 — 자리가 열두 칸뿐이다.
 *
 * 휴대폰 폭(390px)에서 한 칸이 28px 남짓인데, '8,140' 은 다섯 글자라
 * 그대로 두면 '8,1…' 로 잘린다. 잘린 숫자는 안 쓰느니만 못하다 —
 * 8,140 인지 81,400 인지 알 수가 없다.
 *
 * 그래서 만 아래도 천 단위로 줄인다. 이 라벨의 쓸모는 '어느 달이 큰가'
 * 를 눈으로 재는 것이지 원 단위까지 읽는 것이 아니다(정확한 금액은
 * 막대를 누르면 아래 줄에 그대로 나온다).
 */
export function 짧은돈(v: number): string {
  if (!v) return "";
  /* 경계값이 어중간한 이유 —
     단위를 바꾸는 지점을 딱 1억·1만으로 잡으면, 그 **바로 아래** 값이
     반올림되면서 자릿수가 하나 늘어난다. 99,999,999원은 1억이 안 되니
     만 단위인데 반올림하면 '10000만'(여섯 글자)이다. 그래서 '반올림해도
     자릿수가 안 넘치는 마지막 값' 을 경계로 쓴다. */
  if (v >= 999_950_000_000) return `${(v / 1_000_000_000_000).toFixed(1)}조`;
  /* 100억을 넘으면 소수 첫째 자리를 뗀다 — '123.5억' 은 여섯 글자다.
     이 자리에서 1억 미만의 차이는 어차피 눈으로 못 잰다 */
  if (v >= 9_995_000_000) return `${Math.round(v / 100_000_000)}억`;
  if (v >= 99_950_000) return `${(v / 100_000_000).toFixed(1)}억`;
  /* 만 단위에는 쉼표를 안 넣는다. '1,235만' 은 여섯 글자라 다시 잘린다 —
     쉼표 하나에 칸 하나를 쓰는 셈인데, 여기서 얻는 것이 없다 */
  if (v >= 9_995) return `${Math.round(v / 10_000)}만`;
  if (v >= 995) return `${Math.round(v / 1_000)}천`;
  return `${Math.round(v)}`;
}
