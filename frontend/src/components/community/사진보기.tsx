/**
 * 사진 크게 보기 — 검은 화면 가득, 두 손가락으로 키우고, 아래로 밀거나 X 로 닫는다(사용자가 고른 9번).
 *
 * 예전에는 피드에서 사진을 누르면 글로 넘어갔고, 세로로 긴 사진은 잘린 채로만 볼 수 있었다.
 *
 *   · 두 손가락 — 1~4배로 키운다. 키운 채 한 손가락으로 끌면 옮긴다
 *   · 두 번 누르기 — 2.5배 ↔ 원래대로
 *   · 원래 크기에서 아래로 밀기 — 시트와 같은 기준(hooks/useSheet 의 닫을까)으로 닫는다
 *   · 바깥(검은 곳)·X·Esc — 닫는다
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { 닫을까 } from "@/hooks/useSheet";

export const 최대배율 = 4;
const 두번배율 = 2.5;

type 점 = { x: number; y: number };
const 거리 = (a: 점, b: 점) => Math.hypot(a.x - b.x, a.y - b.y);
export const 배율맞추기 = (v: number) => Math.min(최대배율, Math.max(1, v));

export default function 사진보기({ 주소, 설명 = "첨부 사진", 닫기 }: {
  주소: string;
  설명?: string;
  닫기: () => void;
}) {
  const [배율, set배율] = useState(1);
  const [이동, set이동] = useState<점>({ x: 0, y: 0 });
  const [내림, set내림] = useState(0);
  const [끄는중, set끄는중] = useState(false);
  const 손가락들 = useRef(new Map<number, 점>());
  const 시작 = useRef<{ 거리: number; 배율: number; 이동: 점; 점: 점; 때: number } | null>(null);

  // Esc 로 닫고, 뒤 화면이 같이 스크롤되지 않게 한다
  useEffect(() => {
    const 키 = (e: KeyboardEvent) => { if (e.key === "Escape") 닫기(); };
    window.addEventListener("keydown", 키);
    const 원래 = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", 키);
      document.body.style.overflow = 원래;
    };
  }, [닫기]);

  const 처음부터 = (지금: 점, 때: number) => {
    const 둘 = [...손가락들.current.values()];
    시작.current = {
      거리: 둘.length >= 2 ? 거리(둘[0], 둘[1]) : 0,
      배율, 이동, 점: 지금, 때,
    };
  };

  const 누름 = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    손가락들.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    set끄는중(true);
    처음부터({ x: e.clientX, y: e.clientY }, performance.now());
  };

  const 움직임 = (e: React.PointerEvent) => {
    if (!손가락들.current.has(e.pointerId) || !시작.current) return;
    손가락들.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const 둘 = [...손가락들.current.values()];
    const s = 시작.current;
    if (둘.length >= 2 && s.거리 > 0) {
      set배율(배율맞추기(s.배율 * (거리(둘[0], 둘[1]) / s.거리)));
      return;
    }
    const dx = e.clientX - s.점.x;
    const dy = e.clientY - s.점.y;
    if (s.배율 > 1) set이동({ x: s.이동.x + dx, y: s.이동.y + dy });
    else set내림(Math.max(0, dy));
  };

  const 뗌 = (e: React.PointerEvent) => {
    if (!손가락들.current.delete(e.pointerId)) return;
    const s = 시작.current;
    if (손가락들.current.size > 0) {
      // 두 손가락 중 하나만 뗐다 — 남은 손가락으로 이어서 옮기게 지금 상태에서 다시 잰다
      const 남은 = [...손가락들.current.values()][0];
      처음부터(남은, performance.now());
      return;
    }
    set끄는중(false);
    시작.current = null;
    if (배율 <= 1.05) {                      // 거의 원래 크기면 딱 맞춘다
      set배율(1);
      set이동({ x: 0, y: 0 });
    }
    if (s && s.배율 <= 1 && 내림 > 0) {
      if (닫을까(내림, performance.now() - s.때)) { 닫기(); return; }
      set내림(0);
    }
  };

  const 두번 = () => {
    if (배율 > 1) { set배율(1); set이동({ x: 0, y: 0 }); }
    else set배율(두번배율);
  };

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="사진 크게 보기"
      className="fixed inset-0 z-[80] flex items-center justify-center modal-backdrop"
      // 아래로 밀수록 뒤가 조금씩 비친다 — 닫힌다는 걸 미리 보여 준다
      style={{ backgroundColor: `rgba(0,0,0,${1 - Math.min(내림 / 400, 0.6)})` }}
      onClick={(e) => { if (e.target === e.currentTarget) 닫기(); }}>
      <button type="button" aria-label="닫기" onClick={닫기}
        className="absolute right-3 z-10 p-2 rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors"
        style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
        <X size={20} />
      </button>
      <img src={주소} alt={설명} draggable={false}
        onPointerDown={누름} onPointerMove={움직임} onPointerUp={뗌} onPointerCancel={뗌}
        onDoubleClick={두번}
        className="max-w-full max-h-full object-contain select-none touch-none"
        style={{
          transform: `translate(${이동.x}px, ${이동.y + 내림}px) scale(${배율})`,
          transition: 끄는중 ? "none" : "transform 0.2s ease",
        }} />
    </div>,
    document.body,
  );
}
