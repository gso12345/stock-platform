/**
 * 휴대폰 알림 — 앱을 닫아도 가격 알림·댓글·공모주 청약일을 휴대폰 알림으로.
 *
 * '알림 설정'(어떤 반응을 받을지) 바로 아래에 둔다. 그건 무엇을 받을지, 이건 어디로 받을지다.
 * 못 받는 경우(아이폰은 홈 화면에 추가해야 한다, 알림을 막아 뒀다)는 왜 못 받는지와 어떻게 풀지를 적는다 —
 * 단추만 회색으로 두면 고장 난 줄 안다.
 */
import { useState } from "react";
import { Smartphone } from "lucide-react";
import { useWebPush } from "@/hooks/useWebPush";
import { useSettingsStore } from "@/store/settingsStore";
import { InlineSpinner } from "@/components/ui";

const 단추 = "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50";

export default function PushSettings() {
  const { 상태, 처리중, 오류, 공모주, 켜기, 끄기, 공모주바꾸기, 시험 } = useWebPush();
  const 내증권사 = useSettingsStore((s) => s.내증권사);
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
      </p>

      {상태 === "켜짐" && (
        <>
          <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
            <input type="checkbox" checked={공모주} onChange={(e) => void 공모주바꾸기(e.target.checked)}
              className="mt-0.5 accent-accent-blue" />
            <span className="break-keep">
              공모주 청약 첫날·마지막 날 아침에 알림
              <span className="block text-2xs text-text-dim">
                {내증권사.length ? `고른 증권사(${내증권사.join(" · ")})가 주관하는 공모주만` : "모든 공모주 — 공모주 메뉴에서 증권사를 고르면 그 증권사 것만"}
              </span>
            </span>
          </label>
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
