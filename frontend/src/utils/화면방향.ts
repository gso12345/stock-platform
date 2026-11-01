/**
 * 화면 방향 고정 — 설정의 '가로 · 세로' 를 실제로 건다.
 *
 * 사용자: "앱에서 화면방향이 작동하지 않아(가로고정 세로고정이 안되고있어)"
 *
 * 왜 안 됐나 —
 *   1) 웹에서 방향을 고정하는 길은 screen.orientation.lock() 하나인데, 안드로이드(크롬·삼성 인터넷·엣지)는
 *      전체 화면일 때만 받아 준다. 홈 화면에 설치한 앱이어도 같다. 예전 코드는 lock() 만 부르고 그 거절을
 *      조용히 삼켜서, 눌러도 아무 일이 없었다.
 *   2) manifest.json 의 "orientation": "any" — 안드로이드는 이것을 '센서대로 돌린다' 로 읽어서, 휴대폰의
 *      '자동 회전' 을 꺼 둬도 설치한 앱은 돌아갔다. '시스템설정' 도 시스템을 안 따른 셈이다(그 줄을 뺐다).
 *   3) 아이폰·아이패드는 lock() 을 막아 두었다. 웹 앱이 할 수 있는 일이 없다 — 제어 센터를 안내한다.
 *
 * 그래서 안드로이드에서는 전체 화면으로 들어가 고정한다. 전체 화면은 사람이 화면을 누른 그때만 들어갈 수
 * 있어서(브라우저 규칙), 앱을 새로 열었거나 뒤로 가기로 전체 화면이 풀렸으면(고정도 같이 풀린다) 다음에
 * 화면을 누를 때 다시 건다.
 */
import { create } from "zustand";
import type { Orientation } from "@/store/settingsStore";

/** 이 기기에서 앱이 방향을 고정할 수 있나 */
export type 고정지원 = "된다" | "아이폰" | "안된다";

/** 지금 상태 — 설정 창이 그대로 말해 준다 */
export type 고정상태 =
  | "따름"      // 시스템설정 — 고정하지 않고 휴대폰의 자동 회전을 따른다
  | "거는중"
  | "고정됨"
  | "누르면"    // 화면을 한 번 누르면 건다(전체 화면이 필요한데 누른 손이 없었다)
  | "안됨";     // 이 기기·브라우저가 받아 주지 않았다

type 방향객체 = ScreenOrientation & { lock?: (o: string) => Promise<void>; unlock?: () => void };

function 방향(): 방향객체 | undefined {
  try {
    return (screen as Screen & { orientation?: 방향객체 }).orientation ?? undefined;
  } catch {
    return undefined;
  }
}

export function 지원(ua: string = navigator.userAgent, 터치점: number = navigator.maxTouchPoints ?? 0): 고정지원 {
  // 아이패드는 사파리가 '맥' 이라고 말한다 — 터치가 되는 맥은 아이패드다
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && 터치점 > 1)) return "아이폰";
  // PC 는 돌릴 화면이 없다 — lock() 이 있어도 늘 거절하고, 전체 화면만 괜히 켜진다
  if (!/Android/i.test(ua)) return "안된다";
  return typeof 방향()?.lock === "function" ? "된다" : "안된다";
}

/** 상태와, 그 고정이 전체 화면에 들어가서 건 것인지(뒤로 가기로 풀린다고 알려 줄지) */
export const use고정상태 = create<{ 상태: 고정상태; 전체화면: boolean }>(() => ({ 상태: "따름", 전체화면: false }));
const 상태로 = (상태: 고정상태) => use고정상태.setState({ 상태, 전체화면: 전체화면으로걸었나 });

let 원하는: Orientation = "system";
let 전체화면으로걸었나 = false;
let 도는중 = false;
let 다시 = false;
let 다음손: boolean | null = null;

/** 방금 사람이 화면을 눌렀나(전체 화면에 들어갈 수 있나). 모르는 브라우저는 null */
function 손이닿았나(): boolean | null {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  return ua ? ua.isActive : null;
}

async function 전체화면나가기() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    /* 이미 나갔다 */
  }
}

