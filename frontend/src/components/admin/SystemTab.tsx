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

  return (
    <div className="flex flex-col gap-4">

      {/* ── 문제가 있으면 맨 위에 크게 ── */}
      {(메모리위험 || 죽은작업.length > 0 || 실패중.length > 0) && (
        <div className="rounded-xl border border-accent-red/40 bg-accent-red/10 p-4 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-accent-red shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 text-xs text-accent-red break-keep leading-relaxed">
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

          {/* 메모리가 무엇으로 채워졌는지 — 캐시만 보면 오해한다 */}
          <div className="rounded-lg bg-bg-elevated p-2.5 flex flex-col gap-1">
            <p className="text-2xs font-semibold text-text-muted">메모리 구성</p>
            {[
              ["캐시 (조절 가능)", `${d.memory.cache_mb}MB / ${d.memory.cache_limit_mb}MB`],
              ["라이브러리·종목DB·기타", `약 ${Math.max(0, Math.round((d.memory.used_mb ?? 0) - d.memory.cache_mb))}MB`],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-2xs">
                <span className="text-text-dim break-keep">{k}</span>
                <span className="font-mono text-text-secondary">{v}</span>
              </div>
            ))}
            <p className="text-[10px] text-text-dim break-keep mt-0.5">
              캐시를 0으로 만들어도 나머지는 줄지 않습니다 (pandas·yfinance 등 필수 라이브러리)
            </p>
          </div>

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
