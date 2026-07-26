import { X } from "lucide-react";

/**
 * 오류 토스트 — 화면 상단 중앙에 잠깐 띄우는 알림.
 *
 * 예전에는 관심종목은 토스트로, 내 자산은 모달 안쪽에 오류를 표시해서
 * 같은 종류의 실패인데 사용자가 보는 위치가 달랐다. 이 컴포넌트로 통일한다.
 */
export function ErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 max-w-[calc(100vw-2rem)] px-4 py-2.5 bg-accent-red text-white text-xs font-semibold rounded-xl shadow-lg animate-fade-in"
    >
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
