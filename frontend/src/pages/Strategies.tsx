import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { backtestApi } from "@/api/stocks";
import { Card, LoadingSpinner, Badge, Button, Tabs, ConfirmDialog, 못불러옴} from "@/components/ui";
import { useAuthStore } from "@/store/authStore";
import {
  LogIn, TrendingUp, Plus, Trash2, BarChart2, PieChart,
} from "lucide-react";

type MarketFilter = "전체" | "KR" | "US";

const MARKET_FILTER_TABS: { id: MarketFilter; label: string }[] = [
  { id: "전체", label: "전체" },
  { id: "KR",   label: "한국 KR" },
  { id: "US",   label: "미국 US" },
];

/** 저장한 것은 두 종류다 — 매매 신호와 자산배분.
 *
 *  ── 왜 여기에 같이 두나 ───────────────────────────────────
 *
 *  자산배분 실험은 백테스트 화면의 '전략 저장소' 탭에만 있었고, 정작
 *  메뉴의 '전략 저장소' 에는 매매 신호만 있었다. 같은 이름의 자리가
 *  둘인데 담긴 것이 달랐던 셈이다 — 저장해 놓고 메뉴로 찾아온 사람은
 *  자기 것이 사라진 줄 안다.
 *
 *  둘은 **다른 종류**라 배지로 가른다. 하나는 신호(RSI<30 에 사고…)를
 *  시험하는 것이고, 하나는 여러 자산을 비중대로 굴려 보는 것이다.
 *  열리는 화면도 다르므로, 무엇인지 먼저 보여야 한다. */
type 종류필터 = "전체" | "신호" | "배분";

const 종류탭: { id: 종류필터; label: string }[] = [
  { id: "전체", label: "전체" },
  { id: "신호", label: "매매 신호" },
  { id: "배분", label: "자산배분" },
];

