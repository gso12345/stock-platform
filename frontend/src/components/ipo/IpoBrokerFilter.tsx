/**
 * 다가오는 공모주를 증권사로 거른다 — 사용자: "공모주 일정 증권사별로 설정해서 볼수 있게 만들어줘"
 *
 * 보기만 거른다. 휴대폰 알림을 받을 증권사는 알림 화면에서 따로 고른다 — 한때 둘이 한 설정이라, 목록을
 * 보려고 고른 증권사가 알림 증권사로 바뀌었다(사용자: "공모주메뉴에서 … 선택하는 건 그냥 선택한
 * 공모주일정을 보고 싶을 뿐 … 내 증권사라는 것이 아니").
 *
 * 칩마다 그 증권사가 주관하는 곳 수를 붙인다. 고른 것은 설정에 남아 다음에 열어도 그대로다
 * (이 기기에만). 지금 목록에 없는 증권사도 골라 둔 것이면 칩으로 남긴다 — 그래야 뺄 수 있다.
 */
import { Link } from "react-router-dom";
import { 고른칩 } from "@/components/ui";
import { use끝흐림 } from "@/hooks/useEdgeFade";
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
  const [칩줄, 칩줄흐림] = use끝흐림<HTMLDivElement>();   // 휴대폰에서 옆으로 넘기는 칩 줄 — 더 있는 쪽 끝을 흐린다
  const 고른 = useSettingsStore((s) => s.공모주증권사);
  const 토글 = useSettingsStore((s) => s.토글공모주증권사);
  const 비우기 = useSettingsStore((s) => s.set공모주증권사);
  const 수 = 증권사별수(주관사칸들);
  const 칩들: [string, number][] = [
    ...수, ...고른.filter((x) => !수.some(([이름]) => 이름 === x)).map((x): [string, number] => [x, 0]),
  ];
  if (!칩들.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div ref={칩줄} role="group" aria-label="증권사로 거르기"
        className={`flex gap-1.5 overflow-x-auto sm:flex-wrap pb-0.5 ${칩줄흐림}`}>
        {칩들.map(([이름, n]) => (
          <고른칩 key={이름} 작게 고름={고른.includes(이름)} onClick={() => 토글(이름)} ariaLabel={`${이름} ${n}곳`}>
            {이름} <span className="num opacity-70">{n}</span>
          </고른칩>
        ))}
      </div>
      <p className="text-2xs text-text-muted break-keep">
        {고른.length ? (
          <>
            고른 증권사 {고른.length}곳이 주관하는 공모주 {보이는수}곳만 보여요
            {모름수 > 0 && <> · 주관사가 아직 안 나온 {모름수}곳은 빠졌어요</>}
            {" "}
            <button type="button" onClick={() => 비우기([])} className="font-semibold text-accent-blue hover:underline">
              모두 보기
            </button>
          </>
        ) : (
          <>
            증권사를 고르면 그 증권사가 주관하는 공모주만 보여요. 휴대폰 알림을 받을 증권사는{" "}
            <Link to="/notifications" className="font-semibold text-accent-blue hover:underline">알림 화면</Link>에서 따로 골라요.
          </>
        )}
      </p>
    </div>
  );
}
