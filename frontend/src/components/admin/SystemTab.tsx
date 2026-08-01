/**
 * 시스템 탭 — 서버 자원, 백그라운드 작업, 외부 데이터 소스, DB 용량.
 *
 * 이 화면이 없어서 문제를 매번 뒤늦게 알았다. 메모리 한도 초과는 Render 알림
 * 메일로, 뉴스가 한 언론사만 나오는 것은 사용자 제보로, 백그라운드 스케줄러가
 * 아예 안 돌던 것은 몇 주가 지나서야 알았다. 셋 다 서버는 '정상'으로 보였다.
 *
 * 그래서 여기서는 '동작 중'이라는 말만 하지 않는다. 마지막으로 성공한 게
 * 언제인지, 몇 번 실패했는지, 왜 실패했는지까지 보여준다.
 */
import { useQuery } from "@tanstack/react-query";
import {
  Activity, Cpu, HardDrive, RefreshCw, Newspaper, Radio, Database,
  AlertTriangle, CheckCircle2, PauseCircle, Clock, Wifi, Layers,
  Package, Boxes,
} from "lucide-react";
import api from "@/api/client";

interface HealthItem {
  name: string; ok: number; fail: number; success_pct: number | null;
  last_ok_sec: number | null; last_fail_sec: number | null;
  last_error: string | null; last_ms: number | null; detail: string | null;
}
interface Runtime {
  memory: {
    used_mb: number | null; limit_mb: number; percent: number | null;
    cache_mb: number; cache_limit_mb: number; cache_items: number; cache_packed: number;
    /* 만료된 값 보관분 — 이 몫이 보고에서 빠져 있어 누수를 오래 못 찾았다 */
    cache_fresh_mb?: number; cache_stale_mb?: number; cache_stale_items?: number;
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
  health: HealthItem[];
  proc?: {
    rss_mb: number; pss_mb: number; code_shared_mb: number;
    private_dirty_mb: number; private_clean_mb: number;
  } | null;
  objects?: {
    total: number; blocks: number; threads: number;
    gc_counts: number[]; top: { name: string; count: number }[];
  };
  alloc_growth?: {
    enabled: boolean; ready: boolean; span_min: number;
    items: { where: string; grew_kb: number; now_kb: number; count_diff: number }[];
  };
  mem_trend?: {
    samples: number; points: number[]; first_mb?: number; last_mb?: number;
    min_mb?: number; max_mb?: number; per_hour_mb: number | null; span_min: number;
  };
  libraries: {
    tracked: boolean;
    items: { name: string; mb: number; total_mb: number; purpose: string }[];
    measured_mb: number; other_count: number; other_mb: number;
    baseline_mb: number | null;
    preloaded: { name: string; purpose: string }[];
    stubbed?: { name: string; note: string }[];
    modules: number;
  };
  data_stores: {
    name: string; items: number; mb: number; what: string; movable: boolean;
  }[];
  kr_tickers?: {
    source: string; count: number; age_sec: number | null;
    builtin_count: number; degraded: boolean; prices: number; ttl_sec: number;
    db_rows?: number | null; db_error?: string | null;
  };
  cache_breakdown: { prefix: string; items: number; mb: number }[];
  websocket: { connections: number; limit_per_ip: number };
  uptime_sec: number;
  heavy_prefetch: boolean;
  server_time: string;
}

const TASK_LABEL: Record<string, string> = {
  "periodic-refresh": "주기 갱신 (지수·뉴스)",
  "watched-prices":   "실시간 시세",
  "startup-prefetch": "시작 시 초기 수집",
};
/** 캐시 키 접두사가 무엇인지 사람 말로 */
const PREFIX_LABEL: Record<string, string> = {
  price: "종목 시세", ohlcv: "차트 데이터", idx_ohlcv: "지수 차트",
  news: "뉴스", idx: "지수", fund: "재무 지표", rank: "순위",
  extra: "환율·금리", search: "검색 결과", quant: "퀀트 점수",
};

function 초를사람말로(s: number | null): string {
  if (s == null) return "없음";
  if (s < 60) return `${s}초 전`;
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
}
function 기간(s: number): string {
  if (s < 60) return `${s}초`;
  if (s < 3600) return `${Math.floor(s / 60)}분`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
  return `${Math.floor(s / 86400)}일 ${Math.floor((s % 86400) / 3600)}시간`;
}
/** 메모리 추이 스파크라인의 막대 높이(%).
 *
 * 눈금을 min~max 에 딱 맞추면 240→246MB 같은 잔물결도 바닥에서 천장까지
 * 치솟은 것처럼 보인다. 512MB 짜리 프로세스에서 6MB 흔들림은 작게 보여야
 * 한다 — 그래서 눈금 폭에 하한(10MB 또는 최대값의 5% 중 큰 쪽)을 둔다. */
export function 추이막대높이(v: number, min: number, max: number): number {
  const 폭 = Math.max(max - min, 10, max * 0.05);
  const 바닥 = max - 폭;
  return Math.min(100, Math.max(8, ((v - 바닥) / 폭) * 100));
}

/** 기울기를 '누수'라고 말해도 되는 시점.
 *
 * 서버가 막 뜬 직후에는 RSS 가 원래 오른다 — 캐시가 차고 스레드가 생기는
 * 과정이다. 그걸 보고 경고를 띄우면 재시작할 때마다 거짓 경보가 된다. */
export const 추이_판단_최소_분 = 30;

function level(pct: number) {
  return pct >= 85 ? { bar: "bg-accent-red", text: "text-accent-red" }
       : pct >= 70 ? { bar: "bg-accent-amber", text: "text-accent-amber" }
       :             { bar: "bg-accent-green", text: "text-accent-green" };
}

function Bar({ label, used, limit, unit = "MB", hint, big }: {
  label: string; used: number | null; limit: number; unit?: string; hint?: string; big?: boolean;
}) {
  const pct = used == null ? 0 : Math.min(100, (used / limit) * 100);
  const c = level(pct);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-text-muted break-keep">{label}</span>
        <span className={`font-mono font-bold ${big ? "text-lg" : "text-xs"} ${c.text}`}>
          {used == null ? "—" : used.toLocaleString()}
          <span className="text-text-dim font-normal text-xs"> / {limit.toLocaleString()}{unit}</span>
          <span className="text-text-dim font-normal text-2xs ml-1.5">({pct.toFixed(0)}%)</span>
        </span>
      </div>
      <div className={`${big ? "h-2.5" : "h-1.5"} rounded-full bg-bg-elevated overflow-hidden`}>
        <div className={`h-full rounded-full transition-all ${c.bar}`} style={{ width: `${pct}%` }} />
      </div>
      {hint && <span className="text-2xs text-text-dim break-keep">{hint}</span>}
    </div>
  );
}