export default function Strategies() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuthStore();

  const [marketFilter, setMarketFilter] = useState<MarketFilter>("전체");
  const [종류, set종류] = useState<종류필터>("전체");
  const [지울전략, set지울전략] = useState<{ id: number; name: string } | null>(null);
  const [지울실험, set지울실험] = useState<{ id: number; name: string } | null>(null);

  const { data: strategies, isLoading, isError: 못받음, error: 실패사유, refetch: 다시받기 } = useQuery({
    queryKey: ["strategies"],
    queryFn: backtestApi.getStrategies,
    enabled: isLoggedIn,
  });

  const { data: 실험들 } = useQuery({
    queryKey: ["backtest-experiments"],
    queryFn: backtestApi.getExperiments,
    enabled: isLoggedIn,
  });

  const 실험지우기 = useMutation({
    mutationFn: (id: number) => backtestApi.deleteExperiment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["backtest-experiments"] });
      set지울실험(null);
    },
    onError: () => set지울실험(null),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => backtestApi.deleteStrategy(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["strategies"] });
      set지울전략(null);
    },
    /* 실패해도 창은 닫는다. 열어 둔 채로 두면 계속 누르게 되고,
       그때마다 같은 요청이 나간다 */
    onError: () => set지울전략(null),
  });

  const allStrategies: any[] = strategies ?? [];
  const all실험: any[] = 실험들 ?? [];

  const 신호수 = allStrategies.length;
  const 배분수 = all실험.length;
  const totalCount = 신호수 + 배분수;

  const filteredStrategies = 종류 === "배분" ? [] : (
    marketFilter === "전체"
      ? allStrategies
      : allStrategies.filter((s) => s.market === marketFilter));
  const 보일실험 = 종류 === "신호" ? [] : all실험;
  const 보일개수 = filteredStrategies.length + 보일실험.length;

  return (
    <div className="flex flex-col gap-6">
      {/* ── 페이지 헤더 ──────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">전략 저장소</h1>
          <p className="text-text-muted text-xs mt-0.5">저장된 전략을 관리하고 백테스트에 로드합니다</p>
        </div>
        <Button onClick={() => navigate("/backtest")}>
          <Plus size={14} className="inline mr-1.5" />
          새 전략 만들기
        </Button>
      </div>

      {/* ── 비로그인 안내 ──────────────────────────────────────── */}
      {!isLoggedIn && (
        <Card className="flex flex-col items-center justify-center py-16 gap-5">
          <div className="w-16 h-16 rounded-full bg-accent-blue/10 flex items-center justify-center">
            <LogIn size={28} className="text-accent-blue" />
          </div>
          <div className="text-center">
            <p className="text-text-primary font-semibold text-base">로그인이 필요합니다</p>
            <p className="text-text-muted text-sm mt-1">전략 저장소는 로그인 후 이용할 수 있습니다</p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => navigate("/login")}>로그인</Button>
            <Button variant="secondary" onClick={() => navigate("/register")}>회원가입</Button>
          </div>
        </Card>
      )}

      {isLoggedIn && (
        <>
          {/* ── 통계 카드 ──────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3">
            {/* KR/US 개수 대신 **종류별**로 센다. 시장은 카드마다 배지로
                이미 보이는데, 자산배분이 섞이면서 '내가 무엇을 몇 개
                저장했나' 가 더 알고 싶은 수가 됐다. */}
            <Card className="flex flex-col items-center gap-1 py-4">
              <div className="text-xs font-medium text-text-muted uppercase tracking-wide">전체</div>
              <div className="text-2xl font-bold font-mono text-text-primary">{totalCount}</div>
            </Card>
            <Card className="flex flex-col items-center gap-1 py-4">
              <div className="text-xs font-medium text-text-muted uppercase tracking-wide">매매 신호</div>
              <div className="text-2xl font-bold font-mono text-accent-blue">{신호수}</div>
            </Card>
            <Card className="flex flex-col items-center gap-1 py-4">
              <div className="text-xs font-medium text-text-muted uppercase tracking-wide">자산배분</div>
              <div className="text-2xl font-bold font-mono text-accent-purple">{배분수}</div>
            </Card>
          </div>

          {/* ── 시장 필터 탭 ───────────────────────────────────── */}
          {totalCount > 0 && (
            <div className="flex flex-col gap-2">
              <Tabs
                fill={false}
                ariaLabel="종류 필터"
                idPrefix="종류"
                className="w-fit"
                tabs={종류탭.map((x) => ({ id: String(x.id), label: x.label }))}
                active={String(종류)}
                onChange={(id) => set종류(id as 종류필터)}
              />
              {/* 시장 필터는 **매매 신호에만** 뜻이 있다. 자산배분은 한
                  실험 안에 여러 시장이 섞이므로 KR/US 로 가를 수가 없다 —
                  아무 일도 안 하는 조작칸은 없느니만 못하다. */}
              {종류 !== "배분" && 신호수 > 0 && (
                <Tabs
                  fill={false}
                  ariaLabel="시장 필터"
                  idPrefix="시장"
                  className="w-fit"
                  tabs={MARKET_FILTER_TABS.map((t: any) => ({ id: String(t.id), label: t.label }))}
                  active={String(marketFilter)}
                  onChange={(id) => setMarketFilter(id as any)}
                />
              )}
            </div>
          )}

          {/* ── 로딩 ───────────────────────────────────────────── */}
          {isLoading && <LoadingSpinner />}
          {!isLoading && 못받음 && (
            <못불러옴 사유={실패사유} 다시={() => 다시받기()} />
          )}

          {/* ── 빈 상태 ────────────────────────────────────────── */}
          {!isLoading && !못받음 && totalCount === 0 && (
            <Card className="flex flex-col items-center justify-center py-16 gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-bg-elevated flex items-center justify-center">
                <TrendingUp size={28} className="text-text-muted" />
              </div>
              <div>
                <p className="text-text-primary font-semibold">저장한 것이 없어요</p>
                <p className="text-text-muted text-sm mt-1">
                  백테스트에서 매매 신호나 자산배분을 만들고 저장해 보세요
                </p>
              </div>
              <Button onClick={() => navigate("/backtest")}>
                <Plus size={14} className="inline mr-1.5" />
                첫 전략 만들기
              </Button>
            </Card>
          )}

          {/* ── 필터 결과 없음 ─────────────────────────────────── */}
          {!isLoading && totalCount > 0 && 보일개수 === 0 && (
            <Card className="flex flex-col items-center justify-center py-10 gap-3 text-center">
              <p className="text-text-muted text-sm">
                {종류 === "배분"
                  ? "저장한 자산배분이 없어요"
                  : 종류 === "신호"
                    ? "저장한 매매 신호가 없어요"
                    : <><span className="font-semibold text-text-secondary">{marketFilter}</span> 시장의 전략이 없어요</>}
              </p>
            </Card>
          )}

          {/* ── 전략 그리드 ────────────────────────────────────── */}
          {!isLoading && 보일개수 > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {/* ── 자산배분 실험 ──
                  매매 신호와 **다른 종류**라 배지로 갈라 둔다. 섞어 놓고
                  이름만 보면 어느 화면에서 열리는지 알 수 없어서, 눌러
                  보고 나서야 알게 된다. */}
              {보일실험.map((x: any) => (
                <Card key={`exp-${x.id}`} className="flex flex-col gap-0 p-0 overflow-hidden">
                  <div className="px-4 pt-4 pb-3 border-b border-border/60">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-text-primary text-sm truncate">{x.name}</span>
                          <Badge variant="purple">자산배분</Badge>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-text-muted">{x.start_date} ~ {x.end_date}</span>
                          <span className="text-xs text-text-dim">·</span>
                          <span className="text-xs text-text-muted">{x.currency}</span>
                        </div>
                      </div>
                      <PieChart size={16} className="text-text-muted flex-shrink-0 mt-0.5" />
                    </div>
                  </div>

                  <div className="px-4 py-3 flex flex-col gap-2 flex-1">
                    <div className="flex gap-1.5 flex-wrap">
                      <Badge>자산 {x.assets?.length ?? 0}개</Badge>
                      {x.rebalance_period !== "none" && <Badge>리밸런싱</Badge>}
                      {x.contribution_period !== "none" && <Badge variant="green">적립식</Badge>}
                      {!!x.cost_rate && <Badge variant="red">수수료 {x.cost_rate}%</Badge>}
                    </div>
                    {/* 무엇을 담았는지 이름으로 보여 준다 — 배지의 '자산 5개'
                        만으로는 어떤 조합인지 알 수 없어 열어 봐야 한다. */}
                    {!!x.assets?.length && (
                      <p className="text-xs text-text-secondary line-clamp-2 break-keep">
                        {x.assets.map((a: any) => a.name || a.symbol).join(" · ")}
                      </p>
                    )}
                  </div>

                  <div className="px-4 pb-4 pt-2 flex gap-2 border-t border-border/60 mt-1">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => navigate(`/backtest?experiment=${x.id}`)}
                    >
                      <BarChart2 size={13} className="inline mr-1" />
                      자산배분에서 열기
                    </Button>
                    <button
                      onClick={() => set지울실험({ id: x.id, name: x.name })}
                      aria-label={`${x.name} 삭제`}
                      className="flex items-center gap-1 px-2.5 py-1 text-text-muted hover:text-accent-red border border-border hover:border-accent-red/40 text-xs rounded-lg transition-colors"
                    >
                      <Trash2 size={11} />
                      삭제
                    </button>
                  </div>
                </Card>
              ))}

              {filteredStrategies.map((s: any) => {
                const entryCount = s.entry_conditions?.conditions?.length ?? 0;
                const exitCount  = s.exit_conditions?.conditions?.length ?? 0;

                return (
                  <Card key={s.id} className="flex flex-col gap-0 p-0 overflow-hidden">
                    {/* Header */}
                    <div className="px-4 pt-4 pb-3 border-b border-border/60">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-text-primary text-sm truncate">{s.name}</span>
                            <Badge variant={s.market === "KR" ? "blue" : "green"}>{s.market}</Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-text-muted">v{s.version ?? 1}</span>
                            <span className="text-xs text-text-dim">·</span>
                            <span className="text-xs text-text-muted">
                              {s.created_at?.slice(0, 10) ?? "-"}
                            </span>
                          </div>
                        </div>
                        <TrendingUp size={16} className="text-text-muted flex-shrink-0 mt-0.5" />
                      </div>
                    </div>

                    {/* Body */}
                    <div className="px-4 py-3 flex flex-col gap-2 flex-1">
                      {s.description && (
                        <p className="text-xs text-text-secondary line-clamp-2">{s.description}</p>
                      )}
                      {/* Condition counts */}
                      <div className="flex gap-1.5 flex-wrap">
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-accent-blue/15 border border-accent-blue/30 text-accent-blue rounded-lg font-medium">
                          <BarChart2 size={11} />
                          진입 {entryCount}조건
                        </span>
                        <span className="flex items-center gap-1 text-xs px-2 py-0.5 bg-accent-red/15 border border-accent-red/30 text-accent-red rounded-lg font-medium">
                          <BarChart2 size={11} />
                          청산 {exitCount}조건
                        </span>
                      </div>
                      {/* Stop-loss / take-profit */}
                      {(s.stop_loss || s.take_profit) && (
                        <div className="flex gap-1.5 flex-wrap">
                          {s.stop_loss   && <Badge variant="red">손절 {s.stop_loss}%</Badge>}
                          {s.take_profit && <Badge variant="green">익절 {s.take_profit}%</Badge>}
                        </div>
                      )}
                    </div>

                    {/* Footer / Actions */}
                    <div className="px-4 pb-4 pt-2 flex gap-2 border-t border-border/60 mt-1">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => navigate("/backtest")}
                      >
                        <BarChart2 size={13} className="inline mr-1" />
                        백테스트 실행
                      </Button>
                      {/* 삭제 확인을 **공용 창**으로 바꿨다.

                          예전에는 버튼이 '확인/취소' 로 바뀌는 방식이었다.
                          같은 앱 안에 삭제 확인이 세 가지였던 셈인데
                          (공용 창 · 이 방식 · 확인 없음), 되돌릴 수 없는
                          일에는 **무엇이 지워지는지 이름을 보여 주는**
                          공용 창이 맞다. */}
                      <button
                        onClick={() => set지울전략({ id: s.id, name: s.name })}
                        aria-label={`${s.name} 삭제`}
                        className="flex items-center gap-1 px-2.5 py-1 text-text-muted hover:text-accent-red border border-border hover:border-accent-red/40 text-xs rounded-lg transition-colors"
                      >
                        <Trash2 size={11} />
                        삭제
                      </button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      {지울전략 && (
        <ConfirmDialog
          title="전략을 지울까요?"
          message="지우면 되돌릴 수 없어요. 진입·청산 조건을 처음부터 다시 만들어야 해요."
          대상={지울전략.name}
          확인글="지우기"
          진행중={deleteMutation.isPending}
          onConfirm={() => deleteMutation.mutate(지울전략.id)}
          onClose={() => set지울전략(null)}
        />
      )}

      {지울실험 && (
        <ConfirmDialog
          title="자산배분을 지울까요?"
          message="지우면 되돌릴 수 없어요. 자산과 비중을 처음부터 다시 담아야 해요."
          대상={지울실험.name}
          확인글="지우기"
          진행중={실험지우기.isPending}
          onConfirm={() => 실험지우기.mutate(지울실험.id)}
          onClose={() => set지울실험(null)}
        />
      )}
    </div>
  );
}
