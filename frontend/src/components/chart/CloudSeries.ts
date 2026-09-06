/**
 * 두 선 사이를 메우는 시리즈 — 일목균형표의 구름.
 *
 * ── 왜 따로 만들어야 하나 ──
 *
 * lightweight-charts 에는 두 선 사이를 칠하는 기능이 없다. 흔히 쓰는
 * 편법이 둘 있는데 둘 다 이 화면에서는 못 쓴다.
 *
 *   ① 영역 시리즈 두 개를 겹친다 — 위쪽을 색으로, 아래쪽을 배경색으로
 *      덮어 '지우는' 방식. 배경색이 캔들까지 지운다. 구름 아래에 있는
 *      봉이 통째로 사라진다.
 *   ② 캔버스를 하나 더 얹고 좌표를 손으로 맞춘다. 확대·이동·창 크기가
 *      바뀔 때마다 어긋난다. 지지선 위치가 틀리면 안 그리느니만 못하다.
 *
 * v4.1 부터 addCustomSeries 가 생겼다. 차트가 자기 좌표계로 불러 주므로
 * 어긋날 자리가 없다. 이게 제대로 된 길이다.
 *
 * ── 색이 갈리는 이유 ──
 *
 * 선행A가 위면 양운(상승), 아래면 음운(하락)이다. 구름을 보는 이유의
 * 절반이 그 뒤집힘이라, 한 색으로 칠하면 볼 뜻이 없어진다. 뒤집히는
 * 지점은 두 선이 만나는 자리이므로, 봉과 봉 사이에서 정확히 교차점을
 * 구해 그 자리에서 색을 바꾼다 — 봉 단위로 끊으면 계단이 생긴다.
 */
import type {
  ICustomSeriesPaneView, ICustomSeriesPaneRenderer, PaneRendererCustomData,
  CustomData, CustomSeriesOptions, CustomSeriesPricePlotValues, Time,
  PriceToCoordinateConverter,
} from "lightweight-charts";

import { customSeriesDefaultOptions } from "lightweight-charts";

/** 캔버스 한 판. lightweight-charts 가 넘겨 주는 것인데 이름을
 *  내보내지 않아서, 쓰는 만큼만 여기 적어 둔다 */
interface 그릴판 {
  context: CanvasRenderingContext2D;
  horizontalPixelRatio: number;
  verticalPixelRatio: number;
}

/** 구름 한 칸 — 그날의 선행스팬 A·B */
export interface 구름점 extends CustomData<Time> {
  a: number;
  b: number;
}

export interface 구름설정 extends CustomSeriesOptions {
  /** 선행A가 위일 때(양운) */
  위색: string;
  /** 선행A가 아래일 때(음운) */
  아래색: string;
}

export const 구름_기본설정: 구름설정 = {
  ...customSeriesDefaultOptions,
  위색: "rgba(16,185,129,0.16)",
  아래색: "rgba(239,68,68,0.16)",
} as 구름설정;

/**
 * 두 점 사이에서 A와 B가 만나는 자리.
 *
 * 봉 단위로 색을 끊으면 뒤집히는 지점에 계단이 생긴다. 구름을 보는
 * 이유의 절반이 그 뒤집힘이라, 거기가 뭉개지면 안 그리느니만 못하다.
 *
 * 돌려주는 값은 0~1 사이의 비율이다 — 앞 점에서 뒤 점까지 중 어디쯤인가.
 * 두 구간의 차이가 같은 부호면(교차가 없으면) null.
 */
export function 교차비율(
  앞A: number, 앞B: number, 뒤A: number, 뒤B: number,
): number | null {
  const 앞차 = 앞A - 앞B;
  const 뒤차 = 뒤A - 뒤B;
  if (앞차 === 0) return null;                  // 이미 만나 있다
  /* 안 뒤집히는 경우를 따로 안 막는다. 부호가 같으면 비율이 0~1 밖으로
     나가고(같은 값이면 0으로 나눠 Infinity), NaN 도 마찬가지로 아래
     범위 검사에서 걸린다. 가지를 하나 더 두면 그 줄만 영영 안 밟히는
     죽은 코드가 된다 — 뮤테이션으로 확인했다. */
  const 비율 = 앞차 / (앞차 - 뒤차);
  return 비율 > 0 && 비율 < 1 ? 비율 : null;
}

class 구름그리개 implements ICustomSeriesPaneRenderer {
  private _자료: PaneRendererCustomData<Time, 구름점> | null = null;
  private _설정: 구름설정 | null = null;

  받기(자료: PaneRendererCustomData<Time, 구름점>, 설정: 구름설정) {
    this._자료 = 자료;
    this._설정 = 설정;
  }

