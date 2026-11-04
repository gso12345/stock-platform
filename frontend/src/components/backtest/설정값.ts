/**
 * 백테스트 세 탭이 같이 쓰는 값 — 기간 칩·금액 칩과 그 계산.
 *
 * 자산배분 설정(AllocationForm)에만 있던 것을 단일 종목·유니버스 탭도 쓰게 되어 따로 뺐다(사용자가 고른 6·8번:
 * 단일 종목도 오늘에서 거슬러 잰 기간 칩, '1,000만원' 처럼 읽는 금액). 화면 부품(설정부품)과 자산배분 설정이
 * 서로를 부르지 않게 값만 여기 둔다. 예전 이름으로 부르는 곳을 위해 AllocationForm 이 그대로 다시 내보낸다.
 */

/** 기간 빠른 선택. 버튼 하나로 날짜 두 개가 채워진다. */
export const 빠른기간 = [1, 3, 5, 10, 20, 30];

/** 금액을 사람이 읽는 말로. 사진의 '1만 달러' 자리.
 *
 *  0 이 몇 개인지 세게 하면 안 된다. 10000000 과 100000000 은 눈으로
 *  가르기 어렵고, 한 자리 틀리면 결과가 열 배로 달라진다. */
export function 읽는금액(v: number, 통화: "KRW" | "USD"): string {
  if (!v || !Number.isFinite(v)) return "";
  if (통화 === "USD") {
    if (v >= 1e8) return `${+(v / 1e8).toFixed(1)}억 달러`;
    if (v >= 1e4) return `${+(v / 1e4).toFixed(v % 1e4 ? 1 : 0)}만 달러`;
    if (v >= 1e3) return `${+(v / 1e3).toFixed(v % 1e3 ? 1 : 0)}천 달러`;
    return `${v.toLocaleString("ko-KR")} 달러`;
  }
  if (v >= 1e12) return `${+(v / 1e12).toFixed(1)}조원`;
  if (v >= 1e8) return `${+(v / 1e8).toFixed(v % 1e8 ? 1 : 0)}억원`;
  if (v >= 1e4) return `${+(v / 1e4).toFixed(v % 1e4 ? 1 : 0)}만원`;
  return `${v.toLocaleString("ko-KR")}원`;
}

/** 금액 빠른 선택. 누르면 그 금액으로 **바로 정해진다**(더하지 않는다).
 *
 *  더하기로 두면 1,000만원을 넣으려고 여러 번 눌러야 하고, 한 번 더
 *  누르면 2,000만원이 되어 되돌리려면 지우고 다시 시작해야 한다.
 *  시험해 볼 금액은 보통 몇 개로 정해져 있으니 한 번에 정하는 편이 낫다.
 *
 *  통화마다 자릿수가 다르다 — 원화에 500달러는 아무 쓸모가 없다. */
export function 금액값들(통화: "KRW" | "USD"): number[] {
  return 통화 === "USD"
    ? [1_000, 5_000, 10_000, 100_000]
    : [1_000_000, 5_000_000, 10_000_000, 100_000_000];
}

/**
 * 햇수를 날짜 두 개로 바꾼다.
 *
 * '오늘' 을 인자로 받는다. 안에서 new Date() 를 부르면 검사가 오늘이
 * 며칠이냐에 따라 흔들린다 — 이 저장소에서 이미 그렇게 깨진 검사를
 * 한 번 고쳤다.
 */
export function 기간에서날짜(년: number, 오늘 = new Date()) {
  const 끝 = new Date(오늘);
  const 시작 = new Date(오늘);
  시작.setFullYear(시작.getFullYear() - 년);
  const 적기 = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start_date: 적기(시작), end_date: 적기(끝) };
}
