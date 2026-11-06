/**
 * 백테스트 세 탭(자산배분·단일 종목·유니버스)이 같이 쓰는 설정 부품 — 사용자: "백테스트탭 디자인, 사용자편의성
 * 개선하고 싶어 앱느낌 나도록"(고른 13가지 중 3·4·5·6·8).
 *
 *   기간칸     기간 칩이 먼저, 그 아래 날짜 두 칸을 한 줄에(예전엔 날짜가 세로로 두 줄, 칩이 그 아래)
 *   금액칸     '1,000만원' 처럼 읽어 주고 빠른 금액 칩(100만·500만·1000만·1억) — 단일 종목도 자산배분과 같게
 *   고급설정   자주 안 바꾸는 칸을 접어 둔다 — 접혀 있어도 '· n개 바꿈' 으로 기본값에서 바꾼 것이 보인다
 *   실행줄     저장·결과 확인을 화면 아래(휴대폰은 아래 메뉴 바로 위)에 붙인다 — 못 누르는 이유는 단추 바로 위에
 *   설정요약   결과가 나오면(설정과 결과가 위아래로 놓이는 폭에서) 설정을 한 줄로 접는다
 *   use결과로  '결과 확인' 을 누르면 진행 막대·결과가 있는 곳으로 부드럽게 내려간다
 */
import { useCallback, useId, useRef, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button, Card, 고른칩, cn } from "@/components/ui";
import { 빠른기간, 기간에서날짜, 금액값들, 읽는금액 } from "./설정값";

/** 설정 칸의 제목 — 백테스트의 다른 탭(단일 종목·유니버스) 설정도 같은 제목을 쓴다 */
export function 칸제목({ children, 오른쪽 }: { children: React.ReactNode; 오른쪽?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-base font-semibold text-text-primary">{children}</span>
      {오른쪽}
    </div>
  );
}

/** 설정 요약에 쓰는 기간 — 오늘까지 꼭 N년이면 'N년', 아니면 날짜 두 개 */
export function 기간말(시작: string, 끝: string, 오늘 = new Date()): string {
  for (const 년 of 빠른기간) {
    const d = 기간에서날짜(년, 오늘);
    if (d.start_date === 시작 && d.end_date === 끝) return `${년}년`;
  }
  const 점 = (x: string) => x.replace(/-/g, ".");
  return `${점(시작)} ~ ${점(끝)}`;
}

const 날짜칸모양 =
  "w-full min-w-0 bg-bg-primary border border-border rounded-lg px-2.5 py-2.5 text-sm text-text-primary " +
  "focus:outline-none focus:border-accent-blue";

/** 기간 — 칩을 먼저 두고(대부분 칩 하나로 끝난다) 날짜 두 칸을 한 줄에 둔다.
 *
 *  예전에는 날짜 두 칸을 폰에서 세로로 쌓고 칩을 그 아래에 뒀다. 세 줄이 기간 하나에 쓰였고, 제일 많이 누르는
 *  칩이 맨 아래였다. 날짜 칸 하나의 폭은 폰(390)에서 160px 남짓 — '2026. 11. 04.' 와 달력 단추가 들어간다.
 *  고른년 — 지금 고른 칩. 날짜를 손으로 고치면 null(어느 칩도 아니다). */
