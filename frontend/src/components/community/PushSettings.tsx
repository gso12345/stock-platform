/**
 * 휴대폰 알림 — 앱을 닫아도 가격 알림·댓글·공모주 청약일을 휴대폰 알림으로.
 *
 * '알림 설정'(어떤 반응을 받을지) 바로 아래에 둔다. 그건 무엇을 받을지, 이건 어디로 받을지다.
 * 못 받는 경우(아이폰은 홈 화면에 추가해야 한다, 알림을 막아 뒀다)는 왜 못 받는지와 어떻게 풀지를 적는다 —
 * 단추만 회색으로 두면 고장 난 줄 안다.
 *
 * 공모주 청약 알림을 받을 증권사도 여기서 바로 고른다(사용자: "알림설정에서 그냥 어떤 증권사만 알림이
 * 오게할지 설정할 수 있도록 해줘"). 공모주 메뉴의 증권사 칩(목록 거르기)과는 따로다 — 목록을 보려고 고른
 * 증권사가 알림 증권사로 바뀌면 안 된다(사용자: "공모주메뉴에서 … 선택하는 건 그냥 선택한 공모주일정을
 * 보고 싶을 뿐 … 내 증권사라는 것이 아니"). 서버 구독에는 앱 틀이 한 곳에서 알린다(use증권사알림맞추기).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { useWebPush } from "@/hooks/useWebPush";
import { useSettingsStore } from "@/store/settingsStore";
import { ipoApi } from "@/api/stocks";
import { InlineSpinner, 고른칩 } from "@/components/ui";
import { 알림증권사칩 } from "@/components/ipo/ipoBrokers";

const 단추 = "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50";

/** 처음에 보이는 증권사 칩 수 — 나머지는 '더 보기'(골라 둔 것은 늘 보인다) */
export const 처음보일증권사 = 10;

/** 공모주 청약 알림을 받을 증권사 — 안 고르면 모든 공모주 */
function 알림증권사고르기() {
  const 고른 = useSettingsStore((s) => s.알림증권사);
  const 토글 = useSettingsStore((s) => s.토글알림증권사);
  const 비우기 = useSettingsStore((s) => s.set알림증권사);
  const [다보기, set다보기] = useState(false);
  const { data: 목록, isLoading, isError } = useQuery({
    queryKey: ["ipo-brokers"],
    queryFn: ipoApi.brokers,
    staleTime: 60 * 60_000,
    retry: 1,
  });
  // 받는 동안에는 골라 둔 것만 — 자주 주관하는 곳을 먼저 깔았다가 받은 목록으로 바꾸면 칩이 손가락 밑에서 자리를 옮긴다
  const 이름들 = isLoading ? 고른 : 알림증권사칩(목록?.map((b) => b.name), 고른);
  const 보일것 = 다보기 ? 이름들 : 이름들.filter((x, i) => i < 처음보일증권사 || 고른.includes(x));
  const 남은수 = 이름들.length - 보일것.length;

  return (
    <div className="flex flex-col gap-1.5 pl-6">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-2xs font-semibold text-text-secondary">알림 받을 증권사</p>
        {고른.length > 0 && (
          <button type="button" onClick={() => 비우기([])}
            className="text-2xs text-text-muted hover:text-accent-blue">
            모두 풀기
          </button>
        )}
      </div>
      <div role="group" aria-label="알림 받을 증권사" className="flex flex-wrap gap-1.5">
        {보일것.map((이름) => (
          <고른칩 key={이름} 작게 고름={고른.includes(이름)} onClick={() => 토글(이름)}>{이름}</고른칩>
        ))}
        {isLoading && <InlineSpinner className="w-3 h-3 self-center" />}
        {남은수 > 0 && (
          <button type="button" onClick={() => set다보기(true)}
            className="px-1.5 text-2xs font-semibold text-accent-blue hover:underline">
            +{남은수}곳 더 보기
          </button>
        )}
      </div>
      <p className="text-2xs text-text-dim break-keep">
        안 고르면 모든 공모주를 알려 드려요. 공모주 메뉴에서 목록을 거르는 증권사와는 따로예요.
        {isError && " 증권사 목록을 받지 못해 자주 주관하는 곳만 보여요."}
      </p>
    </div>
  );
}

