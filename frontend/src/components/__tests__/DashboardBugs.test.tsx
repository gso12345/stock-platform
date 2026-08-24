/**
 * 사용자가 보낸 다섯 가지 중 화면 쪽 둘.
 *
 *  1. "KRX300지수 안나옴"
 *     내가 만든 문제다. 코스닥150 을 걷어내고 KRX300 을 넣으면서
 *     getIdx 가 못 찾은 지수에 `{ value: 0, change: 0 }` 을 채워 주게
 *     뒀다. 그러면 카드가 '0.00' 으로 그려진다. 0 은 '0포인트' 가
 *     아니라 '모른다' 는 뜻인데, 금융 화면에서 모르는 값을 숫자로
 *     채우면 사람은 그걸 믿는다.
 *
 *  2. "국내뉴스기사중 이미지 안나오는 거 있어"
 *     주소가 살아 있는지는 받아 보기 전에 알 수 없다. 언론사가 이미지를
 *     치우거나 핫링크를 막으면 주소는 멀쩡한데 그림만 안 온다. 예전에는
 *     그때 자리를 통째로 지워서(display:none) 그 줄만 글자가 왼쪽으로
 *     붙었다.
 */
import { describe, it, expect } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { 뉴스썸네일 } from "../../pages/Dashboard";

const 뿌리 = path.resolve(__dirname, "../..");
const 코드만 = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const 화면 = 코드만(fs.readFileSync(path.join(뿌리, "pages/Dashboard.tsx"), "utf-8"));

describe("못 받은 지수는 카드를 안 그린다", () => {
  it("getIdx 가 못 찾으면 null 을 준다 (0 으로 채우지 않는다)", () => {
    /* 이 줄이 `?? { value: 0, change: 0, change_rate: 0 }` 이면
       KRX300 카드가 '0.00' 으로 뜬다. 코스닥150 때 똑같이 겪었다. */
    const 뽑기 = [...화면.matchAll(/const getIdx = [\s\S]*?;\n/g)].map((m) => m[0]);
    expect(뽑기.length).toBe(2);          // 국내 탭 · 해외 탭
    for (const s of 뽑기) {
      expect(s).toContain("?? null");
      expect(s).not.toMatch(/value:\s*0/);
    }
  });

  it("두 탭 다 null 이면 카드를 건너뛴다", () => {
    const 건너뜀 = [...화면.matchAll(/if \(!idx\) return null;/g)];
    expect(건너뜀.length).toBe(2);
  });

  it("KRX300 이 목록에 들어 있다", () => {
    expect(화면).toContain("KRX300");
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
