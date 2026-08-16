/**
 * 되돌릴 수 없는 일을 하기 전에 한 번 묻는다.
 *
 * 관리자 화면에는 파괴적인 단추가 여럿인데 확인 절차가 제각각이었다.
 *   · 글·댓글 삭제 — 제대로 된 확인 창이 있었다
 *   · 캐시 전체 초기화 — 캐시 탭에는 window.confirm 이, 대시보드에는 아무것도
 *   · 계정 정지·커뮤니티 차단 — 클릭 한 번에 바로 실행
 *
 * 계정 정지는 그 사람이 로그인을 못 하게 되는 일이다. 잘못 누르면 사용자는
 * 이유도 모른 채 막힌다. 캐시 전체 초기화도 0.15 CPU 서버에서는 한동안
 * 모든 화면이 느려진다.
 *
 * window.confirm 을 안 쓴 이유 — 브라우저 기본 창은 앱의 모양과 따로 놀고,
 * 무엇이 지워지는지(대상 이름)를 보여 줄 수 없다. 무엇을 되돌릴 수 없는지
 * 적어 주는 것이 확인 절차의 핵심이다.
 */
import { Modal } from "@/components/ui";
import { AlertTriangle } from "lucide-react";

export default function ConfirmDialog({
  title, message, 대상, 위험 = true, 확인글 = "확인", 진행중 = false, onConfirm, onClose,
}: {
  title: string;
  /** 무슨 일이 벌어지는지. 되돌릴 수 없으면 그렇다고 적는다 */
  message: string;
  /** 무엇에 대한 일인지 (사용자 이름·캐시 키 등). 있으면 크게 보여 준다 */
  대상?: string;
  /** 되돌릴 수 없는 일이면 빨강, 되돌릴 수 있으면 파랑 */
  위험?: boolean;
  확인글?: string;
  진행중?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal maxWidth="max-w-sm" onClose={진행중 ? () => {} : onClose}>
      <div className="p-5 flex flex-col gap-4">
        <div className="flex gap-3">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
            위험 ? "bg-accent-red/15 text-accent-red" : "bg-accent-blue/15 text-accent-blue"}`}>
            <AlertTriangle size={17} />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <h3 className="text-sm font-bold text-text-primary">{title}</h3>
            <p className="text-xs text-text-muted">{message}</p>
            {대상 && (
              /* 무엇에 대한 일인지 눈으로 확인하게 한다 — 목록에서 옆줄을
                 잘못 누르는 것이 가장 흔한 실수다 */
              <p className="text-sm font-mono font-semibold text-text-primary mt-1 break-all">{대상}</p>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={진행중}
            className="flex-1 py-2.5 rounded-xl border border-border text-sm text-text-secondary hover:border-accent-blue/50 transition-all disabled:opacity-50"
          >
            취소
          </button>
          <button
            onClick={onConfirm}
            disabled={진행중}
            className={`flex-1 py-2.5 rounded-xl text-white text-sm font-semibold transition-all disabled:opacity-50 ${
              위험 ? "bg-accent-red hover:bg-accent-red/90" : "bg-accent-blue hover:bg-accent-blue/90"}`}
          >
            {진행중 ? "처리 중..." : 확인글}
          </button>
        </div>
      </div>
    </Modal>
  );
}
