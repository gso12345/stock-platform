import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useSettingsStore } from "@/store/settingsStore";
import { 용어사전 } from "@/constants/terms";
import type { LucideIcon } from "lucide-react";

export function cn(...i: ClassValue[]) { return twMerge(clsx(i)); }

/* ── Card ──────────────────────────────────────────────── */
export function Card({ children, className, onClick, ariaLabel }: {
  children: React.ReactNode; className?: string; onClick?: () => void; ariaLabel?: string;
}) {
  /* onClick 이 있으면 버튼처럼 동작해야 한다.
     예전에는 그냥 <div onClick> 이라 마우스로만 누를 수 있었다 — 대시보드의
     지수 카드를 키보드로는 열 수 없었고, 스크린리더는 누를 수 있는지조차
     알 수 없었다. Card 는 거의 모든 화면이 쓰므로 여기서 고치면 함께 좋아진다. */
  const clickable = typeof onClick === "function";
  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-label={clickable ? ariaLabel : undefined}
      onKeyDown={clickable ? (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick!(); }
      } : undefined}
      className={cn(
        "bg-bg-card border border-border rounded-xl",
        !className?.includes("p-0") && "p-4",
        clickable && "cursor-pointer hover:border-accent-blue/40 transition-colors " +
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60",
        className,
      )}
    >{children}</div>
  );
}

/* ── 등락 배지 (설정의 색상 테마 적용) ───────────────────── */
export function ChangeBadge({ value, suffix = "%", className, 금액, 통화 }: {
  value: number; suffix?: string; className?: string;
  /** 얼마가 오르내렸는지. 주면 % 앞에 같이 적는다.
   *  퍼센트만 보면 '3% 올랐다'는 알아도 그게 300원인지 3만원인지 모른다.
   *  값이 없는 종목(현금·시세 미수신)도 있어 있을 때만 붙인다. */
  금액?: number | null;
  /** 'KRW' 면 ₩, 아니면 $. 소수 자리도 통화에 맞춘다 */
  통화?: string;
}) {
  const colorScheme = useSettingsStore((s) => s.colorScheme);
  const pos = value >= 0;
  const color = pos
    ? (colorScheme === "red-blue" ? "text-accent-red"  : "text-accent-green")
    : (colorScheme === "red-blue" ? "text-accent-blue" : "text-accent-red");
  /* 금액은 통화 기호 없이 숫자만 쓴다.
     '+₩900 +1.22%' 는 기호가 둘(₩, %)이라 눈이 걸린다. 어차피 바로 옆에
     현재가가 통화와 함께 있으므로, 여기서는 '+900 (+1.22%)' 로 짧게 둔다. */
  const 원화 = 통화 !== "USD";
  const 금액글 = 금액 == null || !Number.isFinite(금액) ? null
    : `${금액 >= 0 ? "+" : "-"}${원화
        ? Math.round(Math.abs(금액)).toLocaleString("ko-KR")
        : Math.abs(금액).toFixed(2)}`;
  const 비율글 = `${pos ? "+" : ""}${value.toFixed(2)}${suffix}`;
  return (
    <span className={cn("font-mono font-semibold num", color, className)}>
      {금액글 ? `${금액글} (${비율글})` : 비율글}
    </span>
  );
}

