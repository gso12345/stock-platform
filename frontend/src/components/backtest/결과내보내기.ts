/**
 * 자산배분 결과를 CSV 줄로.
 *
 * 화면의 숫자를 **그대로** 옮긴다 — 여기서 다시 계산하지 않는다.
 * 두 군데서 계산하면 반드시 어긋나고, 엑셀로 옮긴 숫자가 화면과 다르면
 * 어느 쪽을 믿어야 할지 알 수 없다.
 *
 * 평가액 곡선은 **그래프용으로 솎은 점**이다(서버가 꼭대기·바닥·끝을
 * 남기고 줄인다). 날마다 값인 줄 알고 쓰면 안 되므로 제목에 적어 둔다.
 */
import type { 자산배분결과, 단일결과 } from "@/api/stocks";
import type { CSV칸 } from "@/utils/csv";

export function 결과CSV(r: 자산배분결과): CSV칸[][] {
  const b = r.benchmark;
  const 줄들: CSV칸[][] = [];
  const 빈줄 = () => 줄들.push([]);

  줄들.push(["[요약]", "내 조합", b ? b.name : null]);
  const 요약: [string, CSV칸, CSV칸?][] = [
    ["기간", `${r.start_date} ~ ${r.end_date}`],
    ["통화", r.currency],
    ["총 납입금", r.contributed, b?.contributed],
    ["최종 평가액", r.final_value, b?.final_value],
    ["총 수익률(%)", r.total_return, b?.total_return],
    ["연 수익률 TWR(%)", r.twr_annual, b?.twr_annual],
    ["연 수익률 IRR(%)", r.irr_annual, b?.irr_annual],
    ["최대 낙폭(%)", r.mdd == null ? null : -r.mdd, b?.mdd == null ? null : -b.mdd],
    ["변동성(%)", r.volatility, b?.volatility],
    ["샤프", r.sharpe, b?.sharpe],
    ["소티노", r.sortino, b?.sortino],
    ["배당 합", r.dividends],
    ["수수료 합", r.costs],
  ];
  for (const [이름, 내것, 벤치] of 요약) 줄들.push(b ? [이름, 내것, 벤치] : [이름, 내것]);

  빈줄();
  줄들.push(["[자산]", "시장", "비중(%)"]);
  //: 화면(자산 칸)과 같은 규칙 — 합에서 차지하는 몫
  const 합 = r.assets.reduce((s, a) => s + (Number(a.weight) || 0), 0);
  for (const a of r.assets) {
    줄들.push([a.name || a.symbol, a.market,
              합 > 0 ? Math.round((Number(a.weight) || 0) / 합 * 10000) / 100 : null]);
  }

  빈줄();
  줄들.push(b ? ["[해마다 수익률(%)]", "내 조합", b.name] : ["[해마다 수익률(%)]", "내 조합"]);
  const 벤치해 = new Map((b?.yearly ?? []).map((y) => [y.year, y.return]));
  for (const y of r.yearly) 줄들.push(b ? [y.year, y.return, 벤치해.get(y.year)] : [y.year, y.return]);

  빈줄();
  줄들.push(["[달마다 수익률(%)]", "내 조합"]);
  for (const m of r.monthly) 줄들.push([m.month, m.return]);

  빈줄();
  줄들.push(b ? ["[평가액 — 그래프용으로 솎은 점]", "내 조합", b.name]
              : ["[평가액 — 그래프용으로 솎은 점]", "내 조합"]);
  const 벤치값 = new Map((b?.curve ?? []).map((x) => [x.date, x.value]));
  for (const x of r.curve) 줄들.push(b ? [x.date, x.value, 벤치값.get(x.date)] : [x.date, x.value]);

  return 줄들;
}

/** 단일 종목 결과를 CSV 줄로 — 요약·해마다·달마다·거래·평가액(사용자: "백테스팅 결과를 더 상세분석할 수 있도록").
 *  자산배분과 같은 규칙 — 화면의 숫자를 그대로 옮기고 여기서 다시 계산하지 않는다. 평가액은 날마다 값이다
 *  (단일 종목은 서버가 솎지 않는다). */
export function 단일결과CSV(r: 단일결과, 이름: string): CSV칸[][] {
  const bh = r.buy_and_hold;
  const 줄들: CSV칸[][] = [];
  const 빈줄 = () => 줄들.push([]);
  줄들.push(["[요약]", 이름, bh ? "그냥 들고 있기" : null]);
  const 요약: [string, CSV칸, CSV칸?][] = [
    ["기간", `${r.start_date ?? ""} ~ ${r.end_date ?? ""}`],
    ["총 수익률(%)", r.total_return, bh?.total_return],
    ["연환산(%)", r.annual_return, bh?.annual_return],
    ["최대 낙폭(%)", r.mdd == null ? null : -r.mdd, bh?.mdd == null ? null : -bh.mdd],
    ["샤프", r.sharpe_ratio, bh?.sharpe_ratio],
    ["승률(%)", r.win_rate],
    ["거래 수", r.total_trades],
    ["평균 수익(%)", r.avg_profit],
    ["평균 손실(%)", r.avg_loss],
    ["수익비율(PF)", r.profit_factor],
    ["수수료 합", r.costs],
  ];
  for (const [n, 내것, 저것] of 요약) 줄들.push(bh ? [n, 내것, 저것] : [n, 내것]);

  const a = r.analysis;
  if (a?.yearly?.length) {
    빈줄();
    const 들고해 = new Map((a.buy_and_hold?.yearly ?? []).map((y) => [y.year, y.return]));
    줄들.push(a.buy_and_hold ? ["[해마다 수익률(%)]", 이름, "그냥 들고 있기"] : ["[해마다 수익률(%)]", 이름]);
    for (const y of a.yearly) 줄들.push(a.buy_and_hold ? [y.year, y.return, 들고해.get(y.year)] : [y.year, y.return]);
  }
  if (a?.monthly?.length) {
    빈줄();
    줄들.push(["[달마다 수익률(%)]", 이름]);
    for (const m of a.monthly) 줄들.push([m.month, m.return]);
  }

  빈줄();
  줄들.push(["[거래]", "진입일", "청산일", "진입가", "청산가", "수익률(%)", "수수료 뺀 것(%)", "수량"]);
  for (const t of r.trades ?? []) {
    줄들.push([t.type, t.entry_date, t.exit_date, t.entry_price, t.exit_price, t.pnl_rate, t.net_pnl_rate ?? t.pnl_rate, t.shares]);
  }

  빈줄();
  줄들.push(bh?.curve ? ["[평가액]", 이름, "그냥 들고 있기"] : ["[평가액]", 이름]);
  (r.equity_curve ?? []).forEach((x, i) => 줄들.push(bh?.curve ? [x.date, x.value, bh.curve[i]] : [x.date, x.value]));
  return 줄들;
}
