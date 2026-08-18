/**
 * 첫 화면이 오래 걸릴 때 무슨 일이 일어나는지 알려 준다.
 *
 * "처음 볼 때 너무 느리다" 의 실체는 캐시가 아니라 서버가 자고 있다는 것이다.
 * Render 무료 플랜은 15분 동안 아무도 안 들어오면 서버를 내린다. 다음 사람이
 * 들어오면 그때부터 깨우는데 20~45초가 걸린다. 그동안 화면에는 "로딩 중..."
 * 다섯 글자만 있었다 — 사용자는 고장난 줄 알고 나가 버린다.
 *
 * 고칠 수 없는 값이라면 최소한 무슨 일인지는 알려 줘야 한다. 기다리는 시간이
 * 같아도, 이유를 아는 3초와 모르는 3초는 다르게 느껴진다.
 *
 * 단계별로 말을 바꾼다.
 *   0~2초    아무 말도 안 한다 (대개 여기서 끝난다. 괜히 겁줄 필요 없다)
 *   2~6초    "불러오는 중"
 *   6초~     "서버를 깨우는 중" + 왜 그런지 한 줄
 *   25초~    "거의 다 됐어요" — 여기까지 오면 곧 열린다
 */
import { useEffect, useState } from "react";

/** 몇 초에 무슨 말을 할지. 앞에서부터 지난 것 중 마지막을 쓴다 */
const 단계 = [
  { 초: 0,  글: null,               설명: null },
  { 초: 2,  글: "불러오는 중",       설명: null },
  { 초: 6,  글: "서버를 깨우는 중",   설명: "무료 서버라 한동안 접속이 없으면 잠듭니다. 처음 한 번만 느려요" },
  { 초: 25,글: "거의 다 됐어요",     설명: "조금만 더 기다려 주세요" },
] as const;

export default function BootScreen() {
  const [지난초, set지난초] = useState(0);

  useEffect(() => {
    const 시작 = Date.now();
    const t = setInterval(() => set지난초(Math.floor((Date.now() - 시작) / 1000)), 500);
    return () => clearInterval(t);
  }, []);

  const 지금 = [...단계].reverse().find((s) => 지난초 >= s.초) ?? 단계[0];

  return (
    <div className="flex flex-col items-center justify-center h-screen gap-3 px-8">
      <div className="w-6 h-6 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
      {/* 처음 2초는 글자를 안 띄운다 — 대개 그 안에 끝나고,
          짧게 스쳐 지나가는 글자는 오히려 어수선하다 */}
      {지금.글 && (
        <div className="flex flex-col items-center gap-1 text-center animate-fade-in">
          <p className="text-sm text-text-secondary">{지금.글}</p>
          {지금.설명 && (
            <p className="text-2xs text-text-dim max-w-[16rem] leading-relaxed">{지금.설명}</p>
          )}
        </div>
      )}
    </div>
  );
}
