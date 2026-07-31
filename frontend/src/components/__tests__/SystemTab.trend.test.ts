/**
 * 관리자 화면의 메모리 추이 — '보이는 것'이 사실과 어긋나지 않게.
 *
 * 실제로 띄워보니 두 가지가 틀렸다. 240→246MB 라는 잔물결이 바닥에서
 * 천장까지 치솟은 그래프로 보였고, 표본 두 개짜리 8분 기울기를 두고
 * "누수를 의심할 만합니다"라고 단언했다. 둘 다 '숫자는 맞지만 읽는 사람이
 * 틀린 결론을 내리는' 종류라, 계산을 떼어내 여기서 못 박는다.
 */
import { describe, it, expect } from "vitest";
import { 추이막대높이, 추이_판단_최소_분 } from "../admin/SystemTab";

describe("메모리 추이 막대 높이", () => {
  it("작은 흔들림은 작게 보인다", () => {
    /* 246MB 중 6MB 차이. 눈금을 min~max 에 맞추면 0%→100% 가 되어
       '두 배로 뛴' 것처럼 읽힌다 */
    const lo = 추이막대높이(240.2, 240.2, 246.3);
    const hi = 추이막대높이(246.3, 240.2, 246.3);
    expect(hi).toBeCloseTo(100);   // 부동소수라 정확히 100 은 아니다
    expect(lo).toBeGreaterThan(40);   // 바닥에 붙지 않는다
    expect(hi - lo).toBeLessThan(60);
  });

  it("큰 변화는 큰 폭으로 보인다", () => {
    /* 하한이 실제 변화를 눌러 평평하게 만들어서도 안 된다 */
    const lo = 추이막대높이(100, 100, 400);
    expect(lo).toBeLessThan(15);
    expect(추이막대높이(400, 100, 400)).toBeCloseTo(100);
  });

  it("전혀 안 변해도 납작해지지 않는다", () => {
    // min === max — 나누기 0 이 나면 NaN 이 style 에 들어간다
    const h = 추이막대높이(250, 250, 250);
    expect(Number.isFinite(h)).toBe(true);
    expect(h).toBe(100);
  });

  it("항상 0~100 안에 있다", () => {
    for (const [v, lo, hi] of [[0, 0, 0], [1, 1, 1000], [999, 0, 1000], [5, 5, 6]] as const) {
      const h = 추이막대높이(v, lo, hi);
      expect(h).toBeGreaterThanOrEqual(8);
      expect(h).toBeLessThanOrEqual(100);
    }
  });
});

describe("기울기를 믿어도 되는 시점", () => {
  it("재시작 직후의 상승을 누수라고 부르지 않을 만큼은 기다린다", () => {
    /* 서버가 뜬 뒤 캐시가 차는 동안 RSS 는 원래 오른다.
       이 값이 짧아지면 재배포할 때마다 빨간 경고가 뜬다 */
    expect(추이_판단_최소_분).toBeGreaterThanOrEqual(30);
    // 5분 간격 표본이므로 최소 6개는 모여야 한다는 뜻
    expect(추이_판단_최소_분 / 5).toBeGreaterThanOrEqual(6);
  });
});
