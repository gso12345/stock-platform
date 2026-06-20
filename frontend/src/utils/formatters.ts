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
