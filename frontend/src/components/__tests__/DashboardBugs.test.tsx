/**
 * 사용자가 보낸 것들 중 화면 쪽.
 *
 *  1. "KRX300지수 안나오니까 삭제하고 코드에서도 전체 삭제해줘"
 *     같은 일을 세 번 겪었다 — 코스닥150 이 0 으로 떠 있었고, 그걸 빼고
 *     KRX 300 을 넣었더니 이번엔 KRX 300 이 안 나왔다. 원인은 매번
 *     달랐지만 구조는 하나였다: 화면이 지수 이름을 적어 두고 있으면,
 *     서버가 그 지수를 못 받아도 화면은 자리를 만든다.
 *
 *     그래서 KRX300 을 지우는 데서 멈추지 않고, 화면이 목록을 들고
 *     있지 않게 바꿨다. 서버가 준 것만 그린다.
 *
 *  2. "국내뉴스기사중 이미지 안나오는 거 있어"
 *     주소가 살아 있는지는 받아 보기 전에 알 수 없다.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { 뉴스썸네일 } from "../../pages/Dashboard";

const 뿌리 = path.resolve(__dirname, "../..");
const 백엔드 = path.resolve(__dirname, "../../../../backend");
const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const 화면 = 코드만(fs.readFileSync(path.join(뿌리, "pages/Dashboard.tsx"), "utf-8"));

describe("KRX300 은 어디에도 안 남았다", () => {
  it("화면 어디에도 없다", () => {
    const 파일들 = ["pages/Dashboard.tsx", "pages/IndexDetail.tsx",
                    "components/chart/TradingViewChart.tsx"];
    for (const f of 파일들) {
      expect(fs.readFileSync(path.join(뿌리, f), "utf-8")).not.toContain("KRX300");
    }
  });

  it("서버 어디에도 없다", () => {
    const 파일들 = ["app/api/routes/dashboard.py", "app/services/scheduler.py"];
    for (const f of 파일들) {
      const s = fs.readFileSync(path.join(백엔드, f), "utf-8")
        .replace(/"""[\s\S]*?"""/g, "").replace(/^\s*#.*$/gm, "");
      expect(s).not.toContain("KRX300");
    }
  });
});

describe("화면이 지수 목록을 들고 있지 않다", () => {
  it("지수 이름을 늘어놓은 배열이 없다", () => {
    /* `const KR_INDEX_KEYS = ["KOSPI",...]` 같은 줄이 있으면, 다음에
       후보를 넣을 때 또 같은 일을 겪는다. */
    expect(화면).not.toMatch(/INDEX_KEYS\s*=\s*\[/);
  });

  it("서버가 준 것을 그대로 훑어 그린다 (국내·해외 둘 다)", () => {
    expect(화면).toContain("국내지수.map(");
    expect(화면).toContain("해외지수.map(");
  });

  it("값이 0 이거나 없는 지수는 거른다", () => {
    /* 0 은 '0포인트' 가 아니라 '모른다' 는 뜻이다. 서버가 아직 0 을
       실어 보내는 경로가 남아 있어 화면에서도 한 번 더 막는다. */
    const 거르개 = [...화면.matchAll(/const 쓸모있는지수 = [\s\S]*?;\n/g)];
    expect(거르개.length).toBe(2);
    for (const m of 거르개) {
      expect(m[0]).toContain("r.value > 0");
    }
  });
});

