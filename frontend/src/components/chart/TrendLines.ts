/**
 * 추세선 그리기 — 증권사 차트에 있고 여기 없던 것.
 *
 * ── 왜 필요한가 ──
 *
 * 지표는 열여섯 개나 붙어 있는데, 정작 차트 분석의 절반인 '선을 긋는
 * 일' 이 없었다. 고점 두 개를 이어 저항선을 보고, 저점 두 개를 이어
 * 지지선을 보는 것 — MTS 를 켜는 사람이 제일 먼저 하는 일이다.
 * 그걸 못 하면 지표가 아무리 많아도 남이 계산해 준 값을 읽는 데서
 * 끝난다.
 *
 * ── 좌표를 어떻게 잡나 ──
 *
 * 화면 픽셀로 저장하면 확대하거나 옮기는 순간 선이 엉뚱한 데로 간다.
 * **시각과 가격**으로 저장하고, 그릴 때마다 차트에게 좌표를 물어본다.
 * 그러면 확대·이동·창 크기가 바뀌어도 선이 봉에 붙어 있다.
 *
 * 이 파일은 좌표 계산과 담아 두기만 한다 — 그리기는 차트가 붙은 쪽에서
 * 한다. 계산을 떼어 놔야 검사할 수 있다.
 */

/** 추세선 하나. 화면 좌표가 아니라 **시각과 가격**으로 잡는다 */
export interface 추세선 {
  id: string;
  /** 봉의 시각. 문자열("2026-08-20")이나 숫자(유닉스 초) */
  t1: string | number; p1: number;
  t2: string | number; p2: number;
  색: string;
}

const 앞머리 = "차트선:";

/** 종목마다 따로 담는다 — 삼성전자에 그은 선이 애플에 뜨면 안 된다 */
function 열쇠(market: string, symbol: string): string {
  return `${앞머리}${market}:${symbol}`;
}

export function 선들읽기(market: string, symbol: string): 추세선[] {
  try {
    const 담긴것 = localStorage.getItem(열쇠(market, symbol));
    if (!담긴것) return [];
    const 것들 = JSON.parse(담긴것);
    if (!Array.isArray(것들)) return [];
    /* 손상된 칸은 버린다. 하나가 이상하다고 나머지까지 잃을 이유가 없다 */
    return 것들.filter((x): x is 추세선 =>
      !!x && typeof x.id === "string" &&
      Number.isFinite(x.p1) && Number.isFinite(x.p2) &&
      x.t1 != null && x.t2 != null);
  } catch {
    return [];
  }
}

export function 선들쓰기(market: string, symbol: string, 선들: 추세선[]): void {
  try {
    if (선들.length === 0) localStorage.removeItem(열쇠(market, symbol));
    else localStorage.setItem(열쇠(market, symbol), JSON.stringify(선들));
  } catch {
    /* 시크릿 창·용량 초과. 이번 화면에서는 보이고 다음에 안 남을 뿐이다 */
  }
}

/**
 * 점과 선분 사이의 거리(픽셀).
 *
 * 그은 선을 지우려면 그 선을 눌러야 하는데, 손가락이나 마우스가 선
 * 위에 정확히 떨어질 리가 없다. 몇 픽셀 안쪽이면 '그 선을 눌렀다' 로
 * 본다. 그 판정을 하려면 거리가 필요하다.
 *
 * 선분 밖으로 벗어난 자리는 가까운 끝점까지의 거리로 잰다 — 무한
 * 직선으로 재면 선을 그은 구간에서 한참 떨어진 데를 눌러도 잡힌다.
 */
export function 선까지거리(
  x: number, y: number,
  x1: number, y1: number, x2: number, y2: number,
): number {
  const dx = x2 - x1, dy = y2 - y1;
  const 길이제곱 = dx * dx + dy * dy;
  if (길이제곱 === 0) return Math.hypot(x - x1, y - y1);   // 점 하나로 뭉친 선
  let t = ((x - x1) * dx + (y - y1) * dy) / 길이제곱;
  t = Math.max(0, Math.min(1, t));                          // 선분 안으로 가둔다
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/** 이 자리에서 제일 가까운 선. 한계보다 멀면 아무것도 안 고른다 */
export function 고른선<T extends { id: string }>(
  선들: (T & { x1: number; y1: number; x2: number; y2: number })[],
  x: number, y: number, 한계 = 8,
): T | null {
  let 제일가까운: T | null = null;
  let 제일짧은 = Infinity;
  for (const l of 선들) {
    const d = 선까지거리(x, y, l.x1, l.y1, l.x2, l.y2);
    if (d < 제일짧은) { 제일짧은 = d; 제일가까운 = l; }
  }
  return 제일짧은 <= 한계 ? 제일가까운 : null;
}

/** 겹치지 않는 이름. 같은 밀리초에 둘을 그을 수는 없다 */
export function 새id(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}