export default function PushSettings() {
  const { 상태, 처리중, 오류, 공모주, 켜기, 끄기, 공모주바꾸기, 시험 } = useWebPush();
  const 알림증권사 = useSettingsStore((s) => s.알림증권사);
  const [시험결과, set시험결과] = useState<string | null>(null);

  const 안내: Record<string, string> = {
    안됨: "이 브라우저는 휴대폰 알림을 받을 수 없어요. 크롬·삼성 인터넷·엣지에서 열어 주세요.",
    설치필요: "아이폰은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요. 사파리 아래 공유 단추 › '홈 화면에 추가' 를 누른 뒤, 추가된 앱에서 다시 켜 주세요.",
    막힘: "이 사이트의 알림을 막아 두셨어요. 브라우저(휴대폰) 설정에서 알림을 허용한 뒤 다시 열어 주세요.",
  };

  return (
    <section aria-labelledby="휴대폰알림" className="bg-bg-card border border-border rounded-2xl px-4 py-3 flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Smartphone size={14} className={상태 === "켜짐" ? "text-accent-green" : "text-text-muted"} />
        <h2 id="휴대폰알림" className="text-xs font-semibold text-text-primary">휴대폰 알림</h2>
        <span className="text-2xs text-text-dim">
          {상태 === "켜짐" ? "이 기기에서 받는 중" : 상태 === "꺼짐" ? "꺼져 있어요" : ""}
        </span>
        <div className="flex-1" />
        {상태 === "확인중" && <InlineSpinner className="w-3 h-3" />}
        {상태 === "꺼짐" && (
          <button type="button" onClick={() => void 켜기()} disabled={처리중}
            className={`${단추} bg-accent-blue text-white hover:bg-accent-blue/90`}>
            {처리중 ? "켜는 중…" : "켜기"}
          </button>
        )}
        {상태 === "켜짐" && (
          <button type="button" onClick={() => void 끄기()} disabled={처리중}
            className={`${단추} border border-border text-text-muted hover:text-accent-red hover:border-accent-red/40`}>
            끄기
          </button>
        )}
      </div>

      <p className="text-2xs text-text-dim break-keep">
        {안내[상태] ?? "앱을 닫아도 가격 알림·내 글의 댓글·공모주 청약일을 휴대폰 알림으로 받아요. 기기마다 따로 켜요."}
        {상태 === "꺼짐" && " 켜면 공모주 청약 알림을 받을 증권사도 고를 수 있어요."}
      </p>

      {상태 === "켜짐" && (
        <>
          <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
            <input type="checkbox" checked={공모주} onChange={(e) => void 공모주바꾸기(e.target.checked)}
              className="mt-0.5 accent-accent-blue" />
            <span className="break-keep">
              공모주 청약 첫날·마지막 날 아침 8:30~9:00 에 알림
              <span className="block text-2xs text-text-dim">
                {알림증권사.length ? `고른 증권사 ${알림증권사.length}곳이 주관하는 공모주만` : "모든 공모주 — 아래에서 증권사를 고르면 그 증권사 것만"}
              </span>
            </span>
          </label>
          {공모주 && <알림증권사고르기 />}
          <div className="flex items-center gap-2">
            <button type="button"
              onClick={async () => set시험결과((await 시험()) ? "보냈어요 — 몇 초 안에 휴대폰에 떠요" : null)}
              className={`${단추} border border-border text-text-secondary hover:text-accent-blue hover:border-accent-blue/40`}>
              시험 알림 보내기
            </button>
            {시험결과 && <span role="status" className="text-2xs text-accent-green">{시험결과}</span>}
          </div>
        </>
      )}
      {오류 && <p role="alert" className="text-2xs text-accent-red">{오류}</p>}
    </section>
  );
}
