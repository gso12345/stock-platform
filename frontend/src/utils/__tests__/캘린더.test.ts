/**
 * 내 캘린더에 넣기 — 날짜 하루가 밀리거나 글자가 깨지면 캘린더 앱이 말없이 틀리게 넣는다.
 *
 *   · 하루 종일 일정의 끝(DTEND)은 그다음 날이다 — 그날로 적으면 청약 마지막 날이 빠진다
 *   · 한 줄 75바이트 — 한글은 3바이트라 글자 가운데서 자르면 깨진다
 *   · 쉼표·쌍반점은 막아야 한다 — 안 막으면 '26,000원' 이 두 값으로 읽힌다
 */
import { describe, it, expect, vi } from "vitest";
import {
  다음날, 구글일정주소, 바깥주소, webcal주소, 구글구독주소, 공모주캘린더주소, ics글, ics접기, ics만들기, ics받기,
} from "../캘린더";

const 바이트 = (s: string) => new TextEncoder().encode(s).length;
/** 접은 줄을 편다(RFC 5545 — CRLF 뒤 빈칸 하나) */
const 펴기 = (글: string) => 글.replace(/\r\n /g, "");

describe("다음날", () => {
  it("달·해·윤달을 넘긴다", () => {
    expect(다음날("2026-11-03")).toBe("2026-11-04");
    expect(다음날("2026-11-30")).toBe("2026-12-01");
    expect(다음날("2026-12-31")).toBe("2027-01-01");
    expect(다음날("2028-02-28")).toBe("2028-02-29");
  });
});

