/**
 * 서버 자원·백그라운드 상태.
 *
 * 이 화면이 없어서, 메모리 한도 초과나 백그라운드 루프 중단 같은 문제를
 * Render 알림 메일이나 사용자 제보로 뒤늦게 알았다. 지금 무엇이 돌고 있고
 * 자원을 얼마나 쓰는지 한곳에서 보이게 한다.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Activity, Cpu, HardDrive, RefreshCw, Newspaper, Radio,
  AlertTriangle, CheckCircle2, PauseCircle,
} from "lucide-react";
import api from "@/api/client";

interface Runtime {
  memory: {
    used_mb: number | null; limit_mb: number; percent: number | null;
    cache_mb: number; cache_limit_mb: number; cache_items: number; cache_packed: number;
  };
  cpu: { quota: number; reported: number; news_workers: number };
  tasks: { name: string; running: boolean; error: string | null }[];
  market: { kr_label: string; us_label: string; price_interval_sec: number };
  watched: { symbols: number; connections: number };
  idle: { seconds: number; paused: boolean; pause_after_sec: number };
  news: {
    kr_feeds: number; us_feeds: number; batch: number;
    kr_cached: number; us_cached: number; kr_sources: string[];
  };
  heavy_prefetch: boolean;
  server_time: string;
}

const TASK_LABEL: Record<string, string> = {
  "periodic-refresh": "주기 갱신 (지수·뉴스)",
  "watched-prices":   "실시간 시세",
  "startup-prefetch": "시작 시 초기 수집",
};

/** 사용률에 따라 색을 바꾼다 — 숫자만 보면 위험한지 알기 어렵다 */
function level(pct: number) {
  return pct >= 85 ? { bar: "bg-accent-red", text: "text-accent-red" }
       : pct >= 70 ? { bar: "bg-accent-amber", text: "text-accent-amber" }
       :             { bar: "bg-accent-green", text: "text-accent-green" };
}

function Bar({ label, used, limit, unit = "MB", hint }: {
  label: string; used: number | null; limit: number; unit?: string; hint?: string;
}) {
  const pct = used == null ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const c = level(pct);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-2xs text-text-muted break-keep">{label}</span>
        <span className={`text-xs font-mono font-semibold ${c.text}`}>
          {used == null ? "—" : `${used.toLocaleString()}`}
          <span className="text-text-dim font-normal"> / {limit.toLocaleString()}{unit}</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden">
        <div className={`h-full rounded-full transition-all ${c.bar}`} style={{ width: `${pct}%` }} />
      </div>
      {hint && <span className="text-[10px] text-text-dim break-keep">{hint}</span>}
    </div>
  );
}

