/**
 * 값이 바뀌면 잠깐 깜빡이는 숫자.
 *
 * 시세가 실제로 갱신돼도 화면에 아무 변화가 없으면, 숫자를 계속 응시하지 않는 한
 * 갱신 사실을 알 수 없다. 데이터가 실시간이어도 '멈춘 화면'으로 느껴진다.
 * 증권사 앱이 값이 바뀔 때 셀을 깜빡이는 이유가 이것이다.
 *
 * 오른 쪽/내린 쪽 색은 사용자의 등락 색상 설정을 따른다(초록/빨강 ↔ 빨강/파랑).
 */
import { memo, useEffect, useRef, useState } from "react";
import { usePnlColors } from "@/hooks/usePnlColors";
import { useSettingsStore } from "@/store/settingsStore";

type Dir = "up" | "down" | null;

function LivePriceInner({
  value,
  children,
  className = "",
}: {
  /** 비교 기준이 되는 숫자. 이 값이 바뀔 때만 깜빡인다 */
  value: number | null | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  const [dir, setDir] = useState<Dir>(null);
  const prev = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    // 첫 렌더(비교 대상 없음)와 값이 없는 경우는 깜빡이지 않는다 —
    // 화면에 처음 뜰 때 전부 깜빡이면 오히려 시끄럽다
    if (before === undefined || before === null || value == null || before === value) return;
    setDir(value > before ? "up" : "down");
    const t = setTimeout(() => setDir(null), 900);
    return () => clearTimeout(t);
  }, [value]);

  const scheme = useSettingsStore((st) => st.colorScheme);
  const { gain, loss } = usePnlColors(scheme);
  const flash =
    dir === "up"   ? `${gain} bg-current/10`
  : dir === "down" ? `${loss} bg-current/10`
  : "";

  return (
    <span className={`inline-block rounded px-0.5 -mx-0.5 transition-colors duration-500 ${flash} ${className}`}>
      {children}
    </span>
  );
}

export default memo(LivePriceInner);