describe("구글 캘린더 주소", () => {
  it("끝 날짜는 그다음 날로 — 청약 마지막 날이 빠지지 않게", () => {
    const u = new URL(구글일정주소({ 제목: "[청약] 에이비씨", 시작: "2026-11-03", 끝: "2026-11-04", 설명: "공모가 1,000원" }));
    expect(u.origin + u.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(u.searchParams.get("action")).toBe("TEMPLATE");
    expect(u.searchParams.get("dates")).toBe("20261103/20261105");
    expect(u.searchParams.get("text")).toBe("[청약] 에이비씨");
    expect(u.searchParams.get("details")).toBe("공모가 1,000원");
  });

  it("끝이 없으면 하루, 설명이 없으면 안 붙인다", () => {
    const u = new URL(구글일정주소({ 제목: "상장", 시작: "2026-11-12" }));
    expect(u.searchParams.get("dates")).toBe("20261112/20261113");
    expect(u.searchParams.has("details")).toBe(false);
  });
});

describe("구독 주소", () => {
  it("API 주소가 상대 경로면 지금 주소를 붙인다(캘린더 앱은 우리 화면 밖에서 부른다)", () => {
    expect(바깥주소("/ipo/calendar.ics", "https://예시.app")).toBe("https://예시.app/api/v1/ipo/calendar.ics");
  });

  it("아이폰은 webcal, 구글은 cid 에 webcal 주소를 담는다", () => {
    expect(webcal주소("https://a.b/x.ics")).toBe("webcal://a.b/x.ics");
    expect(webcal주소("http://a.b/x.ics")).toBe("webcal://a.b/x.ics");
    // 주소 안의 & 를 막지 않으면 구글 주소의 다른 칸으로 읽혀 증권사가 잘린다
    const u = new URL(구글구독주소("https://a.b/x.ics?name=가&brokers=키움증권"));
    expect(u.searchParams.get("cid")).toBe("webcal://a.b/x.ics?name=가&brokers=키움증권");
    expect(u.searchParams.has("brokers")).toBe(false);
  });

  it("이름·증권사를 주소에 싣는다", () => {
    const 바탕 = "https://예시.app";
    expect(공모주캘린더주소({}, 바탕)).toBe("https://예시.app/api/v1/ipo/calendar.ics");
    const u = new URL(공모주캘린더주소({ 이름: "에이 & 비", 증권사: ["키움증권", "미래에셋증권"] }, 바탕));
    expect(u.searchParams.get("name")).toBe("에이 & 비");
    expect(u.searchParams.get("brokers")).toBe("키움증권,미래에셋증권");
  });
});

describe("iCalendar 글", () => {
  it("쉼표·쌍반점·역빗금·줄바꿈을 막는다", () => {
    expect(ics글("26,000원; a\\b\n둘째 줄\r\n셋째")).toBe("26\\,000원\\; a\\\\b\\n둘째 줄\\n셋째");
  });

  it("한 줄 75바이트 — 이어지는 줄은 빈칸으로 시작하고, 펴면 원래대로", () => {
    const 원래 = "DESCRIPTION:" + "공모주청약일정".repeat(20);
    const 줄들 = ics접기(원래);
    expect(줄들.length).toBeGreaterThan(1);
    for (const [i, l] of 줄들.entries()) {
      expect(바이트(l)).toBeLessThanOrEqual(75);
      if (i) expect(l.startsWith(" ")).toBe(true);
    }
    expect(줄들[0].length).toBeGreaterThan(20);          // 첫 줄을 75바이트 가까이 채운다
    expect(줄들.map((l, i) => (i ? l.slice(1) : l)).join("")).toBe(원래);
  });

  it("75바이트 딱 맞는 줄은 안 접는다", () => {
    const 줄 = "A".repeat(75);
    expect(ics접기(줄)).toEqual([줄]);
    expect(ics접기(줄 + "B")).toEqual([줄, " B"]);
  });

  it("일정 한 벌 — CRLF, 하루 종일, 끝은 다음 날, 알람 아침 9시", () => {
    const 글 = ics만들기([
      { 제목: "[배당 입금] 삼성전자", 시작: "2026-11-20", 설명: "약 36,100원", 고유: "div-KR-005930-2026-11-20-pay" },
      { 제목: "[청약] 에이비씨", 시작: "2026-11-03", 끝: "2026-11-04", 고유: "x" },
    ], "배당 일정", new Date("2026-10-31T01:02:03.456Z"));
    expect(글.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(글.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
    const 펼친 = 펴기(글);
    expect(펼친).toContain("DTSTAMP:20261031T010203Z");
    expect(펼친).toContain("UID:div-KR-005930-2026-11-20-pay@stock-platform");
    expect(펼친).toContain("DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121");
    expect(펼친).toContain("DTSTART;VALUE=DATE:20261103\r\nDTEND;VALUE=DATE:20261105");
    expect(펼친).toContain("DESCRIPTION:약 36\\,100원");
    expect(펼친).toContain("X-WR-CALNAME:배당 일정");
    expect(펼친.match(/TRIGGER:PT9H/g)).toHaveLength(2);
    expect(펼친.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    // 설명이 없는 일정에는 DESCRIPTION 줄이 일정 몫으로 안 생긴다(알람의 DESCRIPTION 만)
    const 둘째 = 펼친.split("BEGIN:VEVENT")[2];
    expect(둘째.match(/DESCRIPTION:/g)).toHaveLength(1);
  });
});

describe("캘린더 파일 받기", () => {
  it("text/calendar 파일을 그 이름으로 받게 하고, 잠시 뒤 주소를 치운다", async () => {
    vi.useFakeTimers();
    let 받은: Blob | null = null;
    const 만들기 = vi.fn((b: Blob) => { 받은 = b; return "blob:fake"; });
    const 치우기 = vi.fn();
    Object.assign(URL, { createObjectURL: 만들기, revokeObjectURL: 치우기 });
    const 누름: { href: string; download: string; 붙음: boolean }[] = [];
    const 원래 = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      누름.push({ href: this.href, download: this.download, 붙음: document.body.contains(this) });
    };
    try {
      ics받기("dividends.ics", "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
      expect(누름).toEqual([{ href: "blob:fake", download: "dividends.ics", 붙음: true }]);
      expect(받은!.type).toBe("text/calendar;charset=utf-8");
      expect(await 받은!.text()).toBe("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
      expect(document.querySelector('a[download="dividends.ics"]')).toBeNull();   // 누른 뒤 치웠다
      expect(치우기).not.toHaveBeenCalled();                                       // 바로 치우면 받기가 끊긴다
      vi.advanceTimersByTime(10_000);
      expect(치우기).toHaveBeenCalledWith("blob:fake");
    } finally {
      HTMLAnchorElement.prototype.click = 원래;
      vi.useRealTimers();
    }
  });
});
