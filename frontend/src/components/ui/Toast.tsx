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

export function Toast({
  message, onClose, kind = "error", 자동닫힘 = 3000,
}: {
  message: string;
  onClose: () => void;
  kind?: 종류;
  /** 이 시간이 지나면 알아서 사라진다. 0 이면 안 사라진다 */
  자동닫힘?: number;
}) {
  useEffect(() => {
    // 오류는 사용자가 읽고 닫게 두고, 성공·안내는 알아서 사라진다.
    // 잘 됐다는 말을 굳이 누르게 할 이유가 없다.
    if (!message || !자동닫힘 || kind === "error") return;
    const t = setTimeout(onClose, 자동닫힘);
    return () => clearTimeout(t);
  }, [message, kind, 자동닫힘, onClose]);

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
