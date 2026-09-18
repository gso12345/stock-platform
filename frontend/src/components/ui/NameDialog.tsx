/**
 * 저장하기 전에 **이름을 묻는다.**
 *
 * ── 왜 자동 이름이 안 되나 ─────────────────────────────────
 *
 * 자산배분 실험은 담은 자산 이름을 이어 붙여 저장했다 —
 * 'S&P 500 · 미국 장기국채 · 금'. 값은 맞지만 쓸 수가 없다.
 *
 *   · **비슷한 것을 여러 개 저장하면 전부 같은 이름이 된다.**
 *     주식 60/40 과 70/30 을 견주려고 둘 다 저장하면 목록에 똑같은
 *     줄이 두 개 뜬다. 어느 쪽이 무엇인지 열어 봐야 안다.
 *   · 사람이 기억하는 이름은 구성이 아니라 **의도**다 —
 *     '은퇴자금 안전형', '공격적으로 10년'.
 *
 * 그래서 자동 이름은 **첫 값**으로만 쓰고 고칠 수 있게 한다. 빈칸으로
 * 두면 저장이 안 되게 막는 대신, 열 때 이미 채워 두고 전체를 골라 둔다 —
 * 그대로 저장하고 싶은 사람은 확인만 누르면 된다.
 */
import { useEffect, useRef, useState } from "react";
import { Modal } from "./index";

export default function NameDialog({
  title, 설명, 첫값 = "", 확인글 = "저장", 진행중 = false, onConfirm, onClose,
}: {
  title: string;
  설명?: string;
  /** 열 때 미리 채워 둘 이름 */
  첫값?: string;
  확인글?: string;
  진행중?: boolean;
  onConfirm: (이름: string) => void;
  onClose: () => void;
}) {
  const [이름, set이름] = useState(첫값);
  const 칸 = useRef<HTMLInputElement>(null);

  /* 열자마자 전체를 골라 둔다. 그대로 쓸 사람은 확인만, 바꿀 사람은
     바로 치면 된다 — 커서만 두면 지우는 손짓이 한 번 더 든다. */
  useEffect(() => {
    칸.current?.focus();
    칸.current?.select();
  }, []);

  const 쓸이름 = 이름.trim();
  const 보낼수있나 = !!쓸이름 && !진행중;

  return (
    <Modal maxWidth="max-w-sm" onClose={진행중 ? () => {} : onClose}>
      <form
        className="p-5 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (보낼수있나) onConfirm(쓸이름);
        }}
      >
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-bold text-text-primary">{title}</h3>
          {설명 && <p className="text-xs text-text-muted break-keep">{설명}</p>}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="이름칸" className="text-xs text-text-muted">이름</label>
          <input
            id="이름칸"
            ref={칸}
            value={이름}
            maxLength={100}
            onChange={(e) => set이름(e.target.value)}
            placeholder="예: 은퇴자금 안전형"
            className="bg-bg-elevated border border-border rounded-xl px-3 py-2.5 text-sm text-text-primary focus:outline-none focus:border-accent-blue"
          />
          {/* 빈칸이면 **왜 안 되는지** 적는다. 단추만 흐려 두면
              사용자는 앱이 고장 난 줄 안다. */}
          {!쓸이름 && (
            <span className="text-2xs text-text-dim">이름을 적어야 저장할 수 있어요.</span>
          )}
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={진행중}
            className="flex-1 py-2.5 rounded-xl border border-border text-sm text-text-secondary hover:border-accent-blue/50 transition-all disabled:opacity-50"
          >
            취소
          </button>
          <button
            type="submit"
            disabled={!보낼수있나}
            className="flex-1 py-2.5 rounded-xl bg-accent-blue text-white text-sm font-semibold transition-all hover:bg-accent-blue/90 disabled:opacity-50"
          >
            {진행중 ? "저장 중…" : 확인글}
          </button>
        </div>
      </form>
    </Modal>
  );
}
