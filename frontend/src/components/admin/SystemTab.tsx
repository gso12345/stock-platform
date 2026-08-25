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
  Package, Boxes, Percent,
} from "lucide-react";
import api from "@/api/client";

interface HealthItem {
  name: string; ok: number; fail: number;
  /** 연속 실패 횟수. 한 번이라도 성공하면 0으로 돌아간다 —
   *  '지금 고장 나 있는가' 는 누적 fail 이 아니라 이 값으로 봐야 한다 */
  streak: number;
  success_pct: number | null;
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
    /** 계속 실패해서 뒤로 물린 곳 — 회차당 몇 칸만 다시 시도한다 */
    resting?: string[]; rest_after?: number; probe?: number;
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
  native?: {
    arena_mb: number; mmap_mb: number; in_use_mb: number; freed_kept_mb: number;
    arena_max?: string | null;
  } | null;
  last_trim?: { before_mb: number; after_mb: number; freed_mb: number } | null;
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
  us_tickers?: {
    source: string; count: number; etf_count: number; age_sec: number | null;
    builtin_count: number; degraded: boolean; ttl_sec: number;
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

type 금리진단 = {
  원천별: Record<string, { 결과: string; 개수: number; 받은것: string[]; 언제: string }>;
  지금_나가는_것: string[];
  쉬는_후보: string[];
  bok_api_key: string;
};

/** 국내 금리를 원천별로 뭘 해 봤고 뭐가 돌아왔는지.
 *
 *  "콜금리 회사채 안뜸" 을 두 번 들었다. 두 번 다 원인을 못 짚은 게
 *  아니라 짚을 방법이 없었다 — 화면에는 '안 나온다' 만 보이고, 서버가
 *  어느 원천에 닿았는지 못 닿았는지는 아무 데도 안 보였다.
 *
 *  이 표를 보면 다음 한 번에 고칠 수 있다.
 *    · '실패(...)'  → 서버가 그 원천에 못 닿는다
 *    · '빈손'       → 닿기는 하는데 그 항목을 안 준다 (코드가 틀렸다) */
function 금리진단표({ d }: { d?: 금리진단 }) {
  if (!d) return null;
  const 항목들 = Object.entries(d.원천별 ?? {});
  const 색 = (결과: string) =>
    결과.startsWith("실패") ? "text-accent-red"
    : 결과.startsWith("받음") ? "text-accent-green"
    : "text-text-muted";
  return (
    <Card icon={Percent} title="국내 금리 원천">
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap gap-1">
          {d.지금_나가는_것?.length ? d.지금_나가는_것.map((n) => (
            <span key={n} className="px-1.5 py-0.5 rounded bg-bg-elevated text-2xs text-text-muted break-keep">{n}</span>
          )) : <span className="text-2xs text-text-dim">지금 나가는 금리가 없습니다</span>}
        </div>

        {항목들.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {항목들.map(([원천, r]) => (
              <div key={원천} className="flex flex-col gap-0.5 pl-2 border-l-2 border-border">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-2xs font-semibold text-text-secondary break-keep">{원천}</span>
                  <span className={`text-2xs font-semibold ${색(r.결과)}`}>{r.결과}</span>
                  {r.개수 > 0 && <span className="text-2xs text-text-dim">{r.개수}건</span>}
                  <span className="text-2xs text-text-dim">{r.언제}</span>
                </div>
                {r.받은것?.length > 0 && (
                  <span className="text-2xs text-text-dim break-keep">{r.받은것.join(" · ")}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {d.쉬는_후보?.length > 0 && (
          <p className="text-2xs text-text-dim break-keep">
            아직 못 받은 금리: {d.쉬는_후보.join(" · ")}
          </p>
        )}
        {d.bok_api_key?.startsWith("기본값") && (
          /* ECOS 는 한국은행 API 키가 있어야 한다. 기본값 'sample' 은
             대부분의 통계가 막혀 있어서, 콜금리를 여기서 받으려면
             ecos.bok.or.kr 에서 무료 키를 받아 BOK_API_KEY 로 넣어야 한다. */
          <p className="text-2xs text-accent-amber break-keep">
            한국은행 ECOS 키가 {d.bok_api_key} — 콜금리를 ECOS 에서 받으려면
            ecos.bok.or.kr 에서 무료 키를 받아 BOK_API_KEY 에 넣어야 합니다.
          </p>
        )}
      </div>
    </Card>
  );
}

type 오류목록 = {
  요약: { 종류: number; 전체횟수: number; 한시간_종류: number; 한시간_횟수: number; 가장_잦은: string | null };
  목록: { 어디: string; 무엇: string; 자세히: string; 어디서: string;
          횟수: number; 처음: string; 마지막: string; 지난초: number }[];
};

/** 최근에 터진 것.
 *
 *  이 화면이 없어서 오늘까지 문제를 전부 사용자 제보로 알았다 —
 *  엔비디아가 순위에서 사라진 것도, 콜금리가 안 뜨는 것도, 글자가 너무
 *  커진 것도. 사용자가 말해 주지 않았으면 몰랐을 것이다.
 *
 *  서버 오류와 화면(브라우저) 오류를 한자리에 모은다. 사용자가 겪는
 *  고장은 어느 쪽에서 났든 하나의 사건이기 때문이다. */
function 오류표({ d, 비우기 }: { d?: 오류목록; 비우기: () => void }) {
  /* 서버가 아직 이 기능을 모르거나(배포 직후 몇 분) 응답이 반쪽이어도
     화면이 터지면 안 된다. 오류를 보여 주려고 만든 자리가 스스로
     오류를 내면 앞뒤가 안 맞는다 — 실제로 시험에서 그렇게 터졌다. */
  const 목록 = d?.목록 ?? [];
  const 요약 = d?.요약;
  if (!d || !요약) return null;
  const 최근 = (요약.한시간_횟수 ?? 0) > 0;
  return (
    <Card
      icon={AlertTriangle}
      title="최근 오류"
      right={
        목록.length > 0 ? (
          <button
            onClick={비우기}
            className="text-2xs text-text-muted hover:text-accent-red border border-border rounded px-2 py-0.5 transition-colors"
          >
            비우기
          </button>
        ) : undefined
      }
    >
      {목록.length === 0 ? (
        <p className="text-xs text-text-muted">터진 것이 없습니다.</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          <p className={`text-2xs break-keep ${최근 ? "text-accent-amber" : "text-text-dim"}`}>
            {최근
              ? `최근 1시간에 ${요약.한시간_종류}종류 ${요약.한시간_횟수}건`
              : "최근 1시간에는 조용합니다"}
            {" · "}전체 {요약.종류}종류 {요약.전체횟수}건
            {요약.가장_잦은 && ` · 가장 잦은 것 ${요약.가장_잦은}`}
          </p>
          <div className="flex flex-col gap-1.5">
            {목록.map((e, i) => (
              <details key={i} className="pl-2 border-l-2 border-accent-red/30">
                <summary className="cursor-pointer list-none flex items-center gap-1.5 flex-wrap">
                  <span className="text-2xs font-semibold text-accent-red break-keep">{e.무엇}</span>
                  <span className="text-2xs text-text-muted break-all">{e.어디}</span>
                  {e.횟수 > 1 && (
                    <span className="text-2xs text-text-dim">×{e.횟수}</span>
                  )}
                  <span className="text-2xs text-text-dim">{e.마지막}</span>
                </summary>
                {/* 스택은 접어 둔다. 펼치지 않으면 목록이 길어져서
                    '무엇이 몇 번 터졌나' 를 한눈에 못 본다. */}
                <pre className="mt-1 mb-1 max-h-40 overflow-auto whitespace-pre-wrap break-all
                                text-2xs text-text-dim bg-bg-elevated rounded p-2">
                  {e.자세히}
                </pre>
                {e.어디서 && (
                  <p className="text-2xs text-text-dim break-all mb-1">어디서: {e.어디서}</p>
                )}
              </details>
            ))}
          </div>
        </div>
      )}
    </Card>
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
  /* 국내 금리가 원천별로 뭘 받아 왔는지. "콜금리 회사채 안뜸" 을 두 번
     들었는데 두 번 다 원인을 볼 방법이 없었다 — 화면에는 '안 나온다' 만
     보이고 서버가 뭘 시도했는지는 로그에만 있었다. */
  const 오류 = useQuery<오류목록>({
    queryKey: ["admin-errors"],
    queryFn: () => api.get("/admin/errors").then((r) => r.data),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 1,
  });
  const 금리 = useQuery<금리진단>({
    queryKey: ["admin-rates-diagnosis"],
    queryFn: () => api.get("/admin/rates-diagnosis").then((r) => r.data),
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: 1,
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
  /* '지금 문제인 것' 도 누적치가 아니라 연속 실패로 본다.
     누적 성공률로만 보면, 며칠 잘 되다가 오늘 망가진 것은 성공률이
     아직 높아서 안 잡힌다 — 코스닥150 이 0 으로 떠 있는데도 경고가
     안 뜨던 이유다. streak 이 없으면(서버가 아직 옛 버전) 예전 규칙. */
  const 실패중 = d.health.filter((h) =>
    !h.name.startsWith("뉴스:") && !h.name.startsWith("값:") &&
    (h.streak != null ? h.streak >= 2
                      : (h.fail > 0 && (h.success_pct ?? 100) < 50)));

  /* 값이 이상한 것 — '못 가져왔다' 와는 다른 종류다.
     조회는 성공했는데 숫자가 틀린 경우다. 원/100엔이 1엔당 값으로 몇 달
     떠 있었고 코스닥150 은 0 이었는데, 둘 다 '성공' 으로 세어졌다.
     금융 화면에서 틀린 숫자는 없는 것보다 나쁘다 — 없으면 다른 데서
     찾아보지만 틀린 값은 그대로 믿는다. */
  const 이상값 = d.health
    .filter((h) => h.name.startsWith("값:") && (h.streak ?? 0) > 0)
    .sort((a, b) => (b.streak ?? 0) - (a.streak ?? 0));
  /* '최근 실패' 는 누적 실패 수(fail)가 아니라 연속 실패(streak)로 본다.
     예전에는 한참 전에 열 번 실패하고 그 뒤로 계속 성공한 곳도 "(10회)" 로
     남아서, 지금 멀쩡한 언론사가 목록에 계속 떠 있었다.
     ?? 로 적은 이유 — 서버가 아직 옛 버전이면 streak 이 안 온다.
     그때는 예전처럼 fail 로 보여 주고, 새 버전이 뜨면 저절로 정확해진다. */
  const 실패언론사 = d.health
    .filter((h) => h.name.startsWith("뉴스:") && (h.streak ?? h.fail) > 0)
    .sort((a, b) => (b.streak ?? b.fail) - (a.streak ?? a.fail));

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

  // 미국도 마찬가지. 내장 128개로 도는 동안 화면에 아무 표시가 없었다
  const 미국종목 = d.us_tickers;
  const 미국축소 = 미국종목?.degraded === true;

  return (
    <div className="flex flex-col gap-4">

      {/* ── 문제가 있으면 맨 위에 크게 ── */}
      {(메모리위험 || 종목축소 || 미국축소 || 종목저장실패 || 죽은작업.length > 0
        || 실패중.length > 0 || 이상값.length > 0) && (
        <div role="alert"
             className="rounded-xl border border-accent-red/40 bg-accent-red/10 p-4 flex items-start gap-2.5">
          <AlertTriangle size={16} className="text-accent-red shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 text-xs text-accent-red break-keep leading-relaxed">
            {이상값.length > 0 && (
              /* 맨 위에 둔다. 값이 틀린 것은 '느리다' 나 '메모리' 보다
                 먼저 알아야 한다 — 사용자가 그 숫자를 믿고 판단한다 */
              <div className="flex flex-col gap-0.5">
                <p><b>값이 이상한 지표 {이상값.length}개</b> — 조회는 됐는데 숫자가 맞지 않습니다.</p>
                {이상값.slice(0, 8).map((h) => (
                  <p key={h.name} className="pl-2">
                    · <b>{h.name.replace(/^값:[^:]*:/, "")}</b> {h.last_error}
                  </p>
                ))}
              </div>
            )}
            {종목축소 && (
              <p>
                <b>국내 종목이 {종목!.count}개뿐입니다</b> (출처: {종목!.source}) — 외부 조회가 실패해
                내장 목록으로 동작 중입니다. 이 목록에 없는 종목은 검색·시세 조회가 되지 않습니다.
              </p>
            )}
            {미국축소 && (
              <p>
                <b>미국 종목이 {미국종목!.count}개뿐입니다</b> (출처: {미국종목!.source}) — 외부 조회가
                실패해 내장 목록으로 동작 중입니다. 이 목록에 없는 종목은 검색이 되지 않습니다.
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
            <p className="text-2xs text-text-dim break-keep mt-0.5">
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
                  <span className="text-2xs text-text-dim break-keep">{why}</span>
                </div>
              ))}
              {d.objects && (
                <p className="text-2xs text-text-dim break-keep mt-0.5 pt-1 border-t border-border/30">
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
              <p className="text-2xs text-text-dim break-keep">
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

          {/* 파이썬이 못 보는 영역 — C 라이브러리가 들고 있는 메모리.
              '객체는 줄었는데 메모리는 늘었다' 를 설명할 수 있는 유일한 곳이다. */}
          {d.native && (
            <div className="rounded-lg bg-bg-elevated p-2.5 flex flex-col gap-1">
              <p className="text-2xs font-semibold text-text-muted">
                파이썬 밖의 메모리 (C 라이브러리)
              </p>
              {[
                ["중간 크기 버퍼", `${d.native.in_use_mb}MB`,
                 "HTTP 응답·압축·파싱 중간물. 야후 응답이 여기 쌓인다"],
                ["큰 배열", `${d.native.mmap_mb}MB`,
                 "numpy·pandas 표 — 놓으면 바로 OS 로 돌아간다"],
                ["비었지만 붙들고 있음", `${d.native.freed_kept_mb}MB`,
                 "해제했는데 아직 OS 에 안 돌려준 것. 크면 단편화다"],
              ].map(([k, v, why]) => (
                <div key={k} className="flex flex-col">
                  <div className="flex items-baseline justify-between gap-2 text-2xs">
                    <span className="text-text-dim break-keep">{k}</span>
                    <span className="font-mono text-text-secondary shrink-0">{v}</span>
                  </div>
                  <span className="text-2xs text-text-dim break-keep">{why}</span>
                </div>
              ))}
              {/* 힙을 몇 개까지 나눠 쓰는지. 스레드마다 따로 만들면 빈 자리도
                  따로 놀아서 '비었지만 붙들고 있음' 이 불어난다. 설정이 실제로
                  걸렸는지 여기서 확인할 수 있어야 효과를 판단할 수 있다 */}
              <div className="flex flex-col pt-1 mt-0.5 border-t border-border/30">
                <div className="flex items-baseline justify-between gap-2 text-2xs">
                  <span className="text-text-dim break-keep">힙 나눔 상한</span>
                  <span className={`font-mono shrink-0 ${
                    d.native.arena_max ? "text-accent-green" : "text-accent-amber"}`}>
                    {d.native.arena_max ? `${d.native.arena_max}개` : "제한 없음"}
                  </span>
                </div>
                <span className="text-2xs text-text-dim break-keep">
                  {d.native.arena_max
                    ? "스레드가 많아도 힙을 이만큼만 나눠 씁니다 — 빈 자리가 흩어지지 않습니다"
                    : "스레드마다 힙이 따로 생길 수 있습니다. 빈 자리가 흩어져 위 '붙들고 있음' 이 커집니다"}
                </span>
              </div>
              {d.last_trim && (
                <p className="text-2xs text-text-dim break-keep mt-0.5 pt-1 border-t border-border/30">
                  마지막 정리에서 {d.last_trim.freed_mb}MB 를 OS 에 돌려줬습니다
                  ({d.last_trim.before_mb} → {d.last_trim.after_mb}MB).
                  {d.last_trim.freed_mb < 1 && " 거의 0 이면 단편화가 원인이 아니라는 뜻입니다."}
                </p>
              )}
              {(
                <p className="text-2xs text-text-dim break-keep">
                  파이썬 객체는 여기 안 잡힙니다 — 파이썬이 자체 할당기로 따로
                  관리합니다. 그래서 이 칸은 '파이썬이 아닌 메모리'만 보여줍니다.
                </p>
              )}
            </div>
          )}

          {/* 무엇이 늘고 있는지 — MEM_TRACE=1 로 켰을 때만 */}
          {d.alloc_growth?.enabled && (
            <div className="rounded-lg bg-bg-elevated p-2.5 flex flex-col gap-1">
              <p className="text-2xs font-semibold text-text-muted">
                늘어난 곳 {d.alloc_growth.ready && `(최근 ${d.alloc_growth.span_min}분)`}
              </p>
              {!d.alloc_growth.ready ? (
                <p className="text-2xs text-text-dim break-keep">
                  기준점을 잡는 중입니다 — 표본이 두 번 모이면(약 10분) 표시됩니다
                </p>
              ) : d.alloc_growth.items.length === 0 ? (
                <p className="text-2xs text-text-dim">늘어난 곳이 없습니다</p>
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
                  <p className="text-2xs text-text-dim break-keep mt-0.5">
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
                <p className="text-2xs text-text-dim flex items-center gap-1"><x.Icon size={11} />{x.l}</p>
                {x.sub && <p className="text-2xs text-accent-amber mt-0.5 break-keep">{x.sub}</p>}
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
                    <p className="text-2xs text-text-dim break-keep pl-0 sm:pl-[7.5rem]">
                      {i.purpose}
                      {i.total_mb > i.mb * 1.5 && (
                        <span className="text-text-dim"> · 딸려오는 것 포함 {i.total_mb}MB</span>
                      )}
                    </p>
                  )}
                </div>
              ))}
              <p className="text-2xs text-text-dim break-keep mt-1 leading-relaxed">
                각 라이브러리가 처음 불러와질 때 실제로 늘어난 메모리입니다. 안에서
                끌어오는 것(pandas → numpy)은 각자의 줄에서 세므로 겹치지 않습니다.
                {라이브러리.other_count > 0 &&
                  ` 0.5MB 미만 ${라이브러리.other_count}개(합계 ${라이브러리.other_mb}MB)는 목록에만 안 보일 뿐 위 합계에 들어 있습니다.`}
                {` 로드된 모듈 ${라이브러리.modules.toLocaleString()}개.`}
              </p>
              {라이브러리.preloaded.length > 0 && (
                <p className="text-2xs text-text-dim break-keep">
                  측정 시작 전에 이미 올라와 있던 것(크기 미상):{" "}
                  {라이브러리.preloaded.map((p) => p.name).join(", ")}
                </p>
              )}
              {(라이브러리.stubbed ?? []).map((x) => (
                <p key={x.name} className="text-2xs text-accent-green break-keep flex items-start gap-1">
                  <CheckCircle2 size={11} className="shrink-0 mt-0.5" />
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
                  <p className="text-2xs text-text-dim break-keep pl-0 sm:pl-[7.5rem]">{s.what}</p>
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
                  <p className="text-2xs text-text-dim break-keep">
                    {종목축소
                      ? `외부 조회가 실패해 내장 ${종목.builtin_count}개로 동작 중입니다. 이 목록에 없는 종목은 검색·시세 조회가 되지 않습니다.`
                      : `시세 ${종목.prices.toLocaleString()}개 포함${
                          종목.age_sec != null ? ` · ${초를사람말로(종목.age_sec)} 갱신` : ""
                        } · ${Math.round(종목.ttl_sec / 3600)}시간마다 새로 받습니다`}
                  </p>
                  {(종목.db_rows != null || 종목.db_error) && (
                    <p className={`text-2xs break-keep ${
                      종목저장실패 ? "text-accent-red" : "text-text-dim"}`}>
                      {종목저장실패
                        ? `DB 저장 안 됨 — ${종목.db_error ?? "0건"}. 재시작마다 외부에서 다시 받아옵니다.`
                        : `DB에 ${종목.db_rows!.toLocaleString()}건 저장됨 — 다음 재시작은 외부 조회 없이 이 목록을 씁니다.`}
                    </p>
                  )}
                </div>
              )}
              {미국종목 && (
                <div className={`rounded-lg p-2 flex flex-col gap-0.5 ${
                  미국축소 ? "bg-accent-red/10 border border-accent-red/30" : "bg-bg-elevated"}`}>
                  <div className="flex items-baseline justify-between gap-2 text-2xs">
                    <span className="text-text-dim break-keep">미국 종목 목록 출처</span>
                    <span className={`font-mono shrink-0 ${미국축소 ? "text-accent-red" : "text-accent-green"}`}>
                      {미국종목.source} · {미국종목.count.toLocaleString()}개
                    </span>
                  </div>
                  <p className="text-2xs text-text-dim break-keep">
                    {미국축소
                      ? `외부 조회가 실패해 내장 ${미국종목.builtin_count}개로 동작 중입니다. 이 목록에 없는 종목은 검색이 되지 않습니다.`
                      : `ETF ${미국종목.etf_count.toLocaleString()}개 포함${
                          미국종목.age_sec != null ? ` · ${초를사람말로(미국종목.age_sec)} 갱신` : ""
                        } · ${Math.round(미국종목.ttl_sec / 3600)}시간마다 새로 받습니다`}
                  </p>
                  {(미국종목.db_rows != null || 미국종목.db_error) && (
                    <p className={`text-2xs break-keep ${
                      미국종목.db_error ? "text-accent-red" : "text-text-dim"}`}>
                      {미국종목.db_error
                        ? `DB 저장 안 됨 — ${미국종목.db_error}. 재시작마다 외부에서 다시 받아옵니다.`
                        : `DB에 ${미국종목.db_rows!.toLocaleString()}건 저장됨 — 다음 재시작은 외부 조회 없이 이 목록을 씁니다.`}
                    </p>
                  )}
                </div>
              )}
              <p className="text-2xs text-text-dim break-keep leading-relaxed mt-1">
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
        {d.health.filter((h) => !h.name.startsWith("뉴스:") && !h.name.startsWith("값:")).length === 0 ? (
          <p className="text-xs text-text-dim break-keep">
            아직 기록이 없습니다. 백그라운드 작업이 한 바퀴 돌면 표시됩니다(최대 5분).
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {d.health.filter((h) => !h.name.startsWith("뉴스:") && !h.name.startsWith("값:")).map((h) => {
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
                  <div className="flex items-center gap-2 flex-wrap text-2xs text-text-dim mt-0.5">
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
                <p className="text-2xs text-text-dim break-keep">{x.l}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between text-2xs text-text-dim">
            <span>국내 {d.market.kr_label} · 미국 {d.market.us_label}</span>
            <span className="flex items-center gap-1"><Wifi size={11} />연결 {d.websocket.connections}개</span>
          </div>
          <p className="text-2xs text-text-dim break-keep">
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
            <p className="text-2xs text-text-dim break-keep">
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
              <p className="text-2xs text-text-dim break-keep">{x.l}</p>
            </div>
          ))}
        </div>
        <p className="text-2xs text-text-dim break-keep">
          회차당 {d.news.batch}곳씩 번갈아 가져옵니다 — 전체 한 바퀴에 약{" "}
          {Math.ceil(d.news.kr_feeds / d.news.batch) * 5}분
          {(d.news.resting?.length ?? 0) > 0 && (
            /* 계속 실패하는 곳은 칸을 거의 안 먹는다는 것을 적어 준다.
               안 적으면 '실패 중 36곳' 만 보고 서버가 매 회차 거기에
               시간을 쓰고 있다고 읽게 된다 */
            <> · 계속 실패한 {d.news.resting!.length}곳은 쉬는 중
              (회차당 {d.news.probe ?? 2}칸만 다시 시도)</>
          )}
        </p>
        {d.news.kr_sources.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {d.news.kr_sources.map((s) => (
              <span key={s} className="px-1.5 py-0.5 rounded bg-bg-elevated text-2xs text-text-muted break-keep">{s}</span>
            ))}
          </div>
        )}
        {실패언론사.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-2xs font-semibold text-accent-red">지금 실패 중인 언론사</p>
            {/* 이유를 칩 옆에 그대로 적는다.
                예전에는 title 툴팁에만 있어서 마우스를 올려야 보였고,
                휴대폰에서는 아예 볼 방법이 없었다. 무엇이 문제인지가
                이 목록의 존재 이유인데 그게 가려져 있었다. */}
            {/* 한 줄에 언론사 하나. 예전에는 flex-wrap 이라 이유가 다음
                줄로 넘어갔고, 넘어간 이유가 아래 언론사 것처럼 보였다.
                이유를 보여 주는 게 이 목록의 존재 이유인데 그게 어느
                언론사 것인지 헷갈리면 없는 것만 못하다. */}
            <div className="flex flex-col gap-1">
              {실패언론사.map((h) => {
                const 이름 = h.name.replace("뉴스:", "");
                const 쉬는중 = d.news.resting?.includes(이름);
                return (
                  <div key={h.name} className="flex flex-col gap-0.5 pl-2 border-l-2 border-accent-red/30">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-2xs font-semibold text-accent-red break-keep">{이름}</span>
                      <span className="text-2xs text-text-dim">{h.streak ?? h.fail}회 연속</span>
                      {쉬는중 && (
                        <span className="px-1 rounded bg-bg-elevated text-2xs text-text-muted">쉬는 중</span>
                      )}
                    </div>
                    {h.last_error && (
                      <span className="text-2xs text-text-dim break-keep">{h.last_error}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <오류표 d={오류.data} 비우기={async () => {
        await api.delete("/admin/errors").catch(() => {});
        오류.refetch();
      }} />

      <금리진단표 d={금리.data} />

      <p className="text-2xs text-text-dim text-center">
        15초마다 자동 갱신 · 서버 시각 {d.server_time.slice(11, 19)} UTC
      </p>
    </div>
  );
}