  draw(대상: { useBitmapCoordinateSpace: (f: (s: 그릴판) => void) => void },
       가격을y: PriceToCoordinateConverter) {
    대상.useBitmapCoordinateSpace((칸) => this._그리기(칸, 가격을y));
  }

  private _그리기(칸: 그릴판, 가격을y: PriceToCoordinateConverter) {
    const 자료 = this._자료, 설정 = this._설정;
    if (!자료 || !설정 || 자료.bars.length < 2) return;

    const ctx = 칸.context;
    const 가로 = 칸.horizontalPixelRatio;
    const 세로 = 칸.verticalPixelRatio;

    /** 화면 좌표로 바꾼 점들. 값이 없는 칸은 건너뛴다 —
     *  0 으로 채우면 구름이 바닥까지 늘어진다 */
    const 점들: { x: number; ya: number; yb: number }[] = [];
    for (const bar of 자료.bars) {
      const d = bar.originalData;
      if (d == null || !Number.isFinite(d.a) || !Number.isFinite(d.b)) continue;
      /* 화면 밖의 값은 좌표가 없다(null). 0 으로 치면 구름이 맨 위에
         붙어 그려지므로 그 칸은 통째로 건너뛴다 */
      const ya = 가격을y(d.a), yb = 가격을y(d.b);
      if (ya == null || yb == null) continue;
      점들.push({ x: bar.x * 가로, ya: ya * 세로, yb: yb * 세로 });
    }
    if (점들.length < 2) return;

    /* 색이 같은 구간끼리 묶어 한 번에 칠한다. 칸마다 따로 칠하면
       칸 사이에 실낱같은 틈이 보인다 */
    let 시작 = 0;
    for (let i = 1; i <= 점들.length; i++) {
      const 끝인가 = i === 점들.length;
      const 앞 = 점들[i - 1];
      const 지금 = 끝인가 ? null : 점들[i];
      /* y 는 아래로 갈수록 커진다. ya < yb 면 A가 **위**다 */
      const 앞위 = 앞.ya <= 앞.yb;
      const 지금위 = 지금 ? 지금.ya <= 지금.yb : 앞위;

      if (!끝인가 && 앞위 === 지금위) continue;

      /* 뒤집히면 교차점까지만 칠하고 거기서 색을 바꾼다 */
      let 마디: { x: number; ya: number; yb: number }[] = 점들.slice(시작, i);
      let 다음시작점: { x: number; ya: number; yb: number } | null = null;
      if (!끝인가 && 지금) {
        const 비율 = 교차비율(-앞.ya, -앞.yb, -지금.ya, -지금.yb);
        if (비율 != null) {
          const 사이 = (a: number, b: number) => a + (b - a) * 비율;
          const 만난곳 = {
            x: 사이(앞.x, 지금.x),
            ya: 사이(앞.ya, 지금.ya),
            yb: 사이(앞.yb, 지금.yb),
          };
          마디 = [...마디, 만난곳];
          다음시작점 = 만난곳;
        }
      }

      if (마디.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(마디[0].x, 마디[0].ya);
        for (let k = 1; k < 마디.length; k++) ctx.lineTo(마디[k].x, 마디[k].ya);
        for (let k = 마디.length - 1; k >= 0; k--) ctx.lineTo(마디[k].x, 마디[k].yb);
        ctx.closePath();
        ctx.fillStyle = 앞위 ? 설정.위색 : 설정.아래색;
        ctx.fill();
      }

      시작 = i;
      if (다음시작점) 점들.splice(i, 0, 다음시작점);
    }
  }
}

/** 일목균형표 구름 — chart.addCustomSeries 에 넘긴다 */
export class 구름시리즈 implements ICustomSeriesPaneView<Time, 구름점, 구름설정> {
  private _그리개 = new 구름그리개();

  priceValueBuilder(칸: 구름점): CustomSeriesPricePlotValues {
    /* 세로 범위를 잡을 때 이 값들을 본다. 구름이 화면 밖으로
       밀려나지 않게 위·아래를 다 알려 준다 */
    return [칸.b, 칸.a];
  }

  isWhitespace(칸: 구름점 | { time: Time }): 칸 is { time: Time } {
    const d = 칸 as 구름점;
    return !Number.isFinite(d.a) || !Number.isFinite(d.b);
  }

  renderer(): ICustomSeriesPaneRenderer {
    return this._그리개 as unknown as ICustomSeriesPaneRenderer;
  }

  update(자료: PaneRendererCustomData<Time, 구름점>, 설정: 구름설정): void {
    this._그리개.받기(자료, 설정);
  }

  defaultOptions(): 구름설정 {
    return 구름_기본설정;
  }
}
