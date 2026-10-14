/**
 * 다가오는 공모주를 증권사로 거른다 — 사용자: "공모주 일정 증권사별로 설정해서 볼수 있게 만들어줘"
 *
 * 칩마다 그 증권사가 주관하는 곳 수를 붙인다. 고른 것은 설정에 남아 다음에 열어도 그대로다
 * (이 기기에만). 지금 목록에 없는 증권사도 골라 둔 것이면 칩으로 남긴다 — 그래야 뺄 수 있다.
 */
import { 고른칩 } from "@/components/ui";
import { useSettingsStore } from "@/store/settingsStore";
import { 증권사별수 } from "./ipoBrokers";

export default function IpoBrokerFilter({ 주관사칸들, 보이는수, 모름수 }: {
  /** 다가오는 공모주마다의 주관사 칸 */
  주관사칸들: (string | null | undefined)[];
  /** 걸러서 보이는 곳 수 */
  보이는수: number;
  /** 주관사를 아직 몰라 거르면 빠지는 곳 수 */
  모름수: number;
}) {
  const 고른 = useSettingsStore((s) => s.내증권사);
  const 토글 = useSettingsStore((s) => s.토글내증권사);
  const 비우기 = useSettingsStore((s) => s.set내증권사);
  const 수 = 증권사별수(주관사칸들);
  const 칩들: [string, number][] = [
    ...수, ...고른.filter((x) => !수.some(([이름]) => 이름 === x)).map((x): [string, number] => [x, 0]),
  ];
  if (!칩들.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {/* 안 골랐을 때 긴 안내 글을 두지 않는다 — '증권사' 이름표와 칩만으로 무엇을 하는 줄인지 보인다 */}
      <div role="group" aria-label="증권사로 거르기" className="flex items-center gap-1.5 overflow-x-auto sm:flex-wrap pb-0.5">
        <span className="text-2xs font-semibold text-text-muted shrink-0">증권사</span>
        {칩들.map(([이름, n]) => (
          <고른칩 key={이름} 작게 고름={고른.includes(이름)} onClick={() => 토글(이름)} ariaLabel={`${이름} ${n}곳`}>
            {이름} <span className="num opacity-70">{n}</span>
          </고른칩>
        ))}
      </div>
      {고른.length > 0 && (
        <p className="text-2xs text-text-muted break-keep">
          고른 증권사 공모주 {보이는수}곳만 보는 중
          {모름수 > 0 && <> · 주관사 모르는 {모름수}곳 빠짐</>}
          {" · "}
          <button type="button" onClick={() => 비우기([])} className="font-semibold text-accent-blue hover:underline">
            모두 보기
          </button>
        </p>
      )}
    </div>
  );
}
