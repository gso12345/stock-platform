import { create } from "zustand";

export type ColorScheme = "green-red" | "red-blue";
/** 글씨 크기.
 *
 *  ── 이름과 실제가 어긋나 있었다 ──
 *
 *  설정 화면의 라벨이 '작게 / 기본 / 크게' 였는데, 값은
 *  normal(14px) / large(16px) / xl(18px) 이었다. 즉 **'작게' 라고
 *  적힌 것이 사실은 기본값**이고, '기본' 을 고르면 14% 커졌다.
 *  이름을 믿고 '기본' 을 고른 사람은 자기도 모르게 키운 셈이다.
 *
 *  라벨을 실제에 맞추고, 진짜로 더 작은 칸(small, 12px)을 새로 둔다.
 *  '작게' 자리가 원래부터 비어 있었다 — 제일 작은 것이 곧 기본값이라
 *  줄일 방법이 아예 없었다. */
export type FontSize = "small" | "normal" | "large" | "xl";
export type Theme = "light" | "dark" | "system";
export type Orientation = "system" | "portrait" | "landscape";

/* 화면 모양(내 자산·종목상세를 '기본' 과 '앱처럼' 가운데 고르던 것)은 없앴다 — 늘 '앱처럼'
 * (큰 가격 → 곧바로 차트 → 그 아래 통계). 사용자: "설정에서 앱처럼을 기본으로 해주고 기본설정은
 * 완전히 없애줘". 예전에 '기본' 을 골라 둔 사람의 저장값(화면모양: "classic")은 읽지 않고, 다음에
 * 설정을 하나라도 바꾸면 저장값에서도 빠진다. */

/** 데이터를 불러올 때 오른쪽 아래 팝업을 띄울까.
 *  보이기  불러오는 과정을 항목별로(기본)
 *  실패만  평소엔 안 띄우고, 못 불러온 것이 있을 때만 — '다시' 를 누를 수 있게
 *  끄기    아예 안 띄운다 */
export type 불러오기표시 = "보이기" | "실패만" | "끄기";
export function 정상불러오기표시(v: unknown): 불러오기표시 {
  return v === "보이기" || v === "끄기" ? v : "실패만";
}

const KEY = "portfolio_settings";

/** 기본값(2026-09 바꿈): 테마 시스템 · 등락 빨강/파랑 · 불러오기 표시 실패만.
 *  이미 고른 사람의 값은 그대로 둔다 — 저장된 값이 없거나 이상할 때만 쓴다. */
function legacyTheme(): Theme {
  try {
    const legacy = localStorage.getItem("theme");
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {}
  return "system";
}

/** localStorage 에 실제로 담기는 것 — 함수를 뺀 값들만 */
export interface 저장값 {
  colorScheme: ColorScheme;
  fontSize: FontSize;
  theme: Theme;
  orientation: Orientation;
  /** 금액을 •••• 로 가린다. 지하철에서 내 자산을 열 때 옆자리가 본다.
   *  가리는 것은 '금액' 뿐이다 — 수익률·비중·현재가는 그대로 둔다.
   *  퍼센트는 내가 얼마를 가졌는지 말해 주지 않고, 현재가는 남들도 아는 값이다. */
  금액가리기: boolean;
  불러오기표시: 불러오기표시;
  /** 공모주 메뉴에서 목록을 거를 증권사(비면 모두) — 보기만 거른다(사용자: "공모주 일정 증권사별로
   *  설정해서 볼수 있게 만들어줘"). */
  공모주증권사: string[];
  /** 휴대폰 알림(공모주 청약 아침 알림)을 받을 증권사(비면 모든 공모주) — 알림 화면에서 고른다.
   *
   *  둘은 따로다. 한때 '내증권사' 하나로 목록 거르기와 알림에 같이 썼는데, 목록을 보려고 고른 증권사가
   *  알림 증권사로 바뀌었다(사용자: "공모주메뉴에서 … 선택하는 건 그냥 선택한 공모주일정을 보고 싶을 뿐
   *  … 내 증권사라는 것이 아니"). */
  알림증권사: string[];
}

const 기본값: 저장값 = {
  colorScheme: "red-blue", fontSize: "normal", theme: "system",
  orientation: "system", 금액가리기: false, 불러오기표시: "실패만", 공모주증권사: [], 알림증권사: [],
};

const 넣거나빼기 = (목록: string[], 이름: string) =>
  목록.includes(이름) ? 목록.filter((x) => x !== 이름) : [...목록, 이름];

/** 저장된 증권사 목록을 믿을 만한 모양으로 — 글자만, 같은 것은 한 번, 지나치게 많거나 긴 것은 버린다 */
export function 정상내증권사(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const 이름들 = v.filter((x): x is string => typeof x === "string" && !!x.trim() && x.length <= 30)
    .map((x) => x.trim());
  return [...new Set(이름들)].slice(0, 40);
}

function load(): 저장값 {
  const 기본 = { ...기본값, theme: legacyTheme() };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        colorScheme: p.colorScheme === "green-red" ? "green-red" : "red-blue",
        fontSize: (["small", "normal", "large", "xl"] as FontSize[]).includes(p.fontSize) ? p.fontSize : "normal",
        theme: (["light", "dark", "system"] as Theme[]).includes(p.theme) ? p.theme : legacyTheme(),
        orientation: (["system", "portrait", "landscape"] as Orientation[]).includes(p.orientation) ? p.orientation : "system",
        금액가리기: p.금액가리기 === true,
        불러오기표시: 정상불러오기표시(p.불러오기표시),
        // 예전의 '내증권사' 하나는 둘 다로 옮긴다 — 보던 목록도, 받던 알림도 그대로(다음 저장 때 옛 칸은 빠진다)
        공모주증권사: 정상내증권사(p.공모주증권사 ?? p.내증권사),
        알림증권사: 정상내증권사(p.알림증권사 ?? p.내증권사),
      };
    }
  } catch {}
  return 기본;
}