async function 한번(손: boolean | null): Promise<void> {
  const 바람 = 원하는;
  const so = 방향();
  if (바람 === "system") {
    // 일반 탭에서는 unlock() 이 거절 대신 곧바로 예외를 던지기도 한다 — 감싸지 않으면 앱이 통째로 죽었다
    try { so?.unlock?.(); } catch { /* 고정한 적이 없다 */ }
    if (전체화면으로걸었나) await 전체화면나가기();     // 고정하려고 들어간 전체 화면이면 같이 나온다
    전체화면으로걸었나 = false;
    상태로("따름");
    return;
  }
  if (지원() !== "된다" || !so?.lock) {
    상태로("안됨");
    return;
  }
  상태로("거는중");
  try {
    await so.lock(바람);                 // 전체 화면 없이 받아 주는 곳(앞으로의 크롬 등)이면 여기서 끝
    상태로("고정됨");
    return;
  } catch {
    /* 안드로이드는 전체 화면이어야 한다 — 아래에서 들어간다 */
  }
  const 뿌리 = document.documentElement;
  if (document.fullscreenElement || !document.fullscreenEnabled || typeof 뿌리.requestFullscreen !== "function") {
    상태로("안됨");                       // 이미 전체 화면인데도 거절했거나, 전체 화면을 못 쓴다
    return;
  }
  if (손 === false) {
    상태로("누르면");
    return;
  }
  try {
    await 뿌리.requestFullscreen({ navigationUI: "hide" });
  } catch {
    // 누른 손이 있었는데도 거절 — 이 브라우저는 안 된다. 손을 몰랐으면 다음에 누를 때 다시
    상태로(손 ? "안됨" : "누르면");
    return;
  }
  try {
    await so.lock(바람);
    전체화면으로걸었나 = true;
    상태로("고정됨");
  } catch {
    await 전체화면나가기();               // 고정도 못 하면서 전체 화면만 남기지 않는다
    상태로("안됨");
  }
}

/** 원하는 방향으로 맞춘다. 맞추는 중에 또 부르면, 끝난 뒤 그때 원하는 방향으로 한 번 더 */
export async function 맞추기(손: boolean | null = 손이닿았나()): Promise<void> {
  if (도는중) {
    다시 = true;
    다음손 = 손;
    return;
  }
  도는중 = true;
  try {
    let 이번손 = 손;
    do {
      다시 = false;
      await 한번(이번손);
      이번손 = 다음손;
    } while (다시);
  } finally {
    도는중 = false;
  }
}

/** 설정이 바뀌었을 때(그리고 앱을 열 때) — 원하는 방향을 정하고 맞춘다 */
export function 원하는방향(o: Orientation): Promise<void> {
  원하는 = o;
  return 맞추기();
}

/** 화면을 누를 때 — 아직 못 걸었으면(전체 화면이 필요했다) 이 손으로 건다 */
function 누를때(): void {
  if (원하는 !== "system" && use고정상태.getState().상태 === "누르면") void 맞추기(손이닿았나() ?? true);
}

/** 전체 화면이 풀리면(뒤로 가기 등) 브라우저가 고정도 같이 푼다 — 다음에 누를 때 다시 건다 */
function 전체화면바뀜(): void {
  if (document.fullscreenElement || !전체화면으로걸었나) return;
  전체화면으로걸었나 = false;
  if (원하는 !== "system") 상태로("누르면");
}

/** 앱 틀(Layout)이 한 번 건다 — 누르기·전체 화면 바뀜을 지켜본다. 돌려준 함수로 뗀다 */
export function 지켜보기(): () => void {
  document.addEventListener("pointerup", 누를때, true);
  document.addEventListener("fullscreenchange", 전체화면바뀜);
  return () => {
    document.removeEventListener("pointerup", 누를때, true);
    document.removeEventListener("fullscreenchange", 전체화면바뀜);
  };
}

/** 시험용 — 모듈이 쥔 것을 처음으로 */
export function _처음으로(): void {
  원하는 = "system";
  전체화면으로걸었나 = false;
  도는중 = false;
  다시 = false;
  다음손 = null;
  상태로("따름");
}

/** 설정 창의 안내 한 줄. 전체화면 — 지금 고정이 전체 화면에 들어가서 건 것인가 */
export function 방향안내(가능: 고정지원, 설정: Orientation, 상태: 고정상태, 전체화면 = false): string {
  if (가능 === "아이폰") {
    return "아이폰·아이패드는 앱이 화면 방향을 고정할 수 없어요(애플이 막아 두었어요). 세로로 고정하려면 제어 센터의 '화면 방향 잠금' 을 켜 주세요.";
  }
  if (가능 === "안된다") return "이 기기에서는 화면 방향을 고정할 수 없어요. 안드로이드 휴대폰에서 고를 수 있어요.";
  if (설정 === "system") {
    return "휴대폰의 자동 회전 설정을 따라요. 가로·세로를 고르면 전체 화면으로 바뀌며 고정돼요(안드로이드는 전체 화면에서만 고정할 수 있어요).";
  }
  const 이름 = 설정 === "portrait" ? "세로" : "가로";
  switch (상태) {
    case "고정됨":
      // 전체 화면 없이 받아 준 곳(앞으로의 크롬 등)에서는 전체 화면 이야기를 하지 않는다
      return `${이름}로 고정했어요.` + (전체화면 ? " 뒤로 가기로 전체 화면이 풀리면, 화면을 한 번 누를 때 다시 고정해요." : "");
    case "누르면": return `화면을 한 번 누르면 ${이름}로 고정해요(전체 화면으로 바뀌어요).`;
    case "안됨": return "이 브라우저가 화면 방향 고정을 받아 주지 않았어요. 세로로 두려면 휴대폰의 자동 회전을 꺼 주세요.";
    default: return `${이름}로 고정하는 중이에요…`;
  }
}
