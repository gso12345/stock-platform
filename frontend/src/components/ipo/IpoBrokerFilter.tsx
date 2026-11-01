/**
 * 내 증권사 고르기 — 사용자: "공모주 일정 증권사별로 설정해서 볼수 있게 만들어줘"
 *
 * 칩마다 그 증권사가 주관하는 곳 수를 붙인다. 고른 것은 설정에 남아 다음에 열어도 그대로다
 * (이 기기에만). 지금 목록에 없는 증권사도 골라 둔 것이면 칩으로 남긴다 — 그래야 뺄 수 있다.
 *
 * 고른 증권사는 휴대폰 알림·캘린더 구독에 쓴다. 목록은 따로 정한다 — 기본은 모든 공모주를 보이고
 * 내 증권사 것에 표시만 한다. '내 증권사 것만 보기' 를 누르면 목록도 거른다. 예전에는 고르면 목록까지
 * 걸러져, 알림은 내 증권사 것만 받으면서 다른 증권사 청약 일정은 볼 수 없었다(사용자: "선택한
 * 증권사만 알림을 오게 하면서 모든 증권사 청약일정을 확인할 수는 없어").
 */
import { 고른칩 } from "@/components/ui";
import { useSettingsStore } from "@/store/settingsStore";
import { 증권사별수 } from "./ipoBrokers";

const 글단추 = "font-semibold text-accent-blue hover:underline";

export default function IpoBrokerFilter({ 주관사칸들, 내것수, 모름수 }: {
  /** 다가오는 공모주마다의 주관사 칸 */
  주관사칸들: (string | null | undefined)[];
  /** 고른 증권사가 주관하는 곳 수 */
  내것수: number;
  /** 주관사를 아직 몰라 거르면 빠지는 곳 수 */
  모름수: number;
}) {
  const 고른 = useSettingsStore((s) => s.내증권사);
  const 토글 = useSettingsStore((s) => s.토글내증권사);
  const 내것만 = useSettingsStore((s) => s.공모주내것만);
  const set내것만 = useSettingsStore((s) => s.set공모주내것만);
  const 수 = 증권사별수(주관사칸들);
  const 칩들: [string, number][] = [
    ...수, ...고른.filter((x) => !수.some(([이름]) => 이름 === x)).map((x): [string, number] => [x, 0]),
  ];
  if (!칩들.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div role="group" aria-label="내 증권사 고르기" className="flex gap-1.5 overflow-x-auto sm:flex-wrap pb-0.5">
        {칩들.map(([이름, n]) => (
          <고른칩 key={이름} 작게 고름={고른.includes(이름)} onClick={() => 토글(이름)} ariaLabel={`${이름} ${n}곳`}>
            {이름} <span className="num opacity-70">{n}</span>
          </고른칩>
        ))}
      </div>
      <p className="text-2xs text-text-muted break-keep">
        {!고른.length ? (
          "청약할 증권사를 고르면 휴대폰 알림·캘린더 구독은 그 증권사 공모주만 받고, 목록에는 표시해 드려요. 고른 것은 이 기기에 남아요."
        ) : 내것만 ? (
          <>
            고른 증권사 {고른.length}곳이 주관하는 공모주 {내것수}곳만 보여요
            {모름수 > 0 && <> · 주관사가 아직 안 나온 {모름수}곳은 빠졌어요</>}
            {" "}
            <button type="button" onClick={() => set내것만(false)} className={글단추}>모두 보기</button>
          </>
        ) : (
          <>
            내 증권사 공모주 {내것수}곳에 표시했어요 · 휴대폰 알림·캘린더 구독은 고른 증권사 것만 받아요
            {" "}
            <button type="button" onClick={() => set내것만(true)} className={글단추}>내 증권사 것만 보기</button>
          </>
        )}
      </p>
    </div>
  );
}