function Card({ icon: Icon, title, right, children }: {
  icon: any; title: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
          <Icon size={14} className="text-accent-blue" />{title}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}

export default function SystemTab() {
  const rt = useQuery<Runtime>({
    queryKey: ["admin-runtime"],
    queryFn: () => api.get("/admin/runtime").then((r) => r.data),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const db = useQuery({
    queryKey: ["admin-db-stats"],
    queryFn: () => api.get("/admin/db-stats").then((r) => r.data),
    staleTime: 60_000,
  });

  if (rt.isError) {
    const 없음 = (rt.error as any)?.response?.status === 404;
    return (
      <div className="rounded-xl border border-border bg-bg-card p-4 flex items-center gap-2">
        <AlertTriangle size={14} className="text-accent-amber shrink-0" />
        <p className="flex-1 text-xs text-text-muted break-keep">
          {없음 ? "서버가 아직 이 기능을 모릅니다. 백엔드 배포가 끝나면 표시됩니다."
                : "서버 상태를 불러오지 못했습니다."}
        </p>
        <button onClick={() => rt.refetch()}
          className="px-2.5 py-1.5 rounded-lg border border-border text-2xs text-text-muted hover:text-accent-blue transition-all">
          다시 시도
        </button>
      </div>
    );
  }
  if (rt.isLoading || !rt.data) {
    return <div className="rounded-xl border border-border bg-bg-card p-4">
      <p className="text-xs text-text-dim">서버 상태 불러오는 중…</p></div>;
  }

  const d = rt.data;
  const 죽은작업 = d.tasks.filter((t) => !t.running && t.name !== "startup-prefetch");
  const 메모리위험 = (d.memory.percent ?? 0) >= 85;
  const 실패중 = d.health.filter((h) => h.fail > 0 && (h.success_pct ?? 100) < 50 && !h.name.startsWith("뉴스:"));
  const 실패언론사 = d.health.filter((h) => h.name.startsWith("뉴스:") && h.fail > 0);

  const DB_LIMIT_MB = 500;
  const dbUsedMb = (db.data?.total_bytes ?? 0) / 1024 / 1024;

  // 오랫동안 '나머지 약 411MB' 한 줄이었던 것을 실제 측정값으로 쪼갠다.
  // 라이브러리 값은 각자가 처음 로드될 때 늘어난 메모리를 직접 잰 것이라,
  // 항목을 다 더하면 measured_mb 가 되고 중복해서 세지 않는다.
  const 라이브러리 = d.libraries;
  const 상주데이터 = (d.data_stores ?? []).filter((s) => s.name !== "응답 캐시");
  const 라이브러리MB = 라이브러리?.measured_mb ?? 0;
  const 데이터MB = Math.round(상주데이터.reduce((a, s) => a + s.mb, 0) * 10) / 10;
  const 나머지MB = Math.max(
    0,
    Math.round(((d.memory.used_mb ?? 0) - d.memory.cache_mb - 라이브러리MB - 데이터MB) * 10) / 10,
  );
  const 최대라이브러리 = Math.max(1, ...(라이브러리?.items ?? []).map((i) => i.mb));
  const 최대데이터 = Math.max(0.01, ...상주데이터.map((s) => s.mb));

  // 종목 목록이 내장 폴백으로 떨어졌는지 — 이건 메모리보다 급한 문제다.
  // 그 상태에서는 내장 목록에 없는 종목이 검색도 시세 조회도 되지 않는다
  const 종목 = d.kr_tickers;
  const 종목축소 = 종목?.degraded === true;
  // 저장이 안 되면 재시작마다 밖으로 나가고, 그때마다 무거운 라이브러리를 문다.
  // 프로덕션에서 이걸 화면으로 확인할 방법이 없어 저장 실패를 의심만 했다
  const 종목저장실패 = !!종목?.db_error || (종목 != null && 종목.db_rows === 0);

  return (
    <div className="flex flex-col gap-4">

      {/* ── 문제가 있으면 맨 위에 크게 ── */}
      {(메모리위험 || 종목축소 || 종목저장실패 || 죽은작업.length > 0 || 실패중.length > 0) && (
        <div className="rounded-xl border border-accent-red/40 bg-accent-red/10 p-4 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-accent-red shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 text-xs text-accent-red break-keep leading-relaxed">
            {종목축소 && (
              <p>
                <b>국내 종목이 {종목!.count}개뿐입니다</b> (출처: {종목!.source}) — 외부 조회가 실패해
                내장 목록으로 동작 중입니다. 이 목록에 없는 종목은 검색·시세 조회가 되지 않습니다.
              </p>
            )}
            {종목저장실패 && (
              <p>
                <b>종목 목록이 DB에 저장되지 않았습니다</b> — {종목!.db_error} · 재시작마다 외부에서
                다시 받아오게 되고, 그때마다 라이브러리가 메모리를 더 씁니다.
              </p>
            )}
            {메모리위험 && <p><b>메모리 {d.memory.percent}%</b> — 한도를 넘으면 서버가 강제 재시작됩니다.</p>}
            {죽은작업.map((t) => (
              <p key={t.name}><b>{TASK_LABEL[t.name] ?? t.name}</b>이(가) 멈췄습니다{t.error ? ` — ${t.error}` : ""}</p>
            ))}
            {실패중.map((h) => (
              <p key={h.name}><b>{h.name}</b> 실패율 {100 - (h.success_pct ?? 0)}% — {h.last_error}</p>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ── 자원 ── */}
        <Card icon={Activity} title="서버 자원" right={
          <button onClick={() => rt.refetch()} aria-label="새로고침"
            className="text-text-muted hover:text-text-primary p-1 rounded">
            <RefreshCw size={13} className={rt.isFetching ? "animate-spin" : ""} />
          </button>
        }>
          <Bar big label="메모리" used={d.memory.used_mb} limit={d.memory.limit_mb} />

          {/* 메모리가 무엇으로 채워졌는지 — 캐시만 보면 오해한다.
              자세한 내역은 아래 '메모리를 쓰는 것들' 카드에 있다 */}
          <div className="rounded-lg bg-bg-elevated p-2.5 flex flex-col gap-1">
            <p className="text-2xs font-semibold text-text-muted">메모리 구성</p>
            {[
              ["라이브러리", `${라이브러리MB}MB`, `${라이브러리?.items.length ?? 0}개 측정`],
              ["상주 데이터 (종목DB 등)", `${데이터MB}MB`, `${상주데이터.length}종`],
              ["응답 캐시", `${d.memory.cache_mb}MB`,
                d.memory.cache_stale_mb != null
                  ? `신선 ${d.memory.cache_fresh_mb}MB + 만료보관 ${d.memory.cache_stale_mb}MB`
                  : `한도 ${d.memory.cache_limit_mb}MB`],
              ["파이썬 자체·기타", `${나머지MB}MB`,
                라이브러리?.baseline_mb ? `인터프리터 ${라이브러리.baseline_mb}MB 포함` : ""],
            ].map(([k, v, sub]) => (
              <div key={k} className="flex items-baseline justify-between gap-2 text-2xs">
                <span className="text-text-dim break-keep">{k}</span>
                <span className="font-mono text-text-secondary shrink-0">
                  {v}
                  {sub && <span className="text-text-dim font-normal ml-1.5">({sub})</span>}
                </span>
              </div>
            ))}
            <p className="text-[10px] text-text-dim break-keep mt-0.5">
              캐시를 0으로 만들어도 라이브러리는 줄지 않습니다 — 줄이려면 그 기능을 빼야 합니다
            </p>
          </div>

          {/* '파이썬 자체·기타'가 무엇인지 커널에게 직접 물어본 값.
              추정이 아니라 /proc/self/smaps_rollup 에 적힌 숫자다 */}
          {d.proc && (
            <div className="rounded-lg bg-bg-elevated p-2.5 flex flex-col gap-1">
              <p className="text-2xs font-semibold text-text-muted">실제 구성 (커널 보고)</p>
              {[
                ["라이브러리 코드 (공유)", `${d.proc.code_shared_mb}MB`,
                 "디스크에서 매핑된 .so — 줄일 수 없고 다른 프로세스와 나눠 씁니다"],
                ["이 프로세스 전용 데이터", `${d.proc.private_dirty_mb}MB`,
                 "파이썬 객체·힙 — 실제로 우리가 쓰는 부분입니다"],
                ["공정 분담분 (PSS)", `${d.proc.pss_mb}MB`,
                 "공유분을 프로세스 수로 나눈 값 — 과금 기준에 가깝습니다"],
              ].map(([k, v, why]) => (
                <div key={k} className="flex flex-col">
                  <div className="flex items-baseline justify-between gap-2 text-2xs">
                    <span className="text-text-dim break-keep">{k}</span>
                    <span className="font-mono text-text-secondary shrink-0">{v}</span>
                  </div>
                  <span className="text-[10px] text-text-dim break-keep">{why}</span>
                </div>
              ))}
              {d.objects && (
                <p className="text-[10px] text-text-dim break-keep mt-0.5 pt-1 border-t border-border/30">
                  파이썬 객체 {d.objects.total.toLocaleString()}개 · 스레드 {d.objects.threads}개
                  {d.objects.top.length > 0 && ` · 많은 순: ${d.objects.top.slice(0, 4).map((o) => `${o.name} ${o.count.toLocaleString()}`).join(", ")}`}
                </p>
              )}
            </div>
          )}

          {/* 늘고 있는지 평탄한지 — 순간값만으로는 구분할 수 없다 */}
          {d.mem_trend && d.mem_trend.samples >= 2 && (() => {
            const t = d.mem_trend;
            const rate = t.per_hour_mb ?? 0;
            const 판단가능 = (t.span_min ?? 0) >= 추이_판단_최소_분;
            return (
            <div className="rounded-lg bg-bg-elevated p-2.5 flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-2xs font-semibold text-text-muted">메모리 추이</span>
                <span className={`text-2xs font-mono ${
                  !판단가능 ? "text-text-dim"
                  : rate > 5 ? "text-accent-red"
                  : rate > 1 ? "text-accent-amber" : "text-accent-green"}`}>
                  {rate >= 0 ? "+" : ""}{rate}MB/시간
                </span>
              </div>
              <div className="flex items-end gap-[2px] h-8">
                {t.points.map((v, i) => (
                  <div key={i} className="flex-1 bg-accent-blue/40 rounded-sm min-w-[2px]"
                       style={{ height: `${추이막대높이(v, t.min_mb ?? v, t.max_mb ?? v)}%` }}
                       title={`${v}MB`} />
                ))}
              </div>
              <p className="text-[10px] text-text-dim break-keep">
                최근 {t.span_min}분 · {t.min_mb}~{t.max_mb}MB ·
                {!판단가능
                  ? ` 아직 ${t.samples}개 표본뿐이라 판단하기 이릅니다 (30분 이상 모여야 기울기를 믿을 수 있습니다)`
                  : rate > 5
                  ? " 계속 오르고 있습니다 — 누수를 의심할 만합니다"
                  : " 초반에 오른 뒤 평탄하면 정상입니다 (파이썬은 받은 메모리를 잘 돌려주지 않습니다)"}
              </p>
            </div>
            );
          })()}

          {/* 무엇이 늘고 있는지 — MEM_TRACE=1 로 켰을 때만 */}
          {d.alloc_growth?.enabled && (
            <div className="rounded-lg bg-bg-elevated p-2.5 flex flex-col gap-1">
              <p className="text-2xs font-semibold text-text-muted">
                늘어난 곳 {d.alloc_growth.ready && `(최근 ${d.alloc_growth.span_min}분)`}
              </p>
              {!d.alloc_growth.ready ? (
                <p className="text-[10px] text-text-dim break-keep">
                  기준점을 잡는 중입니다 — 표본이 두 번 모이면(약 10분) 표시됩니다
                </p>
              ) : d.alloc_growth.items.length === 0 ? (
                <p className="text-[10px] text-text-dim">늘어난 곳이 없습니다</p>
              ) : (
                <>
                  {d.alloc_growth.items.map((it) => (
                    <div key={it.where} className="flex items-baseline justify-between gap-2 text-2xs">
                      <span className="text-text-dim font-mono truncate">{it.where}</span>
                      <span className="font-mono text-text-secondary shrink-0">
                        +{(it.grew_kb / 1024).toFixed(1)}MB
                        <span className="text-text-dim font-normal ml-1">
                          ({it.count_diff.toLocaleString()}개)
                        </span>
                      </span>
                    </div>
                  ))}
                  <p className="text-[10px] text-text-dim break-keep mt-0.5">
                    파이썬이 직접 기록한 값입니다. 원인을 찾은 뒤에는 MEM_TRACE 를 꺼
                    두세요 — 켜 두면 메모리를 10~25% 더 씁니다.
                  </p>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            {[
              { Icon: Cpu, v: `${d.cpu.quota}개`, l: "CPU 할당량",
                sub: d.cpu.reported !== Math.round(d.cpu.quota) ? `호스트 보고 ${d.cpu.reported}개` : "" },
              { Icon: Clock, v: 기간(d.uptime_sec), l: "가동 시간",
                sub: d.uptime_sec < 600 ? "최근 재시작됨" : "" },
            ].map((x) => (
              <div key={x.l} className="rounded-lg bg-bg-elevated p-2.5">
                <p className="text-sm font-bold text-text-primary font-mono">{x.v}</p>
                <p className="text-2xs text-text-dim flex items-center gap-1"><x.Icon size={10} />{x.l}</p>
                {x.sub && <p className="text-[10px] text-accent-amber mt-0.5 break-keep">{x.sub}</p>}
              </div>
            ))}
          </div>
        </Card>

        {/* ── DB ── */}
        <Card icon={Database} title="데이터베이스" right={
          <button onClick={() => db.refetch()} aria-label="새로고침"
            className="text-text-muted hover:text-text-primary p-1 rounded">
            <RefreshCw size={13} className={db.isFetching ? "animate-spin" : ""} />
          </button>
        }>
          {db.data ? (
            <>
              <Bar big label="사용량 (Supabase 무료)" used={Math.round(dbUsedMb * 10) / 10} limit={DB_LIMIT_MB} />
              <div className="flex flex-col gap-1">
                <p className="text-2xs font-semibold text-text-muted">테이블별 (상위 8개)</p>
                {(db.data.tables ?? []).slice(0, 8).map((t: any) => {
                  const pct = db.data.total_bytes > 0 ? (t.bytes / db.data.total_bytes) * 100 : 0;
                  return (
                    <div key={t.name} className="flex items-center gap-2">
                      <span className="text-2xs text-text-muted font-mono w-32 truncate shrink-0">{t.name}</span>
                      <div className="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                        <div className="h-full bg-accent-blue/50 rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-2xs font-mono text-text-secondary w-14 text-right shrink-0">{t.pretty}</span>
                    </div>
                  );
                })}
              </div>
            </>
          ) : <p className="text-xs text-text-dim">불러오는 중…</p>}
        </Card>
      </div>

      {/* ── 메모리를 쓰는 것들 ──
          '나머지 411MB' 가 무엇인지 몰라 무엇을 줄여야 할지 판단할 수 없었다.
          라이브러리는 처음 로드될 때 실제로 잰 값이고, 데이터는 지금 올라와
          있는 건수를 그대로 보여준다. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card icon={Package} title="라이브러리별 메모리" right={
          <span className="text-2xs font-mono text-text-dim">
            합계 {라이브러리MB}MB
          </span>
        }>
          {!라이브러리 ? (
            <p className="text-xs text-text-dim break-keep">
              서버가 아직 이 정보를 보내지 않습니다. 백엔드 배포가 끝나면 표시됩니다.
            </p>
          ) : !라이브러리.tracked ? (
            <p className="text-xs text-text-dim break-keep">
              이 환경에서는 측정할 수 없습니다 (리눅스 컨테이너에서만 측정합니다).
            </p>
          ) : 라이브러리.items.length === 0 ? (
            <p className="text-xs text-text-dim break-keep">측정된 항목이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {라이브러리.items.map((i) => (
                <div key={i.name} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs font-mono text-text-secondary w-28 truncate shrink-0"
                          title={i.name}>{i.name}</span>
                    <div className="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                      <div className="h-full bg-accent-blue/50 rounded-full"
                           style={{ width: `${(i.mb / 최대라이브러리) * 100}%` }} />
                    </div>
                    <span className="text-2xs font-mono text-text-secondary w-14 text-right shrink-0">
                      {i.mb}MB
                    </span>
                  </div>
                  {i.purpose && (
                    <p className="text-[10px] text-text-dim break-keep pl-0 sm:pl-[7.5rem]">
                      {i.purpose}
                      {i.total_mb > i.mb * 1.5 && (
                        <span className="text-text-dim"> · 딸려오는 것 포함 {i.total_mb}MB</span>
                      )}
                    </p>
                  )}
                </div>
              ))}
              <p className="text-[10px] text-text-dim break-keep mt-1 leading-relaxed">
                각 라이브러리가 처음 불러와질 때 실제로 늘어난 메모리입니다. 안에서
                끌어오는 것(pandas → numpy)은 각자의 줄에서 세므로 겹치지 않습니다.
                {라이브러리.other_count > 0 &&
                  ` 0.5MB 미만 ${라이브러리.other_count}개(합계 ${라이브러리.other_mb}MB)는 목록에만 안 보일 뿐 위 합계에 들어 있습니다.`}
                {` 로드된 모듈 ${라이브러리.modules.toLocaleString()}개.`}
              </p>
              {라이브러리.preloaded.length > 0 && (
                <p className="text-[10px] text-text-dim break-keep">
                  측정 시작 전에 이미 올라와 있던 것(크기 미상):{" "}
                  {라이브러리.preloaded.map((p) => p.name).join(", ")}
                </p>
              )}
              {(라이브러리.stubbed ?? []).map((x) => (
                <p key={x.name} className="text-[10px] text-accent-green break-keep flex items-start gap-1">
                  <CheckCircle2 size={10} className="shrink-0 mt-0.5" />
                  <span><b>{x.name}</b> 미적재 — {x.note}</span>
                </p>
              ))}
            </div>
          )}
        </Card>

        <Card icon={Boxes} title="메모리에 올려둔 데이터" right={
          <span className="text-2xs font-mono text-text-dim">합계 {데이터MB}MB</span>
        }>
          {상주데이터.length === 0 ? (
            <p className="text-xs text-text-dim break-keep">
              서버가 아직 이 정보를 보내지 않습니다.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {상주데이터.map((s) => (
                <div key={s.name} className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs text-text-secondary w-28 truncate shrink-0 break-keep"
                          title={s.name}>{s.name}</span>
                    <div className="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${s.movable ? "bg-accent-amber/60" : "bg-accent-blue/40"}`}
                           style={{ width: `${(s.mb / 최대데이터) * 100}%` }} />
                    </div>
                    <span className="text-2xs font-mono text-text-secondary w-24 text-right shrink-0">
                      {s.mb}MB · {s.items.toLocaleString()}건
                    </span>
                  </div>
                  <p className="text-[10px] text-text-dim break-keep pl-0 sm:pl-[7.5rem]">{s.what}</p>
                </div>
              ))}
              {종목 && (
                <div className={`rounded-lg p-2 flex flex-col gap-0.5 ${
                  종목축소 ? "bg-accent-red/10 border border-accent-red/30" : "bg-bg-elevated"}`}>
                  <div className="flex items-baseline justify-between gap-2 text-2xs">
                    <span className="text-text-dim break-keep">국내 종목 목록 출처</span>
                    <span className={`font-mono shrink-0 ${종목축소 ? "text-accent-red" : "text-accent-green"}`}>
                      {종목.source} · {종목.count.toLocaleString()}개
                    </span>
                  </div>
                  <p className="text-[10px] text-text-dim break-keep">
                    {종목축소
                      ? `외부 조회가 실패해 내장 ${종목.builtin_count}개로 동작 중입니다. 이 목록에 없는 종목은 검색·시세 조회가 되지 않습니다.`
                      : `시세 ${종목.prices.toLocaleString()}개 포함${
                          종목.age_sec != null ? ` · ${초를사람말로(종목.age_sec)} 갱신` : ""
                        } · ${Math.round(종목.ttl_sec / 3600)}시간마다 새로 받습니다`}
                  </p>
                  {(종목.db_rows != null || 종목.db_error) && (
                    <p className={`text-[10px] break-keep ${
                      종목저장실패 ? "text-accent-red" : "text-text-dim"}`}>
                      {종목저장실패
                        ? `DB 저장 안 됨 — ${종목.db_error ?? "0건"}. 재시작마다 외부에서 다시 받아옵니다.`
                        : `DB에 ${종목.db_rows!.toLocaleString()}건 저장됨 — 다음 재시작은 외부 조회 없이 이 목록을 씁니다.`}
                    </p>
                  )}
                </div>
              )}
              <p className="text-[10px] text-text-dim break-keep leading-relaxed mt-1">
                노란 막대는 DB로 옮기거나 줄일 수 있는 항목입니다. 국내 종목 목록은
                PostgreSQL 에 저장돼 있어, 평소 재시작에는 DB만 읽고
                FinanceDataReader 를 아예 불러오지 않습니다.
              </p>
            </div>
          )}
        </Card>
      </div>

      {/* ── 백그라운드 작업 ── */}
      <Card icon={Layers} title="백그라운드 작업">
        {d.tasks.map((t) => (
          <div key={t.name} className="flex items-center justify-between gap-2 py-1.5 border-b border-border/40 last:border-b-0">
            <span className="text-xs text-text-secondary break-keep">{TASK_LABEL[t.name] ?? t.name}</span>
            {t.running ? (
              <span className="flex items-center gap-1 text-2xs text-accent-green shrink-0">
                <CheckCircle2 size={11} />동작 중</span>
            ) : t.name === "startup-prefetch" ? (
              <span className="text-2xs text-text-dim shrink-0">완료</span>
            ) : (
              <span className="flex items-center gap-1 text-2xs text-accent-red shrink-0" title={t.error ?? ""}>
                <AlertTriangle size={11} />멈춤</span>
            )}
          </div>
        ))}
        {d.idle.paused && (
          <div className="flex items-center gap-1.5 text-2xs text-text-dim">
            <PauseCircle size={11} />
            <span className="break-keep">
              {Math.round(d.idle.seconds / 60)}분간 접속이 없어 주기 갱신을 쉬는 중 (접속하면 자동 재개)
            </span>
          </div>
        )}
      </Card>

      {/* ── 데이터 수집 상태 (핵심) ── */}
      <Card icon={CheckCircle2} title="데이터 수집 — 마지막으로 성공한 때">
        {d.health.filter((h) => !h.name.startsWith("뉴스:")).length === 0 ? (
          <p className="text-xs text-text-dim break-keep">
            아직 기록이 없습니다. 백그라운드 작업이 한 바퀴 돌면 표시됩니다(최대 5분).
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {d.health.filter((h) => !h.name.startsWith("뉴스:")).map((h) => {
              const pct = h.success_pct ?? 0;
              const c = pct >= 90 ? "text-accent-green" : pct >= 50 ? "text-accent-amber" : "text-accent-red";
              return (
                <div key={h.name} className="py-1.5 border-b border-border/40 last:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-text-secondary break-keep">{h.name}</span>
                    <span className={`text-2xs font-mono shrink-0 ${c}`}>
                      성공 {pct}%
                      <span className="text-text-dim"> ({h.ok}/{h.ok + h.fail})</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-[10px] text-text-dim mt-0.5">
                    <span>마지막 성공 {초를사람말로(h.last_ok_sec)}</span>
                    {h.detail && <span>· {h.detail}</span>}
                    {h.last_ms != null && <span>· {h.last_ms}ms</span>}
                    {h.fail > 0 && <span className="text-accent-red break-keep">· 마지막 실패 {초를사람말로(h.last_fail_sec)}: {h.last_error}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* ── 실시간 시세 ── */}
        <Card icon={Radio} title="실시간 시세">
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              { v: `${d.watched.symbols}`, l: "갱신 중 종목" },
              { v: `${d.watched.connections}`, l: "보는 화면" },
              { v: `${d.market.price_interval_sec}초`, l: "갱신 주기" },
            ].map((x) => (
              <div key={x.l} className="rounded-lg bg-bg-elevated py-2.5">
                <p className="text-base font-bold text-text-primary font-mono">{x.v}</p>
                <p className="text-[10px] text-text-dim break-keep">{x.l}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-2xs text-text-dim">
            <span>국내 {d.market.kr_label} · 미국 {d.market.us_label}</span>
            <span className="flex items-center gap-1"><Wifi size={10} />연결 {d.websocket.connections}개</span>
          </div>
          <p className="text-[10px] text-text-dim break-keep">
            보는 사람이 없으면 갱신하지 않습니다. '갱신 중 종목 0'은 지금 아무도
            내 자산·관심종목 화면을 보고 있지 않다는 뜻입니다.
          </p>
        </Card>

        {/* ── 캐시 ── */}
        <Card icon={HardDrive} title="캐시 구성">
          <Bar label="전체" used={d.memory.cache_mb} limit={d.memory.cache_limit_mb}
               hint={`${d.memory.cache_items.toLocaleString()}건 · 압축 보관 ${d.memory.cache_packed}건`} />
          {d.cache_breakdown.length === 0 ? (
            <p className="text-2xs text-text-dim">아직 비어 있습니다</p>
          ) : (
            <div className="flex flex-col gap-1">
              {d.cache_breakdown.map((b) => (
                <div key={b.prefix} className="flex items-center gap-2">
                  <span className="text-2xs text-text-muted w-24 truncate shrink-0 break-keep">
                    {PREFIX_LABEL[b.prefix] ?? b.prefix}
                  </span>
                  <div className="flex-1 h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                    <div className="h-full bg-accent-blue/50 rounded-full"
                         style={{ width: `${d.memory.cache_mb > 0 ? (b.mb / d.memory.cache_mb) * 100 : 0}%` }} />
                  </div>
                  <span className="text-2xs font-mono text-text-secondary w-20 text-right shrink-0">
                    {b.mb}MB · {b.items}건
                  </span>
                </div>
              ))}
            </div>
          )}
          {!d.heavy_prefetch && (
            <p className="text-[10px] text-text-dim break-keep">
              차트 선제 캐싱 꺼짐 (메모리 절약). 큰 인스턴스에서는 ENABLE_HEAVY_PREFETCH=1
            </p>
          )}
        </Card>
      </div>

      {/* ── 뉴스 ── */}
      <Card icon={Newspaper} title="뉴스 수집">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { v: `${d.news.kr_cached.toLocaleString()}`, l: "국내 기사" },
            { v: `${d.news.us_cached.toLocaleString()}`, l: "미국 기사" },
            { v: `${d.news.kr_sources.length}/${d.news.kr_feeds}`, l: "수집된 언론사" },
          ].map((x) => (
            <div key={x.l} className="rounded-lg bg-bg-elevated py-2.5">
              <p className="text-base font-bold text-text-primary font-mono">{x.v}</p>
              <p className="text-[10px] text-text-dim break-keep">{x.l}</p>
            </div>
          ))}
        </div>
        <p className="text-2xs text-text-dim break-keep">
          회차당 {d.news.batch}곳씩 번갈아 가져옵니다 — 전체 한 바퀴에 약{" "}
          {Math.ceil(d.news.kr_feeds / d.news.batch) * 5}분
        </p>
        {d.news.kr_sources.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {d.news.kr_sources.map((s) => (
              <span key={s} className="px-1.5 py-0.5 rounded bg-bg-elevated text-[10px] text-text-muted break-keep">{s}</span>
            ))}
          </div>
        )}
        {실패언론사.length > 0 && (
          <div className="flex flex-col gap-0.5">
            <p className="text-2xs font-semibold text-accent-red">최근 실패한 언론사</p>
            <div className="flex flex-wrap gap-1">
              {실패언론사.slice(0, 20).map((h) => (
                <span key={h.name} className="px-1.5 py-0.5 rounded bg-accent-red/10 text-[10px] text-accent-red break-keep"
                      title={h.last_error ?? ""}>
                  {h.name.replace("뉴스:", "")} ({h.fail}회)
                </span>
              ))}
            </div>
          </div>
        )}
      </Card>

      <p className="text-[10px] text-text-dim text-center">
        15초마다 자동 갱신 · 서버 시각 {d.server_time.slice(11, 19)} UTC
      </p>
    </div>
  );
}
