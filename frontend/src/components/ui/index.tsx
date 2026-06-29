import React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useSettingsStore } from "@/store/settingsStore";

export function cn(...i: ClassValue[]) { return twMerge(clsx(i)); }

/* ── Card ──────────────────────────────────────────────── */
export function Card({ children, className, onClick }: {
  children: React.ReactNode; className?: string; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "bg-bg-card border border-border rounded-xl shadow-card",
        !className?.includes("p-0") && "p-4",
        onClick && "cursor-pointer hover:border-accent-blue/40 transition-colors",
        className,
      )}
    >{children}</div>
  );
}

/* ── 등락 배지 (설정의 색상 테마 적용) ───────────────────── */
export function ChangeBadge({ value, suffix = "%", className }: {
  value: number; suffix?: string; className?: string;
}) {
  const { colorScheme } = useSettingsStore();
  const pos = value >= 0;
  const color = pos
    ? (colorScheme === "red-blue" ? "text-accent-red"  : "text-accent-green")
    : (colorScheme === "red-blue" ? "text-accent-blue" : "text-accent-red");
  return (
    <span className={cn("font-mono font-semibold num", color, className)}>
      {pos ? "+" : ""}{value.toFixed(2)}{suffix}
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
export function Tabs({ tabs, active, onChange }: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex gap-0.5 p-1 bg-bg-card border border-border rounded-xl">
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onChange(t.id)}
          className={cn("flex-1 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all",
            active === t.id ? "bg-accent-blue text-white shadow" : "text-text-muted hover:text-text-primary"
          )}
        >{t.label}</button>
      ))}
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
