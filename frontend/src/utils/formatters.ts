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