/* ── 스피너 ────────────────────────────────────────────── */
export function LoadingSpinner({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const s = size === "sm" ? "w-5 h-5" : size === "lg" ? "w-12 h-12" : "w-8 h-8";
  return (
    <div className="flex items-center justify-center py-8">
      <div className={cn(s, "border-2 border-accent-blue border-t-transparent rounded-full animate-spin")} />
    </div>
  );
}

/* ── 인라인 스피너 ──
   여백 없이 버튼·입력창 옆에 바로 붙이는 용도 (LoadingSpinner는 py-8 여백을 가진다).
   같은 마크업이 화면마다 손으로 복사돼 있던 것을 하나로 모았다. */
export function InlineSpinner({ className }: { className?: string }) {
  return (
    <div className={cn(
      "border-2 border-accent-blue border-t-transparent rounded-full animate-spin flex-shrink-0",
      className ?? "w-4 h-4",
    )} />
  );
}

/* ── 폼 입력창 공통 스타일 ──
   내 자산·관심종목의 각 모달이 동일한 문자열을 복사해 쓰던 것을 상수화 */
export const INPUT_CLASS =
  "w-full bg-bg-primary border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue transition-colors";

/* ── 행 스켈레톤 (목록/테이블 로딩 공통) ──────────────── */
export function RowSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-bg-secondary border border-border/40 animate-pulse">
          <div className="w-8 h-8 rounded-full bg-bg-elevated flex-shrink-0" />
          <div className="flex-1 flex flex-col gap-1.5">
            <div className="h-3 w-1/3 rounded bg-bg-elevated" />
            <div className="h-2.5 w-1/4 rounded bg-bg-elevated" />
          </div>
          <div className="h-3 w-14 rounded bg-bg-elevated" />
        </div>
      ))}
    </div>
  );
}

/* ── 모달 (백드롭 + 패널 공용 마크업) ──────────────────── */
export function Modal({ children, maxWidth = "max-w-md", align = "center", padTop = "pt-16", backdropOpacity = 60, onClose, className }: {
  children: React.ReactNode;
  maxWidth?: string;
  align?: "start" | "center";
  padTop?: string;
  backdropOpacity?: 60 | 70;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex justify-center px-4 backdrop-blur-sm modal-backdrop",
        align === "start" ? `items-start ${padTop}` : "items-center",
        backdropOpacity === 70 ? "bg-black/70" : "bg-black/60",
      )}
      onClick={onClose ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
    >
      <div className={cn("w-full bg-bg-card border border-border rounded-2xl shadow-2xl overflow-hidden modal-pop", maxWidth, className)}>
        {children}
      </div>
    </div>
  );
}

/* ── 시장 배지 (KR / US / ETF) ──
   내 자산은 이 컴포넌트를, 관심종목은 Badge + 별도 색상표를 쓰던 것을 하나로 합쳤다. */