describe("뉴스 썸네일은 자리를 지킨다", () => {
  const 자리크기 = /w-14|h-14/;

  it("주소가 없으면 대체 그림을 같은 크기로 그린다", () => {
    const { container } = render(<뉴스썸네일 />);
    expect(container.querySelector("img")).toBeNull();
    const 칸 = container.firstElementChild as HTMLElement;
    expect(칸.className).toMatch(자리크기);
    expect(칸.querySelector("svg")).not.toBeNull();
  });

  it("주소가 있으면 그림을 그린다", () => {
    const { container } = render(<뉴스썸네일 src="https://img.example.com/a.jpg" />);
    const img = container.querySelector("img")!;
    expect(img).not.toBeNull();
    expect(img.getAttribute("src")).toBe("https://img.example.com/a.jpg");
  });

  it("불러오다 깨지면 자리를 비우지 않고 대체 그림으로 바꾼다", () => {
    /* 여기가 사용자가 본 자리다. 예전에는 display:none 으로 숨겨서
       그 줄만 글자가 왼쪽으로 붙었다. */
    const { container } = render(<뉴스썸네일 src="https://img.example.com/깨진것.jpg" />);
    fireEvent.error(container.querySelector("img")!);

    expect(container.querySelector("img")).toBeNull();
    const 칸 = container.firstElementChild as HTMLElement;
    expect(칸.className).toMatch(자리크기);
    expect(칸.className).not.toMatch(/hidden|display:\s*none/);
    expect(칸.querySelector("svg")).not.toBeNull();
  });

  it("칸 크기가 그림일 때와 대체일 때 같다", () => {
    const { container: 그림 } = render(<뉴스썸네일 src="https://img.example.com/a.jpg" />);
    const { container: 대체 } = render(<뉴스썸네일 />);
    const 크기 = (el: Element) =>
      (el.className as string).split(/\s+/).filter((c) => /^[wh]-/.test(c)).sort().join(" ");
    expect(크기(그림.querySelector("img")!)).toBe(크기(대체.firstElementChild!));
  });

  it("남의 서버에 우리 주소를 알리지 않는다", () => {
    /* 뉴스 이미지는 언론사 서버에서 온다. referrer 를 그대로 보내면
       어떤 사용자가 무슨 기사를 봤는지가 그쪽 로그에 남는다.
       핫링크 차단을 피하는 효과도 같이 있다. */
    const { container } = render(<뉴스썸네일 src="https://img.example.com/a.jpg" />);
    expect(container.querySelector("img")!.getAttribute("referrerpolicy"))
      .toBe("no-referrer");
  });

  it("보이지도 않는 그림을 미리 받지 않는다", () => {
    const { container } = render(<뉴스썸네일 src="https://img.example.com/a.jpg" />);
    expect(container.querySelector("img")!.getAttribute("loading")).toBe("lazy");
  });

  it("그림이 오기 전에도 줄이 밀리지 않게 크기를 적어 둔다", () => {
    /* width/height 가 없으면 그림이 도착하는 순간 줄 높이가 바뀌어
       읽던 목록이 툭 뛴다. */
    const img = render(<뉴스썸네일 src="https://img.example.com/a.jpg" />)
      .container.querySelector("img")!;
    expect(img.getAttribute("width")).toBe("56");
    expect(img.getAttribute("height")).toBe("56");
  });
});

describe("그림을 못 받은 기사는 목록에서 뺀다", () => {
  /* 서버는 '주소가 있는지' 까지만 볼 수 있다. 그 주소가 실제로 그림을
     주는지는 브라우저가 받아 봐야 안다 — 언론사가 사진을 치우거나
     핫링크를 막으면 주소는 멀쩡한데 그림만 안 온다.

     대체 아이콘을 그려 두는 것으로는 부족했다. 사용자에게는 그것도
     '이미지가 안 나오는 기사' 로 보인다. 그래서 목록에서 뺀다. */
  const 화면코드 = fs.readFileSync(path.join(뿌리, "pages/Dashboard.tsx"), "utf-8");

  it("썸네일이 실패를 위로 알린다", () => {
    expect(화면코드).toContain("onFail");
    expect(화면코드).toMatch(/onError=\{\(\)\s*=>\s*\{\s*set깨짐\(true\);\s*onFail\?\.\(\);/);
  });

  it("목록이 실패한 기사를 걸러 낸다", () => {
    expect(화면코드).toContain("사진없음");
    expect(화면코드).toMatch(/filter\(\(a: any\) => a\?\.image && !사진없음\.has/);
  });

  it("실패 알림이 실제로 걸려 있다", () => {
    expect(화면코드).toMatch(/onFail=\{\(\) => 사진깨짐\(/);
  });

  it("걸러 낸 뒤 비면 빈 상태를 보여 준다", () => {
    /* `!news?.length` 로 보면, 기사는 왔는데 사진이 전부 깨진 경우
       빈 목록만 덩그러니 남는다 */
    expect(화면코드).toContain("if (!sorted.length)");
  });
});

describe("뉴스는 사진 있는 기사만", () => {
  it("서버가 사진 없는 기사를 채워 넣지 않는다", () => {
    /* 한때 '100건에 모자라면 사진 없는 기사를 뒤에 붙인다' 로 바꿔 본
       적이 있다. 부탁을 고쳐 읽은 것이었고, 그래서 "이미지 안 나오는
       기사가 있다" 는 말을 다시 들었다. */
    const 백엔드 = path.resolve(__dirname, "../../../../backend");
    const 서버 = fs.readFileSync(
      path.join(백엔드, "app/api/routes/dashboard.py"), "utf-8")
      .replace(/"""[\s\S]*?"""/g, "").replace(/^\s*#.*$/gm, "");
    expect(서버).not.toContain("모자란수");
    expect(서버).toMatch(/있는것 = \[a for a in articles if a\.get\("image"\)\]/);
  });
});
