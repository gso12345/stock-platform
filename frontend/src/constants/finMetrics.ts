/**
 * 재무제표 탭의 '내가 고른 지표' 목록과 그 저장 열쇠.
 *
 * 종목 상세를 탭별로 나누면서, 재무제표 탭과 남은 본문이 둘 다 이 목록을
 * 본다(본문은 저장·복원, 탭은 고르는 창). 한쪽에 두면 다른 쪽이 그 파일을
 * 통째로 끌어오게 되므로 따로 뺀다. 옮기기만 했고 안은 그대로다.
 */
export const FIN_CUSTOM_OPTS = [
  // 손익계산서
  { key: "revenue",           label: "매출",           group: "손익계산서",   fmt: "fin",    color: "#3b82f6" },
  { key: "op_income",         label: "영업이익",       group: "손익계산서",   fmt: "fin",    color: "#10b981" },
  { key: "net_income",        label: "당기순이익",     group: "손익계산서",   fmt: "fin",    color: "#8b5cf6" },
  { key: "eps",               label: "EPS",            group: "손익계산서",   fmt: "epsbps", color: "#22d3ee" },
  { key: "revenue_growth",    label: "매출성장률",     group: "손익계산서",   fmt: "pct",    color: "#60a5fa" },
  { key: "op_income_growth",  label: "영업이익성장률", group: "손익계산서",   fmt: "pct",    color: "#34d399" },
  { key: "net_income_growth", label: "순이익성장률",   group: "손익계산서",   fmt: "pct",    color: "#a78bfa" },
  // 마진
  { key: "gross_margin",      label: "총이익률",       group: "마진",         fmt: "pct",    color: "#94a3b8" },
  { key: "op_margin",         label: "영업이익률",     group: "마진",         fmt: "pct",    color: "#10b981" },
  { key: "net_margin",        label: "순이익률",       group: "마진",         fmt: "pct",    color: "#8b5cf6" },
  // 수익성
  { key: "roe",               label: "ROE",            group: "수익성",       fmt: "pct",    color: "#06b6d4" },
  { key: "roa",               label: "ROA",            group: "수익성",       fmt: "pct",    color: "#0ea5e9" },
  /* ROCE 는 뺐다 — 백엔드가 이 값을 만들지 않는다(stocks.py 의 _process 는
     roce 를 계산하지 않는다). 목록에 두면 20칸 중 하나를 골라 놓고 영원히
     '—' 만 보게 된다. 백엔드가 주기 시작하면 그때 되살린다. */
  // 밸류에이션
  { key: "per",               label: "PER",            group: "밸류에이션",   fmt: "x",      color: "#f59e0b" },
  { key: "forward_per",       label: "선행PER",        group: "밸류에이션",   fmt: "x",      color: "#fbbf24" },
  { key: "pbr",               label: "PBR",            group: "밸류에이션",   fmt: "x",      color: "#f97316" },
  { key: "psr",               label: "PSR",            group: "밸류에이션",   fmt: "x",      color: "#eab308" },
  { key: "peg",               label: "PEG",            group: "밸류에이션",   fmt: "x",      color: "#84cc16" },
  { key: "ev_ebitda",         label: "EV/EBITDA",      group: "밸류에이션",   fmt: "x",      color: "#a3e635" },
  // 재무건전성
  { key: "debt_ratio",        label: "부채비율",       group: "재무건전성",   fmt: "pct",    color: "#ef4444" },
  { key: "current_ratio",     label: "유동비율",       group: "재무건전성",   fmt: "ratio_pct", color: "#22c55e" },
  { key: "interest_coverage", label: "이자보상비율",   group: "재무건전성",   fmt: "x",      color: "#16a34a" },
  { key: "net_debt",          label: "순부채",         group: "재무건전성",   fmt: "fin",    color: "#dc2626" },
  { key: "total_assets",      label: "총자산",         group: "재무건전성",   fmt: "fin",    color: "#6b7280" },
  { key: "equity",            label: "자기자본",       group: "재무건전성",   fmt: "fin",    color: "#4b5563" },
  // 현금흐름
  { key: "operating_cf",      label: "영업현금흐름",   group: "현금흐름",     fmt: "fin",    color: "#10b981" },
  { key: "investing_cf",      label: "투자현금흐름",   group: "현금흐름",     fmt: "fin",    color: "#ef4444" },
  { key: "financing_cf",      label: "재무현금흐름",   group: "현금흐름",     fmt: "fin",    color: "#f59e0b" },
  { key: "free_cf",           label: "잉여현금흐름",   group: "현금흐름",     fmt: "fin",    color: "#3b82f6" },
  { key: "capex",             label: "CAPEX",          group: "현금흐름",     fmt: "fin",    color: "#8b5cf6" },
  { key: "da",                label: "감가상각비",     group: "현금흐름",     fmt: "fin",    color: "#64748b" },
] as const;

export const FIN_CUSTOM_KEY = "stkplt_fin_custom_v1";

/** 0 을 '값 없음' 으로 본다.
 *
 *  PER·EPS·BPS 같은 밸류에이션 지표에서 0 은 실제 값이 아니라 "못 구했다" 는
 *  뜻이다. 백엔드가 0.0 을 내려보내는 경로가 있는데(kis_service), `??` 도
 *  `== null` 도 0 을 값으로 치기 때문에 여러 출처를 순서대로 보는 폴백이
 *  첫 칸에서 멈춰 버렸다. 그래서 판정 전에 한 번 걸러 준다.
 *
 *  마진·부채비율·배당수익률처럼 0 이 정말 0 일 수 있는 것에는 쓰지 않는다. */
