/**
 * 종목 표 부품 — 스크리닝 표의 이름 칸·등락·정렬 단추·기다리는 자리·도구 단추.
 *
 * 퀀트에도 한때 썼다가 사용자가 예전 화면으로 되돌렸다("퀀트는 전버전으로 되돌려주고").
 * 다른 표가 같은 모양을 쓰고 싶으면 여기서 가져다 쓴다.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import { useSettingsStore } from "@/store/settingsStore";
import { cn, InlineSpinner } from "@/components/ui";

// ── 표의 틀(클래스) — 두 표가 같은 줄 높이·여백·머리 색을 쓴다 ─────────────
/** 표를 감싸는 상자 — 가로로 밀고, 넓은 화면에서는 머리가 붙어 있게 세로로도 민다.
 *  relative 여야 한다 — 등락 칸의 화면 읽기용 글자(sr-only, absolute)는 가장 가까운 '자리 잡은' 조상 안에만
 *  갇힌다. 상자가 static 이면 그 글자들이 상자를 빠져나가 문서를 2,500px 로 넓혔고, 휴대폰은 판을 4배로
 *  키워 아래 메뉴가 화면 밖으로 밀렸다(사용자: "종목스크리닝을 누르면 모바일 기준 아래메뉴가 안보여") */
export const 표상자 = "relative overflow-x-auto lg:overflow-y-auto lg:max-h-[75vh]";
/** 표 글자 — 스크리닝·백테스트 표가 같은 크기. 넓은 화면에서는 뿌리 글자가 커져(index.css) 다른 메뉴와 같은
 *  비율로 같이 커진다 — 표만 따로 키우면 메뉴마다 들쭉날쭉해진다 */
export const 표글자 = "text-xs";
export const 표머리 = "sticky top-0 z-20 bg-bg-secondary";
export const 표머리줄 = "text-text-muted border-b border-border";
export const 표머리칸 = "text-right font-medium px-3 py-2.5 whitespace-nowrap";
/** 가로로 밀어도 남는 이름 칸의 머리 */
export const 붙박이머리 = "sticky left-0 z-30 bg-bg-secondary text-left font-medium px-3 py-2.5";
export const 표줄 = "group/row border-b border-border/30 hover:bg-bg-hover/50 transition-colors";
/* 붙박이 칸은 바탕이 불투명해야 밀리는 칸이 비치지 않는다 — 줄에 올렸을 때도 나머지 칸(카드 위에
   반투명 hover)과 같은 색이 되게 섞어 칠한다 */
export const 붙박이칸 =
  "sticky left-0 z-10 bg-bg-card group-hover/row:bg-[color-mix(in_srgb,var(--bg-hover)_50%,var(--bg-card))] transition-colors px-3 py-2";
export const 표칸 = "px-3 py-2 text-right whitespace-nowrap";

/** 회사 로고 — 회사 누리집(서버가 주는 domain)의 아이콘을 구글의 아이콘 창고에서 받는다.
 *  누리집을 모르거나 아이콘을 못 받으면 이름 첫 글자를 둔다(자리가 비면 줄마다 이름이 들쭉날쭉하다) */