/** 값 하나가 바뀔 때마다 통째로 다시 쓴다.
 *
 *  예전에는 save(colorScheme, fontSize, theme, orientation, 화면모양) 처럼
 *  자리로 받았다. 설정을 하나 늘릴 때마다 다섯 군데를 다 고쳐야 했고,
 *  한 곳만 빠뜨려도 그 설정이 조용히 초기화됐다. 조각만 받는다. */
function 저장(이전: 저장값, 조각: Partial<저장값>) {
  const 다음: 저장값 = { ...이전, ...조각 };
  try { localStorage.setItem(KEY, JSON.stringify(다음)); } catch {}
  return 다음;
}

interface SettingsStore extends 저장값 {
  setColorScheme: (s: ColorScheme) => void;
  setFontSize: (s: FontSize) => void;
  setTheme: (t: Theme) => void;
  setOrientation: (o: Orientation) => void;
  set금액가리기: (v: boolean) => void;
  토글금액가리기: () => void;
  set불러오기표시: (v: 불러오기표시) => void;
  /** 고른 증권사면 빼고, 아니면 넣는다 — 공모주 목록 거르기 */
  토글공모주증권사: (이름: string) => void;
  set공모주증권사: (v: string[]) => void;
  /** 고른 증권사면 빼고, 아니면 넣는다 — 휴대폰 알림 */
  토글알림증권사: (이름: string) => void;
  set알림증권사: (v: string[]) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
  const 바꾸기 = (조각: Partial<저장값>) => { 저장(get(), 조각); set(조각); };
  return {
    ...load(),
    setColorScheme: (colorScheme) => 바꾸기({ colorScheme }),
    setFontSize:    (fontSize)    => 바꾸기({ fontSize }),
    setTheme:       (theme)       => 바꾸기({ theme }),
    setOrientation: (orientation) => 바꾸기({ orientation }),
    set금액가리기:  (금액가리기)   => 바꾸기({ 금액가리기 }),
    토글금액가리기: ()            => 바꾸기({ 금액가리기: !get().금액가리기 }),
    set불러오기표시: (불러오기표시) => 바꾸기({ 불러오기표시 }),
    토글공모주증권사: (이름) => 바꾸기({ 공모주증권사: 넣거나빼기(get().공모주증권사, 이름) }),
    set공모주증권사: (v) => 바꾸기({ 공모주증권사: 정상내증권사(v) }),
    토글알림증권사: (이름) => 바꾸기({ 알림증권사: 넣거나빼기(get().알림증권사, 이름) }),
    set알림증권사: (v) => 바꾸기({ 알림증권사: 정상내증권사(v) }),
  };
});
