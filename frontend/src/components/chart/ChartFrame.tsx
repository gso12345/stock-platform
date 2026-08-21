/**
 * 막대그래프 자리 — recharts 를 필요할 때만 받아 온다.
 *
 * 종목 상세를 열면 recharts(gzip 108KB)가 늘 딸려 왔다. 그런데 이 라이브러리를
 * 쓰는 곳은 재무제표·투자의견·수급 탭뿐이고, 기본으로 열리는 차트 탭은
 * 전혀 다른 라이브러리(lightweight-charts)를 쓴다. 즉 가격 차트만 보고
 * 나가는 사람도 108KB 를 받고 있었다 — 그 화면 전체가 190KB 인데 그중
 * 절반이 안 쓰는 것이었다.
 *
 * 같은 교훈이 이미 코드에 있다. Feed 가 PortfolioSnapshot 을 lazy 로 받으며
 * 남긴 주석 — "이걸 정적으로 걸어 두면 recharts 가 피드 청크에 딸려 온다".
 * 종목 상세에는 그 처리를 안 했다.
 *
 * 왜 이런 모양인가
 *   그래프마다 축·눈금·막대 구성이 제각각이라(열두 개가 다 다르다) 하나의
 *   부품으로 묶으면 옮기다 흘리기 쉽다. 그래서 JSX 는 그대로 두고,
 *   recharts 를 함수 인자로 넘겨 준다. 부르는 쪽은 태그 앞에 R. 만 붙는다.
 *
 *       <차트틀 height={200}>
 *         {(R) => (
 *           <R.BarChart data={...}>
 *             <R.XAxis .../>
 *           </R.BarChart>
 *         )}
 *       </차트틀>
 *
 * 받아 오는 동안에는 같은 높이의 빈 자리를 둔다. 안 그러면 그래프가 뜰 때
 * 아래 내용이 밀려 내려가면서 읽던 자리를 잃는다.
 */
import { useEffect, useState, type ReactElement } from "react";

type Recharts = typeof import("recharts");

/** 한 번 받아 두면 다음 그래프부터는 기다림이 없다 */
let 받아둔것: Recharts | null = null;
let 받는중: Promise<Recharts> | null = null;

function 받기(): Promise<Recharts> {
  if (!받는중) 받는중 = import("recharts").then((m) => (받아둔것 = m));
  return 받는중;
}

export default function 차트틀({
  height, children,
}: {
  height: number;
  children: (R: Recharts) => ReactElement;
}) {
  const [R, setR] = useState<Recharts | null>(받아둔것);

  useEffect(() => {
    if (R) return;
    let 살아있음 = true;
    받기().then((m) => { if (살아있음) setR(m); }).catch(() => {});
    return () => { 살아있음 = false; };
  }, [R]);

  if (!R) {
    return (
      <div
        style={{ height }}
        className="w-full rounded-lg bg-bg-elevated animate-pulse"
        aria-label="그래프 불러오는 중"
      />
    );
  }
  return (
    <R.ResponsiveContainer width="100%" height={height}>
      {children(R)}
    </R.ResponsiveContainer>
  );
}
