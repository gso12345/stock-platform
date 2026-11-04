/**
 * '불러오기' — 저장한 자산배분 실험과 매매 전략을 골라 연다(사용자가 고른 2번).
 *
 * 예전엔 백테스트 안에 '전략 저장소' 탭이 넷째 탭으로 있었다. 메뉴에도 '전략 저장소' 가 따로 있어서 같은 것이
 * 두 군데였고, 탭 줄이 넷이라 폰에서 꽉 찼다. 탭은 셋(자산배분·단일 종목·유니버스)으로 줄이고, 저장한 것은
 * 탭 줄 오른쪽 끝의 '불러오기' 단추로 연다 — 고르면 그 탭으로 가서 설정이 들어온다.
 *
 * 보고 고르는 창이라 휴대폰에서는 아래 시트(Modal 시트). 견주기·자세한 관리는 메뉴의 전략 저장소에서 한다.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, LogIn, X, ChevronRight } from "lucide-react";
import { backtestApi, type 저장된실험 } from "@/api/stocks";
import { useAuthStore } from "@/store/authStore";
import { Modal, ChipTabs, Badge, ConfirmDialog, 지움단추, 빈화면 } from "@/components/ui";
import { 읽을수있는오류 } from "@/utils/errors";
import { 주기표 } from "./AllocationForm";

export type 불러올칸 = "실험" | "전략";

export default function 불러오기창({ 처음칸, 닫기, 실험열기, 전략열기 }: {
  처음칸: 불러올칸;
  닫기: () => void;
  실험열기: (x: 저장된실험) => void;
  전략열기: (s: any) => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isLoggedIn } = useAuthStore();
  const [칸, set칸] = useState<불러올칸>(처음칸);
  const [오류, set오류] = useState<string | null>(null);
  const [지울것, set지울것] = useState<{ 종류: 불러올칸; id: number; name: string } | null>(null);

  const { data: 실험들 = [] } = useQuery({
    queryKey: ["backtest-experiments"], queryFn: backtestApi.getExperiments,
    enabled: isLoggedIn, staleTime: 300_000,
  });
  const { data: 전략들 = [] } = useQuery({
    queryKey: ["strategies"], queryFn: backtestApi.getStrategies, enabled: isLoggedIn,
  });

  const 지우기 = useMutation({
    mutationFn: (x: { 종류: 불러올칸; id: number }) =>
      x.종류 === "실험" ? backtestApi.deleteExperiment(x.id) : backtestApi.deleteStrategy(x.id),
    onSuccess: (_d, x) => {
      qc.invalidateQueries({ queryKey: x.종류 === "실험" ? ["backtest-experiments"] : ["strategies"] });
      set지울것(null);
    },
    /* 실패해도 확인 창은 닫는다 — 열어 두면 계속 누르게 되고, 그때마다 같은 요청이 나간다 */
    onError: (e: any, x) => {
      set지울것(null);
      set오류(읽을수있는오류(e?.response?.data?.detail,
        x.종류 === "실험" ? "실험을 지우지 못했어요" : "전략을 지우지 못했어요"));
    },
  });

  const 목록 = 칸 === "실험" ? 실험들 : (전략들 as any[]);

  return (
    <Modal 시트 onClose={닫기} maxWidth="max-w-lg" className="flex flex-col max-h-[85vh]">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h2 className="text-base font-bold text-text-primary">불러오기</h2>
        <button type="button" aria-label="닫기" onClick={닫기}
          className="p-1.5 -mr-1.5 rounded-full text-text-muted hover:text-text-primary hover:bg-bg-elevated">
          <X size={20} />
        </button>
      </div>

      {!isLoggedIn ? (
        <div className="px-4 pb-6">
          <빈화면 compact icon={LogIn} title="저장한 것을 불러오려면 로그인이 필요해요"
            action={{ label: "로그인하기", onClick: () => { 닫기(); navigate("/login"); } }} />
        </div>
      ) : (
        <>
          <ChipTabs ariaLabel="불러올 것" className="px-4 pb-2" active={칸} onChange={(id) => set칸(id as 불러올칸)}
            tabs={[{ id: "실험", label: "자산배분", count: 실험들.length },
                   { id: "전략", label: "매매 전략", count: (전략들 as any[]).length }]} />
          {오류 && (
            <p className="mx-4 mb-2 text-xs text-accent-red bg-accent-red/10 border border-accent-red/30 rounded-lg px-3 py-2">{오류}</p>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {목록.length === 0 ? (
              <div className="px-4 pb-6">
                <빈화면 compact icon={FlaskConical}
                  title={칸 === "실험" ? "저장한 자산배분이 없어요" : "저장한 매매 전략이 없어요"}
                  hint={칸 === "실험" ? "자산배분 탭에서 설정을 만들고 ‘저장’ 을 누르면 여기에 쌓여요."
                                     : "단일 종목·유니버스 탭에서 조건을 만들고 ‘저장’ 을 누르면 여기에 쌓여요."} />
              </div>
            ) : (
              <ul className="divide-y divide-border border-t border-border">
                {칸 === "실험" ? 실험들.map((x) => (
                  <li key={`exp-${x.id}`} className="flex items-center">
                    <button type="button" aria-label={`${x.name} 자산배분 실험 열기`}
                      onClick={() => { 실험열기(x); 닫기(); }}
                      className="min-w-0 flex-1 flex items-center gap-2 pl-4 pr-1 py-3 text-left hover:bg-bg-elevated transition-colors">
                      <div className="min-w-0 flex-1 flex flex-col gap-1">
                        <span className="text-sm font-semibold text-text-primary truncate">{x.name}</span>
                        <span className="text-2xs text-text-muted num">{x.start_date} ~ {x.end_date} · {x.currency}</span>
                        <span className="flex gap-1 flex-wrap">
                          <Badge>자산 {x.assets.length}개</Badge>
                          {x.rebalance_period !== "none" && (
                            <Badge>리밸런싱 {주기표.find((p) => p.value === x.rebalance_period)?.label}</Badge>
                          )}
                          {x.contribution_period !== "none" && <Badge variant="green">적립식</Badge>}
                          {!!x.cost_rate && <Badge variant="red">수수료 {x.cost_rate}%</Badge>}
                        </span>
                      </div>
                      <ChevronRight size={16} className="text-text-dim flex-shrink-0" />
                    </button>
                    <지움단추 ariaLabel={`${x.name} 지우기`} className="mr-3"
                      onClick={() => set지울것({ 종류: "실험", id: x.id, name: x.name })} />
                  </li>
                )) : (전략들 as any[]).map((s) => (
                  <li key={`st-${s.id}`} className="flex items-center">
                    <button type="button" aria-label={`${s.name} 전략 열기`}
                      onClick={() => { 전략열기(s); 닫기(); }}
                      className="min-w-0 flex-1 flex items-center gap-2 pl-4 pr-1 py-3 text-left hover:bg-bg-elevated transition-colors">
                      <div className="min-w-0 flex-1 flex flex-col gap-1">
                        <span className="text-sm font-semibold text-text-primary truncate">{s.name}</span>
                        <span className="text-2xs text-text-muted num">v{s.version} · {s.market} · {s.created_at?.slice(0, 10)}</span>
                        <span className="flex gap-1 flex-wrap">
                          {s.stop_loss && <Badge variant="red">손절 {s.stop_loss}%</Badge>}
                          {s.take_profit && <Badge variant="green">익절 {s.take_profit}%</Badge>}
                          <Badge>진입 {s.entry_conditions?.conditions?.length ?? 0}조건</Badge>
                          <Badge>청산 {s.exit_conditions?.conditions?.length ?? 0}조건</Badge>
                        </span>
                      </div>
                      <ChevronRight size={16} className="text-text-dim flex-shrink-0" />
                    </button>
                    <지움단추 ariaLabel={`${s.name} 지우기`} className="mr-3"
                      onClick={() => set지울것({ 종류: "전략", id: s.id, name: s.name })} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* 여러 실험을 나란히 견주는 것은 메뉴의 전략 저장소에 있다 — 여기서는 고르기만 한다 */}
          <button type="button" onClick={() => { 닫기(); navigate("/strategies"); }}
            className="mx-4 my-3 self-start text-xs text-accent-blue hover:underline">
            전략 저장소에서 견주고 관리하기
          </button>
        </>
      )}

      {지울것 && (
        <ConfirmDialog
          title={지울것.종류 === "실험" ? "실험을 지울까요?" : "전략을 지울까요?"}
          message={지울것.종류 === "실험"
            ? "지우면 되돌릴 수 없어요. 자산과 비중, 기간을 처음부터 다시 맞춰야 해요."
            : "지우면 되돌릴 수 없어요. 진입·청산 조건을 처음부터 다시 만들어야 해요."}
          대상={지울것.name}
          확인글="지우기"
          진행중={지우기.isPending}
          onConfirm={() => 지우기.mutate({ 종류: 지울것.종류, id: 지울것.id })}
          onClose={() => set지울것(null)}
        />
      )}
    </Modal>
  );
}
