/**
 * 내 캘린더에 넣기 — 구글 캘린더 주소, 구독 주소(webcal), iCalendar(.ics) 파일.
 *
 * 공모주 청약일·상장일은 서버가 .ics 를 낸다(api/v1/ipo/calendar.ics) — 캘린더 앱이 그 주소를
 * 구독하면 새 공모주가 저절로 생긴다. 배당은 사람마다 종목이 달라 화면이 .ics 를 직접 만든다
 * (캘린더 앱은 우리 로그인을 들고 오지 못한다).
 */
import { API_BASE } from "@/api/client";

/** 하루 종일 일정 하나. 날짜는 'YYYY-MM-DD', 끝은 그날까지 포함 */
export interface 일정 {
  제목: string;
  시작: string;
  끝?: string;
  설명?: string;
  /** 같은 일정을 다시 받았을 때 새로 생기지 않고 고쳐지게 — 같은 일정은 늘 같은 값 */
  고유: string;
}

const 날8 = (iso: string) => iso.replace(/-/g, "");

/** 'YYYY-MM-DD' 다음 날 — 캘린더의 끝 날짜는 들어가지 않는다(그다음 날을 적는다) */
export function 다음날(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const 날 = new Date(Date.UTC(y, m - 1, d + 1));
  return 날.toISOString().slice(0, 10);
}

/** 구글 캘린더 '일정 추가' 주소 — 눌러서 저장만 하면 된다(구글 계정만 있으면 어디서나) */
export function 구글일정주소(e: Omit<일정, "고유">): string {
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: e.제목,
    dates: `${날8(e.시작)}/${날8(다음날(e.끝 ?? e.시작))}`,
  });
  if (e.설명) q.set("details", e.설명);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** API 경로 → 바깥(캘린더 앱)에서 부를 수 있는 온전한 주소 */
export function 바깥주소(경로: string, 지금주소: string = window.location.origin): string {
  const 바탕 = /^https?:\/\//.test(API_BASE) ? API_BASE : `${지금주소}${API_BASE}`;
  return `${바탕}${경로}`;
}

/** 구독 주소 — 아이폰·맥 캘린더는 webcal:// 을 누르면 '구독' 을 띄운다 */
export function webcal주소(주소: string): string {
  return 주소.replace(/^https?:\/\//, "webcal://");
}

/** 구글 캘린더 '주소로 추가' — 한 번 걸면 구글이 몇 시간마다 다시 받는다 */
export function 구글구독주소(주소: string): string {
  return `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal주소(주소))}`;
}

/** 공모주 캘린더 주소 — 이름을 주면 그 공모주만, 증권사를 주면 그 증권사가 주관하는 것만 */
export function 공모주캘린더주소({ 이름, 증권사 = [] }: { 이름?: string; 증권사?: string[] } = {},
  지금주소?: string): string {
  const q = new URLSearchParams();
  if (이름) q.set("name", 이름);
  if (증권사.length) q.set("brokers", 증권사.join(","));
  const 꼬리 = q.toString();
  return 바깥주소(`/ipo/calendar.ics${꼬리 ? `?${꼬리}` : ""}`, 지금주소);
}

// ── iCalendar 글 ─────────────────────────────────────────────
/** TEXT 값 — 역빗금·쌍반점·쉼표·줄바꿈을 막는다(RFC 5545 3.3.11) */
export function ics글(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

const 바이트 = (자: string) => new TextEncoder().encode(자).length;

/** 한 줄은 75바이트까지(RFC 5545 3.1). 한글은 한 자가 3바이트 — 글자 단위로 세어 자르고,
 *  이어지는 줄은 빈칸 하나로 시작한다(그 몫을 빼고 74바이트) */
export function ics접기(줄: string): string[] {
  const out: string[] = [];
  let 지금 = "";
  let n = 0;
  for (const 자 of 줄) {
    const b = 바이트(자);
    const 한도 = out.length ? 74 : 75;
    if (n + b > 한도) {
      out.push(지금);
      지금 = "";
      n = 0;
    }
    지금 += 자;
    n += b;
  }
  out.push(지금);
  return out.map((x, i) => (i ? ` ${x}` : x));
}

/** 일정들 → .ics 글 한 벌(줄 끝은 CRLF). 알람은 첫날 아침 9시 */
export function ics만들기(일정들: 일정[], 달력이름: string, 지금: Date = new Date()): string {
  const 찍은때 = 지금.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const 줄: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//stock-platform//app//KO", "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH", `X-WR-CALNAME:${ics글(달력이름)}`, "X-WR-TIMEZONE:Asia/Seoul",
  ];
  for (const e of 일정들) {
    줄.push(
      "BEGIN:VEVENT",
      `UID:${e.고유}@stock-platform`,
      `DTSTAMP:${찍은때}`,
      `DTSTART;VALUE=DATE:${날8(e.시작)}`,
      `DTEND;VALUE=DATE:${날8(다음날(e.끝 ?? e.시작))}`,
      `SUMMARY:${ics글(e.제목)}`,
      ...(e.설명 ? [`DESCRIPTION:${ics글(e.설명)}`] : []),
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${ics글(e.제목)}`, "TRIGGER:PT9H", "END:VALARM",
      "END:VEVENT",
    );
  }
  줄.push("END:VCALENDAR");
  return 줄.flatMap(ics접기).join("\r\n") + "\r\n";
}

/** .ics 를 내려받게 한다 — 아이폰·삼성·아웃룩은 파일을 열면 '캘린더에 추가' 가 뜬다 */
export function ics받기(파일이름: string, 글: string): void {
  const 주소 = URL.createObjectURL(new Blob([글], { type: "text/calendar;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = 주소;
  a.download = 파일이름;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(주소), 10_000);
}
