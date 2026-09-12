import { X, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { useEffect } from "react";

/**
 * 화면 상단 중앙에 잠깐 띄우는 알림.
 *
 * 예전에는 관심종목은 토스트로, 내 자산은 모달 안쪽에 오류를 표시해서
 * 같은 종류의 실패인데 사용자가 보는 위치가 달랐다. 이 컴포넌트로 통일한다.
 *
 * 여기에 성공·안내도 더한다. 커뮤니티 쪽이 alert() 를 쓰고 있었는데
 * ("신고가 접수되었습니다"), 브라우저 기본 창은
 *   · 앱 모양과 따로 놀고
 *   · 사용자가 반드시 눌러야 사라지며
 *   · 휴대폰에서는 화면 한가운데를 덮는다
 * 성공을 알리는 데 그렇게까지 막아설 이유가 없다.
 */
type 종류 = "error" | "success" | "info";

const 모양: Record<종류, { 바탕: string; Icon: any }> = {
  error:   { 바탕: "bg-accent-red",   Icon: AlertTriangle },
  success: { 바탕: "bg-accent-green", Icon: CheckCircle2 },
  info:    { 바탕: "bg-accent-blue",  Icon: Info },
};

/** 종류별 기본 머무는 시간.
 *
 *  오류가 더 길다 — 읽고 뜻을 알아채는 데 시간이 걸리고, 대개 무엇을
 *  해야 하는지("잠시 후 다시")까지 적혀 있다. 성공은 '잘 됐다' 한마디라
 *  짧아도 된다.
 *
 *  오류는 예전에 **아예 안 닫혔다.** 사용자가 읽고 직접 닫으라는
 *  뜻이었는데, 서버가 자다 깨는 동안에는 그 빨간 띠가 화면 맨 위에
 *  계속 붙어 있었다 — 이미 다시 붙어 정상으로 돌아온 뒤에도 그렇다.
 *  고장이 끝났는데 고장 표시만 남는 셈이라, 오히려 틀린 정보가 된다. */
const 머무는시간: Record<종류, number> = {
  error:   7000,
  success: 3000,
  info:    3000,
};

export function Toast({
  message, onClose, kind = "error", 자동닫힘,
}: {
  message: string;
  onClose: () => void;
  kind?: 종류;
  /** 이 시간이 지나면 알아서 사라진다. 0 이면 안 사라진다.
   *  안 주면 종류에 맞는 기본값(머무는시간)을 쓴다. */
  자동닫힘?: number;
}) {
  const 머물기 = 자동닫힘 ?? 머무는시간[kind];
  useEffect(() => {
    /* 0 을 주면 안 닫힌다 — 사용자가 반드시 봐야 하는 자리를 위해 남긴다.
       `!머물기` 로 검사하므로 0 도 undefined 도 여기서 걸린다. */
    if (!message || !머물기) return;
    const t = setTimeout(onClose, 머물기);
    return () => clearTimeout(t);
  }, [message, 머물기, onClose]);

  if (!message) return null;
  const { 바탕, Icon } = 모양[kind];
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 max-w-[calc(100vw-2rem)] px-4 py-2.5 ${바탕} text-white text-xs font-semibold rounded-xl shadow-float animate-fade-in`}
    >
      <Icon size={14} className="flex-shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
      <button
        onClick={onClose}
        aria-label="닫기"
        className="ml-1 p-1 -m-1 opacity-70 hover:opacity-100 flex-shrink-0"
      >
        <X size={13} />
      </button>
    </div>
  );
}

/** 예전 이름 — 이미 쓰고 있는 곳이 있어 남겨 둔다 */
export function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  return <Toast message={message} onClose={onClose} kind="error" />;
}