export default function RuntimePanel() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<Runtime>({
    queryKey: ["admin-runtime"],
    queryFn: () => api.get("/admin/runtime").then((r) => r.data),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    // 없는 엔드포인트를 계속 재시도하면 '불러오는 중'에서 영영 멈춘 것처럼 보인다.
    // 프런트가 백엔드보다 먼저 배포되면 실제로 이 상태가 된다.
    retry: 1,
  });

  if (isError) {
    const 없음 = (error as any)?.response?.status === 404;
    return (
      <div className="rounded-xl border border-border bg-bg-card p-4 flex items-center gap-2">
        <AlertTriangle size={14} className="text-accent-amber shrink-0" />
        <p className="flex-1 text-xs text-text-muted break-keep">
          {없음
            ? "서버가 아직 이 기능을 모릅니다. 백엔드 배포가 끝나면 표시됩니다."
            : "서버 상태를 불러오지 못했습니다."}
        </p>
        <button onClick={() => refetch()}
          className="px-2.5 py-1.5 rounded-lg border border-border text-2xs text-text-muted hover:text-accent-blue transition-all">
          다시 시도
        </button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="rounded-xl border border-border bg-bg-card p-4">
        <p className="text-xs text-text-dim">서버 상태 불러오는 중…</p>
      </div>
    );
  }

  const 죽은작업 = data.tasks.filter((t) => !t.running && t.name !== "startup-prefetch");
  const 메모리위험 = (data.memory.percent ?? 0) >= 85;

  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
          <Activity size={14} className="text-accent-blue" />서버 상태
        </span>
        <button onClick={() => refetch()} aria-label="새로고침"
          className="text-text-muted hover:text-text-primary transition-colors p-1 rounded">
          <RefreshCw size={13} className={isFetching ? "animate-spin" : ""} />
        </button>
      </div>

      {/* 문제가 있으면 맨 위에 크게 — 숫자를 뒤져야 알 수 있으면 안 본다 */}
      {(메모리위험 || 죽은작업.length > 0) && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg bg-accent-red/10 border border-accent-red/30">
          <AlertTriangle size={14} className="text-accent-red shrink-0 mt-0.5" />
          <div className="text-2xs text-accent-red break-keep leading-relaxed">
            {메모리위험 && <p>메모리 사용량이 {data.memory.percent}%입니다. 한도를 넘으면 서버가 강제 재시작됩니다.</p>}
            {죽은작업.map((t) => (
              <p key={t.name}>
                {TASK_LABEL[t.name] ?? t.name}이(가) 멈췄습니다{t.error ? ` — ${t.error}` : ""}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Bar label="메모리" used={data.memory.used_mb} limit={data.memory.limit_mb}
             hint={`캐시 ${data.memory.cache_mb}MB / ${data.memory.cache_limit_mb}MB · ${data.memory.cache_items.toLocaleString()}건(압축 ${data.memory.cache_packed})`} />
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-2xs text-text-muted flex items-center gap-1"><Cpu size={11} />CPU 할당량</span>
            <span className="text-xs font-mono font-semibold text-text-primary">{data.cpu.quota}개</span>
          </div>
          <span className="text-[10px] text-text-dim break-keep">
            작업 스레드 {data.cpu.news_workers}개
            {data.cpu.reported !== Math.round(data.cpu.quota) &&
              ` · 호스트는 ${data.cpu.reported}개로 보고하지만 실제 할당량 기준으로 맞춤`}
          </span>
        </div>
      </div>

      {/* 백그라운드 루프 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs font-semibold text-text-muted">백그라운드 작업</span>
        {data.tasks.map((t) => (
          <div key={t.name} className="flex items-center justify-between gap-2 py-1 border-b border-border/40 last:border-b-0">
            <span className="text-xs text-text-secondary break-keep">{TASK_LABEL[t.name] ?? t.name}</span>
            {t.running ? (
              <span className="flex items-center gap-1 text-2xs text-accent-green shrink-0">
                <CheckCircle2 size={11} />동작 중
              </span>
            ) : (
              <span className="flex items-center gap-1 text-2xs text-text-dim shrink-0" title={t.error ?? ""}>
                {t.name === "startup-prefetch"
                  ? <>완료</>
                  : <><AlertTriangle size={11} className="text-accent-red" /><span className="text-accent-red">멈춤</span></>}
              </span>
            )}
          </div>
        ))}
        {data.idle.paused && (
          <div className="flex items-center gap-1.5 text-2xs text-text-dim mt-1">
            <PauseCircle size={11} />
            <span className="break-keep">
              {Math.round(data.idle.seconds / 60)}분간 접속이 없어 주기 갱신을 쉬는 중 (접속하면 자동 재개)
            </span>
          </div>
        )}
      </div>

      {/* 실시간 시세 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs font-semibold text-text-muted flex items-center gap-1">
          <Radio size={11} />실시간 시세
        </span>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { v: `${data.watched.symbols}`, l: "갱신 중 종목" },
            { v: `${data.watched.connections}`, l: "보는 화면" },
            { v: `${data.market.price_interval_sec}초`, l: "갱신 주기" },
          ].map((x) => (
            <div key={x.l} className="rounded-lg bg-bg-elevated py-2">
              <p className="text-sm font-bold text-text-primary font-mono">{x.v}</p>
              <p className="text-[10px] text-text-dim break-keep">{x.l}</p>
            </div>
          ))}
        </div>
        <span className="text-[10px] text-text-dim">
          국내 {data.market.kr_label} · 미국 {data.market.us_label}
        </span>
      </div>

      {/* 뉴스 */}
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs font-semibold text-text-muted flex items-center gap-1">
          <Newspaper size={11} />뉴스 수집
        </span>
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-secondary">국내 {data.news.kr_cached.toLocaleString()}건</span>
          <span className="text-text-secondary">미국 {data.news.us_cached.toLocaleString()}건</span>
        </div>
        <span className="text-[10px] text-text-dim break-keep">
          언론사 {data.news.kr_sources.length}/{data.news.kr_feeds}곳 수집됨 ·
          회차당 {data.news.batch}곳씩 번갈아 가져옴
          {data.news.kr_sources.length > 0 && data.news.kr_sources.length < 5 &&
            " — 너무 적으면 CPU 부족이나 피드 차단을 의심"}
        </span>
        {data.news.kr_sources.length > 0 && (
          <p className="text-[10px] text-text-dim break-keep leading-relaxed">
            {data.news.kr_sources.slice(0, 12).join(", ")}
            {data.news.kr_sources.length > 12 && ` 외 ${data.news.kr_sources.length - 12}곳`}
          </p>
        )}
      </div>

      {!data.heavy_prefetch && (
        <p className="text-[10px] text-text-dim break-keep flex items-start gap-1">
          <HardDrive size={11} className="shrink-0 mt-0.5" />
          차트 선제 캐싱은 꺼져 있습니다 (메모리 절약). 큰 인스턴스로 옮기면
          ENABLE_HEAVY_PREFETCH=1 로 켤 수 있습니다.
        </p>
      )}
    </div>
  );
}