export function 기간칸({ 시작, 끝, 고른년, 바꾸기 }: {
  시작: string;
  끝: string;
  고른년: number | null;
  바꾸기: (다음: { 시작: string; 끝: string; 년: number | null }) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <칸제목>테스트 기간</칸제목>
      <div className="grid grid-cols-6 gap-1.5">
        {빠른기간.map((년) => (
          <고른칩 key={년} 고름={고른년 === 년} ariaLabel={`${년}년`} className="px-0"
            onClick={() => { const d = 기간에서날짜(년); 바꾸기({ 시작: d.start_date, 끝: d.end_date, 년 }); }}>
            {년}년
          </고른칩>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <label htmlFor="bt-start" className="text-xs text-text-muted">시작일</label>
          <input id="bt-start" type="date" className={날짜칸모양} value={시작}
            onChange={(e) => 바꾸기({ 시작: e.target.value, 끝, 년: null })} />
        </div>
        <div className="flex flex-col gap-1 min-w-0">
          <label htmlFor="bt-end" className="text-xs text-text-muted">종료일</label>
          <input id="bt-end" type="date" className={날짜칸모양} value={끝}
            onChange={(e) => 바꾸기({ 시작, 끝: e.target.value, 년: null })} />
        </div>
      </div>
    </div>
  );
}

const 통화기호 = { KRW: "₩", USD: "$" } as const;

/** 금액 — 친 수를 '1,000만원' 처럼 읽어 주고, 흔한 금액은 칩 하나로(누르면 그 금액으로 정해진다 — 더하지 않는다).
 *
 *  단일 종목 탭은 '10000000' 을 숫자 칸에 그대로 보여 줬다 — 0 이 몇 개인지 세야 했다. 자산배분 탭과 같은 칸을 쓴다.
 *  앞 — 금액 칸 왼쪽에 붙일 것(자산배분의 통화 고르기). */
export function 금액칸({ 제목, 이름, 값, 바꾸기, 통화 = "KRW", 앞 }: {
  제목: string;
  /** 칸의 이름(화면 읽기) */
  이름: string;
  값: number | "";
  바꾸기: (v: number | "") => void;
  통화?: "KRW" | "USD";
  앞?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <칸제목>{제목}</칸제목>
      <div className="flex gap-3">
        {앞}
        <div className="flex-1 flex items-center gap-2 bg-bg-elevated border border-border rounded-xl px-3 min-w-0">
          <span className="text-sm text-text-muted flex-shrink-0">{통화기호[통화]}</span>
          <input
            type="number" min={0} inputMode="numeric" aria-label={이름} placeholder="금액 입력"
            className="flex-1 min-w-0 bg-transparent py-2 text-sm text-text-primary focus:outline-none"
            value={값}
            onChange={(e) => 바꾸기(e.target.value === "" ? "" : Number(e.target.value))}
          />
          {/* 0 이 몇 개인지 세게 하면 안 된다. 1000만과 1억은 눈으로 가르기 어렵고, 한 자리 틀리면 결과가 열 배다 */}
          {!!Number(값) && (
            <span className="text-sm font-semibold text-accent-blue flex-shrink-0">{읽는금액(Number(값), 통화)}</span>
          )}
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {금액값들(통화).map((v) => (
          <고른칩 key={v} 고름={Number(값) === v} ariaLabel={읽는금액(v, 통화)} 최소너비="4.5rem" className="flex-1"
            onClick={() => 바꾸기(v)}>{읽는금액(v, 통화)}</고른칩>
        ))}
        {!!Number(값) && (
          <button type="button" aria-label="금액 지우기" onClick={() => 바꾸기("")}
            className="px-3 py-2 rounded-lg text-xs text-text-dim hover:text-accent-red">지우기</button>
        )}
      </div>
    </div>
  );
}

/** 자주 안 바꾸는 칸을 접어 둔다. 접혀 있어도 기본값에서 바꾼 것이 몇 개인지 제목 옆에 보인다 —
 *  안 보이는 곳에서 수수료가 0.25% 로 걸려 있는 줄 모르고 결과를 읽으면 안 된다. */
export function 고급설정({ 바꾼수, children }: { 바꾼수: number; children: React.ReactNode }) {
  const [열림, set열림] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <button type="button" aria-expanded={열림} aria-controls={id} onClick={() => set열림((v) => !v)}
        className="flex items-center justify-between gap-2 -my-1 py-1 text-left">
        <span className="text-base font-semibold text-text-primary">
          고급 설정
          {바꾼수 > 0 && <span className="ml-1.5 text-xs font-medium text-accent-blue">· {바꾼수}개 바꿈</span>}
        </span>
        <ChevronDown size={16} className={cn("text-text-muted transition-transform", 열림 && "rotate-180")} />
      </button>
      {열림 && <div id={id} className="flex flex-col gap-5">{children}</div>}
    </div>
  );
}

/** 저장·결과 확인 단추 줄 — 설정 카드 아래에 붙어서 화면 아래에 머문다(휴대폰은 아래 메뉴 바로 위).
 *
 *  설정이 휴대폰 화면 세 장이라, 예전엔 단추를 누르려면 맨 아래까지 내려가야 했다. 카드 안에서만 붙어 있으므로
 *  카드를 지나 결과까지 내려가면 같이 사라진다 — 결과를 가리지 않는다.
 *  이유 — 못 누르는 까닭. 단추 바로 위에 적는다(회색 단추만 있으면 무엇이 모자란지 화면을 뒤진다). */
export function 실행줄({ 이유, 알림, children }: {
  이유?: string | null;
  /** 단추 아래에 붙일 한 줄(저장했어요·로그인이 필요해요) — 단추 줄이 카드 맨 아래라 그 밖에 두면 줄 밑으로 숨는다 */
  알림?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    /* bottom-0 이면 아래 메뉴 바로 위다 — 본문(main)이 아래 메뉴 높이만큼 아래 여백을 두고, 붙는 자리는 그 여백
       안쪽에서 잰다. 메뉴 높이를 여기서 한 번 더 빼면 단추 줄이 메뉴 위로 붕 떠서 그 틈으로 글이 비친다(실제로
       폰 크기로 찍어 보고 고쳤다 — 49px 떠 있었다) */
    <div className="sticky bottom-0 z-10 -mx-4 -mb-4 px-4 pt-3 pb-4 flex flex-col gap-2 rounded-b-xl border-t border-border bg-bg-card/95 backdrop-blur">
      {이유 && <p className="text-xs text-text-dim break-keep">{이유}</p>}
      <div className="flex gap-3">{children}</div>
      {알림}
    </div>
  );
}

/** 결과가 나온 뒤의 설정 — 한 줄 요약과 '설정 바꾸기'. 설정과 결과가 위아래로 놓이는 폭에서만 쓴다
 *  (넓은 화면은 설정이 왼쪽에 그대로 있다). 예전엔 결과가 화면 세 장짜리 설정 밑에 붙어 있었다. */
/** 펼친 설정의 한 줄 — 이름표와 값 */
export interface 설정항목 { 이름: string; 값: React.ReactNode }

/**
 * 결과가 나와 한 줄로 접힌 설정 — 누르면 **이 결과를 낸 설정**이 펼쳐진다.
 *
 * 사용자: "백테스팅 결과 나오면 1줄로 접히는데 펼칠수도 있도록 해줘(결과와 설정을 같이 볼 수도 있게)". 예전 한 줄에는
 * '설정 바꾸기' 하나뿐이라, 무슨 조건으로 돌렸는지 보려면 편집 칸(화면 세 장)을 통째로 열어야 했고 다시 접는 길도
 * 없었다. 이제
 *   · 요약 줄을 누르면 읽기만 하는 설정 목록이 펼쳐지고(조건은 글로), 다시 누르면 접힌다 — 결과는 바로 아래 그대로
 *   · '설정 바꾸기' 는 예전처럼 편집 칸을 연다
 * 목록은 '지금 칸에 적힌 것' 이 아니라 **결과를 낸 것**이다 — 고치다 만 값이 결과의 설정처럼 보이면 안 된다.
 */
export function 설정요약({ 줄, 펼치기, 항목들 }: {
  줄: [string, string?];
  /** '설정 바꾸기' — 편집 칸을 연다 */
  펼치기: () => void;
  /** 펼쳤을 때 보일 설정. 없으면 예전처럼 한 줄과 '설정 바꾸기' 만 */
  항목들?: 설정항목[];
}) {
  const [펼침, set펼침] = useState(false);
  const 목록id = useId();
  const 글 = (
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-text-primary truncate">{줄[0]}</p>
      {줄[1] && <p className="text-xs text-text-muted truncate">{줄[1]}</p>}
    </div>
  );
  return (
    <Card className="flex flex-col py-0">
      <div className="flex items-center gap-3 py-3">
        {항목들?.length ? (
          <button type="button" onClick={() => set펼침((v) => !v)} aria-expanded={펼침} aria-controls={목록id}
            className="flex items-center gap-3 min-w-0 flex-1 text-left -my-1 py-1 rounded-lg">
            <SlidersHorizontal size={16} className="text-text-muted flex-shrink-0" aria-hidden />
            {글}
            <ChevronDown size={16} aria-hidden
              className={cn("text-text-muted flex-shrink-0 transition-transform", 펼침 && "rotate-180")} />
            <span className="sr-only">{펼침 ? "설정 접기" : "설정 펼치기"}</span>
          </button>
        ) : (
          <>
            <SlidersHorizontal size={16} className="text-text-muted flex-shrink-0" aria-hidden />
            {글}
          </>
        )}
        <Button variant="secondary" size="sm" onClick={펼치기} className="flex-shrink-0">설정 바꾸기</Button>
      </div>
      {펼침 && !!항목들?.length && (
        <dl id={목록id} className="border-t border-border py-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
          {항목들.map((x) => (
            <div key={x.이름} className="contents">
              <dt className="text-xs text-text-muted whitespace-nowrap">{x.이름}</dt>
              <dd className="text-xs text-text-primary break-keep min-w-0">{x.값}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

/** 편집 칸을 연 채로 결과가 있을 때 맨 위에 붙는 줄 — 다시 한 줄로 접는다(예전엔 접는 길이 없었다) */
export function 설정접기줄({ 접기 }: { 접기: () => void }) {
  return (
    <button type="button" onClick={접기}
      className="self-end -mb-2 flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-text-muted
                 hover:text-text-primary hover:bg-bg-elevated transition-colors">
      설정 접기
      <ChevronDown size={14} aria-hidden className="rotate-180" />
    </button>
  );
}

/** '결과 확인' 뒤에 진행 막대·결과가 있는 곳으로 데려간다 — 이미 화면 위쪽에 보이면(넓은 화면의 오른쪽 칸)
 *  안 움직인다. 예전엔 눌러도 화면이 그대로라, 아래에서 계산이 도는지 몰랐다(폰에서 결과는 설정 세 장 밑). */
export function use결과로(): [React.RefObject<HTMLDivElement>, () => void] {
  const 자리 = useRef<HTMLDivElement>(null);
  const 가기 = useCallback(() => {
    requestAnimationFrame(() => {
      const el = 자리.current;
      if (!el) return;
      const 위 = el.getBoundingClientRect().top;
      if (위 >= 0 && 위 < window.innerHeight * 0.5) return;
      부드럽게가기(el);
    });
  }, []);
  return [자리, 가기];
}

/** 그 자리로 부드럽게(움직임 줄이기를 켠 사람에게는 바로).
 *
 *  결과가 나와 설정을 접을 때도 이것으로 간다 — 바로 가기(instant)로 두면, 응답이 빨리 와서 '결과로' 의 부드러운
 *  움직임이 아직 끝나지 않았을 때 둘이 겹쳐 요약 카드가 위로 잘렸다(실제 화면에서 13px). 부드러운 움직임끼리는
 *  나중 것이 앞의 것을 대신한다. */
export function 부드럽게가기(el: Element | null | undefined) {
  let 줄임 = false;
  try { 줄임 = !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches; } catch { /* 없으면 부드럽게 */ }
  el?.scrollIntoView?.({ behavior: 줄임 ? "auto" : "smooth", block: "start" });
}