export function 회사로고({ 도메인, 이름 }: { 도메인?: string | null; 이름: string }) {
  const [안됨, set안됨] = useState(false);
  const 틀 = "w-6 h-6 rounded-lg flex-shrink-0";
  if (!도메인 || 안됨) {
    return (
      <span aria-hidden className={cn(틀, "bg-bg-elevated border border-border flex items-center justify-center text-2xs font-bold text-text-muted")}>
        {(이름.trim()[0] ?? "?").toUpperCase()}
      </span>
    );
  }
  return (
    <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(도메인)}&sz=64`}
      alt="" aria-hidden loading="lazy" decoding="async" width={24} height={24}
      onError={() => set안됨(true)}
      className={cn(틀, "bg-white object-contain p-0.5")} />
  );
}

/** ▲ 2.49% — 오르면 설정의 오름 색, 내리면 내림 색(ChangeBadge 와 같은 규칙).
 *  금액을 주면 '▲ 900 (1.22%)' — 퍼센트만 보면 그게 300원인지 3만원인지 모른다 */
export function 등락표시({ 값, 금액, 통화 }: { 값: number; 금액?: number | null; 통화?: string }) {
  const 색표 = useSettingsStore((s) => s.colorScheme);
  const 색 = 값 > 0 ? (색표 === "red-blue" ? "text-accent-red" : "text-accent-green")
    : 값 < 0 ? (색표 === "red-blue" ? "text-accent-blue" : "text-accent-red")
    : "text-text-muted";
  const 비율 = `${Math.abs(값).toFixed(2)}%`;
  const 금액글 = 금액 == null || !Number.isFinite(금액) ? null
    : 통화 === "USD" ? Math.abs(금액).toFixed(2) : Math.round(Math.abs(금액)).toLocaleString("ko-KR");
  return (
    <span className={cn("font-mono num whitespace-nowrap", 색)}>
      <span aria-hidden>{값 > 0 ? "▲ " : 값 < 0 ? "▼ " : ""}</span>
      <span className="sr-only">{값 > 0 ? "오름 " : 값 < 0 ? "내림 " : ""}</span>
      {금액글 ? <>{금액글} ({비율})</> : 비율}
    </span>
  );
}

/** 이름 칸 — 순위·로고·이름(누르면 종목 상세)·종목코드 */
export function 종목칸({ 순위, symbol, name, market, domain, 덧붙임 }: {
  순위?: number;
  symbol: string;
  name: string;
  market: string;
  domain?: string | null;
  /** 종목코드 옆에 붙일 것 — 여러 시장을 섞어 보일 때의 시장 표시 등 */
  덧붙임?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      {순위 != null && (
        <span className="w-5 flex-shrink-0 text-right text-2xs text-text-dim font-mono">{순위}</span>
      )}
      <회사로고 도메인={domain} 이름={name} />
      <Link to={`/stocks/${market}/${symbol}`} className="min-w-0 flex flex-col group">
        <span className="font-semibold text-text-primary truncate max-w-[7.5rem] sm:max-w-[12rem] group-hover:text-accent-blue transition-colors">
          {name}
        </span>
        <span className="flex items-center gap-1 text-2xs text-text-muted font-mono">
          {symbol.replace(/\.(KS|KQ)$/, "")}{덧붙임}
        </span>
      </Link>
    </div>
  );
}

/** 칸 제목 — 누르면 그 칸으로 세운다(지금 세운 칸은 파랗고 화살표가 붙는다) */
export function 정렬제목({ 이름, 지금, 순서, onClick, title }: {
  이름: string;
  지금: boolean;
  순서: "asc" | "desc";
  onClick: () => void;
  title?: string;
}) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={cn("inline-flex items-center gap-0.5 whitespace-nowrap", 지금 ? "text-accent-blue" : "hover:text-text-primary")}>
      {이름}
      {지금 && (순서 === "desc" ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
    </button>
  );
}

/** 서버가 받는 중일 때의 띠 — 받은 것부터 보이고, 얼마나 받았는지 막대로 */
export function 받는중띠({ 이름, children, done, total }: {
  /** 화면을 소리로 듣는 사람에게 읽히는 이름 */
  이름: string;
  children: ReactNode;
  done?: number;
  total?: number;
}) {
  const 비율 = total ? Math.round(((done ?? 0) / total) * 100) : null;
  return (
    <div role="status" aria-label={이름}
      className="flex flex-col gap-2 px-3 py-2.5 rounded-xl border border-accent-blue/30 bg-accent-blue/5">
      {/* <p> 가 아니라 <div> — 도는 동그라미(InlineSpinner)가 <div> 라 <p> 안에 못 들어간다 */}
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <InlineSpinner className="w-3 h-3" />
        <span>{children}</span>
      </div>
      {비율 != null && (
        <div className="h-1 rounded-full bg-bg-elevated overflow-hidden">
          <div className="h-full bg-accent-blue transition-all" style={{ width: `${비율}%` }} />
        </div>
      )}
    </div>
  );
}

/* 결과 표 자리를 미리 잡아 둔다. 처음 한 번은 시장 전체를 훑느라 수십 초가 걸린다 —
   동그라미만 돌면 멈춘 줄 안다. 표가 뜰 자리를 보여 주면 뜰 때 화면이 안 밀린다 */
export function StockTableSkeleton({ rows = 10 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-4" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 animate-pulse">
          <div className="h-3 w-4 rounded bg-bg-elevated" />
          <div className="h-6 w-6 rounded-lg bg-bg-elevated flex-shrink-0" />
          <div className="flex flex-col gap-1.5">
            <div className="h-3 w-32 rounded bg-bg-elevated" />
            <div className="h-2.5 w-12 rounded bg-bg-elevated" />
          </div>
          <div className="ml-auto hidden sm:flex gap-6">
            {Array.from({ length: 6 }).map((__, j) => <div key={j} className="h-3 w-14 rounded bg-bg-elevated" />)}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 도구 줄 단추 — 판을 여닫는 것(열림 을 준다)과 그냥 누르는 것(CSV 등) */
export function 도구단추({ 아이콘: Icon, children, 열림, 눌림, controls, onClick, title, disabled }: {
  아이콘?: LucideIcon;
  children: ReactNode;
  /** 판을 여닫는 단추면 지금 열렸는지 — 안 주면 그냥 누르는 단추 */
  열림?: boolean;
  /** 켜고 끄는 단추면 지금 켜졌는지(원화 환산 따위) */
  눌림?: boolean;
  controls?: string;
  onClick: () => void;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} title={title} disabled={disabled}
      aria-expanded={열림} aria-controls={열림 === undefined ? undefined : controls} aria-pressed={눌림}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0 disabled:opacity-40",
        열림 || 눌림
          ? "bg-accent-blue/15 border-accent-blue text-accent-blue"
          : "bg-bg-elevated border-border text-text-secondary hover:text-text-primary hover:border-accent-blue/50",
      )}>
      {Icon && <Icon size={13} />}{children}
    </button>
  );
}
