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
import type { 자산배분결과 } from "@/api/stocks";
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