export function MarketBadge({ market }: { market: string }) {
  const cls =
    market === "KR"  ? "border-blue-700/50 text-blue-400 bg-blue-900/20" :
    market === "ETF" ? "border-purple-700/50 text-purple-400 bg-purple-900/20" :
                       "border-green-700/50 text-green-400 bg-green-900/20";
  return <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${cls}`}>{market}</span>;
}

/* ── 배지 ──────────────────────────────────────────────── */
export function Badge({ children, variant = "default" }: {
  children: React.ReactNode;
  variant?: "default" | "blue" | "green" | "red" | "yellow" | "purple";
}) {
  const v: Record<string, string> = {
    default: "bg-bg-elevated border-border text-text-muted",
    blue:    "bg-blue-900/30 border-blue-700/40 text-blue-400",
    green:   "bg-green-900/30 border-green-700/40 text-accent-green",
    red:     "bg-red-900/30 border-red-700/40 text-accent-red",
    yellow:  "bg-yellow-900/30 border-yellow-700/40 text-accent-yellow",
    purple:  "bg-purple-900/30 border-purple-700/40 text-purple-400",
  };
  return <span className={cn("text-2xs px-1.5 py-0.5 rounded border font-semibold", v[variant])}>{children}</span>;
}

/* ── 탭 ────────────────────────────────────────────────── */
export type TabItem = {
  id: string;
  label: string;
  /** 왼쪽 아이콘 (lucide 컴포넌트) */
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  /** 라벨 옆 작은 개수 */
  count?: number;
};

/** 알약형 탭 — 화면 안에서 큰 구획을 바꿀 때 (국내/해외, 전체/국내/해외/ETF)
 *
 * 예전에는 이 마크업이 페이지마다 그대로 복붙돼 있었다. 공용 컴포넌트가
 * 있었지만 아이콘·개수·너비를 지원하지 않아 아무도 쓰지 않았다. 지금은
 * 대시보드·퀀트·뉴스·전략·피드·관심종목·포트폴리오·관리자가 모두 이걸 쓴다.
 *
 * 아직 안 옮긴 곳이 있다 — 드래그로 순서를 바꾸는 폴더·포트폴리오 탭,
 * 배지가 겹쳐 붙는 관리자 상단 탭, 카드 헤더에 닫기 버튼과 한 줄로 놓인
 * 피드 작성기 탭. 탭 자체보다 거기 붙은 동작이 본체라, 억지로 끼워 넣으면
 * 이 컴포넌트가 그 사정을 전부 떠안게 된다. */
export function Tabs({
  tabs, active, onChange, onHover,
  fill = true, size = "sm", tone = "solid", className, ariaLabel,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  /** 마우스를 올렸을 때 (미리 불러오기용). 없으면 아무 일도 하지 않는다 */
  onHover?: (id: string) => void;
  /** 남는 공간을 나눠 가질지 (false 면 내용 너비) */
  fill?: boolean;
  /** 크기. 화면 전체를 나누는 탭은 sm, 카드 안 서브탭은 md 를 쓰던 관례가
   *  있어 둘 다 지원한다. xs 는 좁은 줄에 탭이 예닐곱 개씩 들어가는 곳
   *  (포트폴리오 자산유형 필터) 용으로, 넓히면 가로 스크롤만 길어진다 */
  size?: "xs" | "sm" | "md";
  /** 강조 정도.
   *  solid  화면의 주된 구획을 바꾸는 탭 — 선택된 것이 파랗게 채워진다
   *  subtle 목록에 거는 보조 필터 — 한 화면에 여러 개가 있어도 서로 다투지 않게
   *         선택된 것만 카드색으로 떠오른다. 관리자 화면처럼 필터가 많은 곳용 */
  tone?: "solid" | "subtle";
  className?: string;
  ariaLabel?: string;
}) {
  const subtle = tone === "subtle";
  return (
    <div role="tablist" aria-label={ariaLabel}
      className={cn(
        "flex",
        subtle ? "gap-0.5 p-0.5 bg-bg-elevated border border-border rounded-lg"
               : "gap-0.5 p-1 bg-bg-card border border-border rounded-xl",
        className,
      )}>
      {tabs.map((t) => {
        const on = active === t.id;
        const Icon = t.icon;
        return (
          <button key={t.id} role="tab" aria-selected={on}
            onClick={() => onChange(t.id)}
            onMouseEnter={onHover ? () => onHover(t.id) : undefined}
            className={cn(
              "flex items-center justify-center gap-1.5 font-semibold transition-all whitespace-nowrap",
              subtle || size === "xs" ? "px-2.5 py-1" : "px-4 py-1.5",
              subtle ? "rounded-md" : "rounded-lg",
              size === "md" ? "text-sm" : size === "xs" ? "text-[11px]" : "text-xs",
              fill && "flex-1",
              on ? (subtle ? "bg-bg-card text-text-primary shadow-sm" : "bg-accent-blue text-white shadow")
                 : "text-text-muted hover:text-text-primary",
            )}
          >
            {Icon && <Icon size={11} className="flex-shrink-0" />}
            {t.label}
            {t.count != null && <span className="text-[10px] opacity-70">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** 밑줄형 탭 — 같은 종류의 목록을 나눠 볼 때 (폴더, 포트폴리오)
 *
 * 개수가 많아 가로로 넘칠 수 있으므로 스크롤을 전제로 한다. */
export function UnderlineTabs({ tabs, active, onChange, className, ariaLabel }: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div role="tablist" aria-label={ariaLabel}
      className={cn("flex border-b border-border bg-bg-card rounded-t-xl overflow-x-auto scrollbar-hide", className)}>
      {tabs.map((t) => {
        const on = active === t.id;
        const Icon = t.icon;
        return (
          <button key={t.id} role="tab" aria-selected={on} onClick={() => onChange(t.id)}
            className={cn(
              "flex items-center gap-1 flex-shrink-0 whitespace-nowrap px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-all",
              on ? "border-accent-blue text-accent-blue bg-accent-blue/5"
                 : "border-transparent text-text-muted hover:text-text-primary hover:bg-bg-elevated",
            )}
          >
            {Icon && <Icon size={13} className="flex-shrink-0" />}
            {t.label}
            {t.count != null && <span className="text-[10px] opacity-70">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ── 버튼 ──────────────────────────────────────────────── */
export function Button({ children, variant = "primary", size = "md", className, ...p }: {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const vMap = {
    primary:   "bg-accent-blue hover:bg-blue-600 text-white",
    secondary: "bg-bg-elevated border border-border text-text-primary hover:border-accent-blue",
    ghost:     "text-text-muted hover:text-text-primary hover:bg-bg-elevated",
    danger:    "bg-red-600/20 border border-red-700/50 text-accent-red hover:bg-red-600/30",
  };
  const sMap = { sm: "px-3 py-1 text-xs", md: "px-4 py-2 text-sm", lg: "px-6 py-2.5 text-sm" };
  return (
    <button {...p} className={cn("font-semibold rounded-lg transition-colors disabled:opacity-40", vMap[variant], sMap[size], className)}>
      {children}
    </button>
  );
}

/* ── 범위 필터 입력 ────────────────────────────────────── */
export function RangeFilter({ label, filterKey, filters, onChange }: {
  label: string; filterKey: string; filters: Record<string, any>;
  onChange: (k: string, v: { min?: number; max?: number }) => void;
}) {
  const c = filters[filterKey] ?? {};
  const inp = "w-full bg-bg-primary border border-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-blue transition-colors";
  return (
    <div className="flex flex-col gap-1">
      <label className="text-2xs font-semibold text-text-muted">{label}</label>
      <div className="flex gap-1.5 items-center">
        <input type="number" placeholder="최소" className={inp} value={c.min ?? ""}
          onChange={(e) => onChange(filterKey, { ...c, min: e.target.value !== "" ? +e.target.value : undefined })} />
        <span className="text-text-dim text-xs">~</span>
        <input type="number" placeholder="최대" className={inp} value={c.max ?? ""}
          onChange={(e) => onChange(filterKey, { ...c, max: e.target.value !== "" ? +e.target.value : undefined })} />
      </div>
    </div>
  );
}

/* ── 용어 힌트 ─────────────────────────────────────────
   PER·ROE·샤프 비율 같은 이름 옆에 물음표를 두고, 누르면 한 줄 설명을 편다.

   마우스를 올리면 뜨는 방식으로 하지 않았다. 이 앱은 절반 이상이 손가락으로
   보는데, 손가락에는 '올려두기'가 없다. 눌러야 뜬다.

   설명이 없는 이름에는 물음표를 아예 안 붙인다. 그래야 StatCell 처럼 이름이
   스물다섯 가지로 들어오는 자리에 그냥 끼워도 안전하다.

   자리 잡기는 열 때 화면 좌표를 재서 고정 위치로 띄운다. 지표는 표 안이나
   가로로 넘치는 칸 안에 있어서, 부모에 붙여 놓으면 잘리거나 스크롤을 만든다. */
export function 용어힌트({ 이름, className, 글자숨김 }: {
  이름: string;
  className?: string;
  /** 물음표만 그린다. 이름이 이미 다른 버튼(예: 정렬) 안에 들어 있을 때 쓴다 —
      버튼 안에 버튼을 넣으면 눌리는 곳이 겹치고 화면 읽어주는 프로그램도 헷갈린다 */
  글자숨김?: boolean;
}) {
  const [열림, set열림] = React.useState(false);
  const [자리, set자리] = React.useState<{ top: number; left: number } | null>(null);
  const 버튼 = React.useRef<HTMLButtonElement>(null);
  const 뜻 = 용어사전[이름];

  /** 버튼 위치를 다시 재서 설명 상자를 그 아래(또는 위)에 맞춘다 */
  const 자리잡기 = React.useCallback(() => {
    const el = 버튼.current;
    if (!el) return false;
    const r = el.getBoundingClientRect();
    // 버튼이 화면 밖으로 나갔으면 붙어 있을 곳이 없다
    if (r.bottom < 0 || r.top > window.innerHeight) return false;
    const 너비 = Math.min(280, window.innerWidth - 24);
    // 좌우가 화면 밖으로 나가지 않게 가둔다
    const left = Math.max(12, Math.min(r.left, window.innerWidth - 너비 - 12));
    // 아래가 좁으면 위로 띄운다
    const 아래여유 = window.innerHeight - r.bottom;
    const top = 아래여유 < 180 ? Math.max(12, r.top - 168) : r.bottom + 8;
    set자리({ top, left });
    return true;
  }, []);

  const 열기 = React.useCallback(() => {
    if (자리잡기()) set열림(true);
  }, [자리잡기]);

  React.useEffect(() => {
    if (!열림) return;
    /* 스크롤할 때 닫지 않는다.
       처음에는 '자리가 어긋나니 닫자'로 했는데, 실제 휴대폰 폭에서 눌러 보니
       누르는 순간 화면이 살짝 밀리면서 곧바로 닫혀 아무 일도 안 일어난 것처럼
       보였다. 사용자에게는 '눌러도 안 뜨는 버튼'이다.
       닫는 대신 다시 재서 따라 움직이고, 버튼이 화면 밖으로 나갔을 때만 닫는다. */
    const 따라가기 = () => { if (!자리잡기()) set열림(false); };
    const 키 = (e: KeyboardEvent) => { if (e.key === "Escape") { set열림(false); 버튼.current?.focus(); } };
    window.addEventListener("scroll", 따라가기, true);
    window.addEventListener("resize", 따라가기);
    window.addEventListener("keydown", 키);
    return () => {
      window.removeEventListener("scroll", 따라가기, true);
      window.removeEventListener("resize", 따라가기);
      window.removeEventListener("keydown", 키);
    };
  }, [열림, 자리잡기]);

  if (!뜻) return 글자숨김 ? null : <>{이름}</>;

  return (
    <>
      <span className={cn("inline-flex items-center gap-1", className)}>
        {!글자숨김 && 이름}
        <button
          ref={버튼}
          type="button"
          onClick={(e) => { e.stopPropagation(); 열림 ? set열림(false) : 열기(); }}
          aria-expanded={열림}
          aria-label={`${이름} 설명`}
          className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-current
                     text-[9px] leading-none font-bold opacity-50 hover:opacity-100 focus:opacity-100
                     focus:outline-none focus:ring-1 focus:ring-accent-blue transition-opacity"
        >
          ?
        </button>
      </span>
      {열림 && 자리 && (
        <>
          {/* 바깥을 눌러도 닫히게 — 화면 전체를 덮되 보이지는 않는다 */}
          <div className="fixed inset-0 z-[60]" onClick={() => set열림(false)} />
          <div
            role="tooltip"
            style={{ top: 자리.top, left: 자리.left, width: Math.min(280, window.innerWidth - 24) }}
            className="fixed z-[61] rounded-xl border border-border bg-bg-card shadow-2xl p-3
                       flex flex-col gap-1.5 text-left normal-case tracking-normal"
          >
            <p className="text-xs font-bold text-text-primary break-keep">
              {이름}{뜻.이름 && <span className="font-medium text-text-muted"> · {뜻.이름}</span>}
            </p>
            {/* 뜻만 보여준다. '얼마면 좋다'는 업종마다 기업마다 달라
                한 줄로 못 박을 수 없어 아예 넣지 않는다 */}
            <p className="text-xs text-text-secondary break-keep leading-relaxed font-normal">{뜻.뜻}</p>
          </div>
        </>
      )}
    </>
  );
}

/* ── 빈 화면 ───────────────────────────────────────────
   '아직 게시글이 없어요' 에서 끝나면 막다른 길이다. 처음 온 사람은 거기서
   뒤로 가기를 누른다. 무엇을 하면 채워지는지와, 그리로 가는 버튼까지 줘야
   비로소 안내다.

   전략저장소에 이미 이 모양이 있었다(아이콘·설명·버튼). 그걸 부품으로 꺼내
   나머지 빈 화면에도 같은 대접을 한다. */
export function 빈화면({ icon: Icon, title, hint, action, compact }: {
  /* lucide 아이콘은 forwardRef 로 감싸여 있어 좁게 잡으면 안 들어온다.
     이 자리에 오는 건 항상 lucide 아이콘이므로 그쪽 타입에 맞춘다 */
  icon: LucideIcon;
  title: string;
  /** 무엇을 하면 채워지는지 */
  hint?: string;
  /** 그리로 가는 버튼. 없으면 안내만 한다 */
  action?: { label: string; onClick: () => void };
  /** 목록 안에 끼워 넣는 작은 자리용 */
  compact?: boolean;
}) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center text-center gap-3",
      compact ? "py-8" : "py-16",
    )}>
      <div className={cn(
        "rounded-full bg-bg-elevated flex items-center justify-center",
        compact ? "w-12 h-12" : "w-16 h-16",
      )}>
        <Icon size={compact ? 20 : 28} className="text-text-muted" />
      </div>
      <div className="flex flex-col gap-1">
        <p className={cn("font-semibold text-text-primary break-keep", compact ? "text-sm" : "text-base")}>
          {title}
        </p>
        {hint && <p className="text-xs text-text-muted break-keep max-w-[18rem]">{hint}</p>}
      </div>
      {action && (
        <Button size={compact ? "sm" : "md"} onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/* ── 아래에서 올라오는 시트 ─────────────────────────────
   휴대폰에서 목록을 띄울 때 쓴다. 새 화면으로 넘어가지 않으므로 보던
   자리를 잃지 않고, 닫으면 그대로 돌아온다.

   알림창이 쓰던 마크업을 그대로 꺼냈다. 댓글도 같은 방식으로 띄우면서
   두 곳이 같은 모양이 되도록 한 곳에 모았다. */
export function 시트({ 열림, 닫기, 제목, children, 꼬리 }: {
  열림: boolean;
  닫기: () => void;
  제목?: React.ReactNode;
  children: React.ReactNode;
  /** 시트 맨 아래에 붙는 것 (댓글 입력칸 등). 목록과 함께 스크롤되지 않는다 */
  꼬리?: React.ReactNode;
}) {
  // 시트가 열린 동안 뒤 화면이 스크롤되지 않게 한다
  React.useEffect(() => {
    if (!열림) return;
    const 원래 = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const 키 = (e: KeyboardEvent) => { if (e.key === "Escape") 닫기(); };
    window.addEventListener("keydown", 키);
    return () => {
      document.body.style.overflow = 원래;
      window.removeEventListener("keydown", 키);
    };
  }, [열림, 닫기]);

  if (!열림) return null;
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm modal-backdrop"
           onClick={닫기} aria-hidden />
      <div
        role="dialog" aria-modal="true"
        className="fixed inset-x-0 bottom-0 z-50 bg-bg-card border-t border-border
                   rounded-t-2xl shadow-2xl flex flex-col modal-pop"
        // 화면의 85%까지만 차지하고, 아이폰 홈 인디케이터 영역을 피한다
        style={{ maxHeight: "85vh", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* 손잡이 — 아래에서 올라온 시트라는 걸 알려준다 */}
        <div className="pt-2 pb-1 flex justify-center shrink-0">
          <span className="w-9 h-1 rounded-full bg-border" aria-hidden />
        </div>
        {제목 && (
          <div className="shrink-0 flex items-center justify-between gap-2 px-4 pb-2 border-b border-border">
            <span className="text-sm font-bold text-text-primary">{제목}</span>
            <button onClick={닫기} aria-label="닫기"
              className="p-1 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-elevated">
              ✕
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {꼬리 && <div className="shrink-0 border-t border-border">{꼬리}</div>}
      </div>
    </>
  );
}

/* ── 숫자 포맷 ─────────────────────────────────────────── */
export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n == null) return "—";
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + "조";
  if (Math.abs(n) >= 1e8)  return (n / 1e8).toFixed(1) + "억";
  if (Math.abs(n) >= 1e4)  return (n / 1e4).toFixed(1) + "만";
  return n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
}

export function fmtPct(v: number | null | undefined) {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export { ErrorToast } from "./Toast";
export { Toast } from "./Toast";
export { default as ConfirmDialog } from "./ConfirmDialog";
