/**
 * 조회가 실패했을 때 사용자에게 알린다.
 *
 * useQuery 가 102개인데 isError 를 다루는 곳이 31개뿐이었다. 나머지
 * 70%는 실패해도 화면에 아무 표시가 없다 — 빈 목록이거나 영원한
 * 로딩으로 보인다. 사용자는 "느리다" 고 느끼지 "실패했다" 고 알지
 * 못하고, 그래서 새로고침도 안 해 보고 그냥 나간다.
 *
 * 100곳을 하나씩 고치는 대신 QueryCache.onError 한 자리에 뒀다.
 * 새로 만드는 화면도 저절로 포함된다.
 *
 * 여기서 못 박는 것 —
 *   · 사람이 읽는 문장인가 (예외 이름이나 상태 코드가 새지 않는가)
 *   · 알릴 필요 없는 실패에 조용한가 (401·404)
 *   · 한꺼번에 실패해도 알림이 하나인가
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { 사람말로, 조회실패알림, 오류구독, _비우기 } from "../queryError";

beforeEach(() => _비우기());

const 응답 = (status: number) => ({ response: { status } });

describe("사람이 읽는 문장으로", () => {
  it("서버 오류를 알린다", () => {
    expect(사람말로(응답(500))).toContain("서버");
    expect(사람말로(응답(503))).toContain("서버");
  });

  it("너무 잦은 요청을 알린다", () => {
    expect(사람말로(응답(429))).toContain("잦");
  });

  it("응답이 없으면 연결 문제로 말한다", () => {
    expect(사람말로({ message: "Network Error" })).toContain("연결");
  });

  it("시간 초과를 따로 말한다", () => {
    /* Render 무료 플랜은 자다 깨는 데 20~45초가 걸린다.
       '연결 실패' 와 '늦다' 는 사용자가 할 일이 다르다 */
    expect(사람말로({ code: "ECONNABORTED" })).toContain("늦");
    expect(사람말로({ message: "timeout of 5000ms exceeded" })).toContain("늦");
  });

  it("어느 갈래로 가든 사람이 읽는 문장이다", () => {
    /* 400 처럼 위 갈래에 안 걸리는 것도 있다. 마지막 갈래를 안 태우면
       거기로 예외 메시지를 그대로 내보내도 안 걸린다
       (뮤테이션에서 실제로 그렇게 빠져나갔다) */
    const 글 = 사람말로({ response: { status: 400 }, message: "Request failed with status code 400" });
    expect(글).toBe("불러오지 못했습니다");
  });

  it("예외 이름이나 상태 코드가 그대로 새지 않는다", () => {
    /* 지난번 보유비중에서 지적받은 그대로다 — 사용자에게는 뜻이 없는
       글자이고 서버 안쪽 사정만 드러난다 */
    const 것들 = [응답(500), 응답(429), { message: "Network Error" },
                  { code: "ECONNABORTED" }, {},
                  { response: { status: 400 }, message: "Request failed with status code 400" },
                  { response: { status: 418 }, message: "I'm a teapot" }];
    for (const e of 것들) {
      const 글 = 사람말로(e);
      expect(글).not.toMatch(/Error|Exception|\b[45]\d\d\b|axios|ECONN/i);
    }
  });
});

describe("알릴 필요 없는 실패에는 조용하다", () => {
  it("401·403 은 알리지 않는다", () => {
    /* 로그인이 필요한 자리는 화면이 알아서 로그인으로 보낸다.
       여기서 또 알리면 두 번 말하는 셈이다 */
    expect(사람말로(응답(401))).toBe("");
    expect(사람말로(응답(403))).toBe("");
  });

  it("404 는 알리지 않는다", () => {
    /* 없는 것을 물은 경우다. 화면이 빈 상태로 그리는 것이 맞다 */
    expect(사람말로(응답(404))).toBe("");
  });

  it("조용한 실패는 알림이 안 나간다", () => {
    const 받음: string[] = [];
    오류구독((m) => 받음.push(m));
    조회실패알림(응답(401));
    조회실패알림(응답(404));
    expect(받음).toEqual([]);
  });
});

describe("한꺼번에 실패해도 알림은 하나", () => {
  it("같은 실패를 잇달아 받으면 한 번만 알린다", () => {
    /* 서버가 자고 있으면 화면 하나가 대여섯 개를 한꺼번에 실패시킨다.
       그때마다 알림이 뜨면 화면이 알림으로 덮인다 */
    const 받음: string[] = [];
    오류구독((m) => 받음.push(m));
    for (let i = 0; i < 6; i++) 조회실패알림(응답(500));
    expect(받음).toHaveLength(1);
  });

  it("다른 종류의 실패는 따로 알린다", () => {
    const 받음: string[] = [];
    오류구독((m) => 받음.push(m));
    조회실패알림(응답(500));
    조회실패알림(응답(429));
    expect(받음).toHaveLength(2);
  });

  it("시간이 지나면 다시 알린다", () => {
    vi.useFakeTimers();
    try {
      const 받음: string[] = [];
      오류구독((m) => 받음.push(m));
      조회실패알림(응답(500));
      vi.advanceTimersByTime(5000);
      조회실패알림(응답(500));
      expect(받음).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("듣는 쪽", () => {
  it("구독을 끊으면 더 안 받는다", () => {
    const 받음: string[] = [];
    const 끊기 = 오류구독((m) => 받음.push(m));
    끊기();
    조회실패알림(응답(500));
    expect(받음).toEqual([]);
  });
});


describe("앱 전체에 실제로 걸려 있는가", () => {
  it("조회가 실패하면 알림이 나간다", async () => {
    /* 여기까지 봐야 의미가 있다. queryError 만 검사하면 queryClient 에
       연결하는 줄을 지워도 통과한다(뮤테이션에서 그렇게 빠져나갔다). */
    const { queryClient } = await import("../queryClient");
    const 받음: string[] = [];
    오류구독((m) => 받음.push(m));

    await queryClient
      .fetchQuery({
        queryKey: ["검사용-실패", Math.random()],
        queryFn: () => Promise.reject({ response: { status: 500 } }),
        retry: false,
      })
      .catch(() => {});

    expect(받음).toEqual(["서버에 문제가 있어 불러오지 못했습니다"]);
  });
});
