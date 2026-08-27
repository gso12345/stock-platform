import { create } from "zustand";

export type ColorScheme = "green-red" | "red-blue";
export type FontSize = "normal" | "large" | "xl";
export type Theme = "light" | "dark" | "system";
export type Orientation = "system" | "portrait" | "landscape";

/** 내 자산·종목상세를 어떤 모양으로 그릴지.
 *
 *  classic  내 자산은 요약 카드 넷을 그대로 두고, 종목상세는 가격 아래에
 *           지표를 한 번에 편다. 숫자를 한눈에 다 보고 싶을 때.
 *  app      다른 증권 앱 배치 — 큰 가격 → 곧바로 차트 → 그 아래 통계.
 *
 * 셋이었다가 둘로 줄였다. 가운데 것('간단히')은 종목상세만 달랐는데,
 * 접었다 폈다 하는 수고에 견줘 얻는 게 적었다.
 *
 * 무엇이 나은지는 사람마다 갈린다. 하나로 정하는 대신 고르게 둔다. */
export type 화면모양 = "classic" | "app";
/** 저장된 값이 셋 중 하나인지 확인한다. 아니면 기본값.
 *
 *  예전 버전이 남긴 값, 손으로 고친 값, 오타 — 어느 쪽이든 그대로 쓰면
 *  화면이 셋 중 아무 가지에도 안 걸려 텅 빈 채로 뜬다. */
export function 정상화면모양(v: unknown): 화면모양 {
  return v === "classic" || v === "app" ? v : "app";
}

export const 화면모양_목록: { value: 화면모양; label: string; desc: string }[] = [
  { value: "classic", label: "기본",   desc: "숫자를 한 번에 다 펼쳐 봅니다" },
  { value: "app",     label: "앱처럼", desc: "큰 가격 → 차트 → 통계 순서로 봅니다" },
];

const KEY = "portfolio_settings";

function legacyTheme(): Theme {
  try {
    const legacy = localStorage.getItem("theme");
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch {}
  return "dark";
}

/** localStorage 에 실제로 담기는 것 — 함수를 뺀 값들만 */
export interface 저장값 {
  colorScheme: ColorScheme;
  fontSize: FontSize;
  theme: Theme;
  orientation: Orientation;
  화면모양: 화면모양;
  /** 금액을 •••• 로 가린다. 지하철에서 내 자산을 열 때 옆자리가 본다.
   *  가리는 것은 '금액' 뿐이다 — 수익률·비중·현재가는 그대로 둔다.
   *  퍼센트는 내가 얼마를 가졌는지 말해 주지 않고, 현재가는 남들도 아는 값이다. */
  금액가리기: boolean;
}

const 기본값: 저장값 = {
  colorScheme: "green-red", fontSize: "normal", theme: "dark",
  orientation: "system", 화면모양: "app", 금액가리기: false,
};

function load(): 저장값 {
  const 기본 = { ...기본값, theme: legacyTheme() };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        colorScheme: p.colorScheme === "red-blue" ? "red-blue" : "green-red",
        fontSize: (["normal", "large", "xl"] as FontSize[]).includes(p.fontSize) ? p.fontSize : "normal",
        theme: (["light", "dark", "system"] as Theme[]).includes(p.theme) ? p.theme : legacyTheme(),
        orientation: (["system", "portrait", "landscape"] as Orientation[]).includes(p.orientation) ? p.orientation : "system",
        화면모양: 정상화면모양(p.화면모양),
        금액가리기: p.금액가리기 === true,
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
  set화면모양: (v: 화면모양) => void;
  set금액가리기: (v: boolean) => void;
  토글금액가리기: () => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => {
  const 바꾸기 = (조각: Partial<저장값>) => { 저장(get(), 조각); set(조각); };
  return {
    ...load(),
    setColorScheme: (colorScheme) => 바꾸기({ colorScheme }),
    setFontSize:    (fontSize)    => 바꾸기({ fontSize }),
    setTheme:       (theme)       => 바꾸기({ theme }),
    setOrientation: (orientation) => 바꾸기({ orientation }),
    set화면모양:    (화면모양)     => 바꾸기({ 화면모양 }),
    set금액가리기:  (금액가리기)   => 바꾸기({ 금액가리기 }),
    토글금액가리기: ()            => 바꾸기({ 금액가리기: !get().금액가리기 }),
  };
});
