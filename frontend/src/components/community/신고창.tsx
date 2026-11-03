/**
 * 신고 창 — 사유를 골라 보내는 가운데 팝업.
 *
 * 예전에는 글 상세의 깃발과 댓글마다 붙은 '신고' 글자를 누르면 그 자리에 사유 칩이 펼쳐졌다. ⋯ 메뉴로
 * 모으면서(사용자가 고른 6번) 창으로 띄운다 — 고르고 보내는 창은 팝업으로(사용자: "팝업이 나을 거 같은 건
 * 팝업으로"). 피드 목록·댓글 창에서도 같은 창을 쓴다.
 */
import { useState } from "react";
import { Modal } from "@/components/ui";
import ModalFooter from "@/components/ui/ModalFooter";

export const 신고사유들 = ["스팸·광고", "욕설·혐오 표현", "허위 정보", "성적·불법 콘텐츠", "개인정보 침해", "기타"];

export default function 신고창({ 무엇, 대상, 보내기, 닫기 }: {
  무엇: "글" | "댓글";
  /** 무엇을 신고하는지 한 줄 — 옆 글을 잘못 누른 것을 알아챌 수 있게 */
  대상?: string;
  /** 보낸다. true 면 창을 닫는다(이미 신고한 것도 닫는다 — 더 할 일이 없다), false 면 그대로 둔다 */
  보내기: (사유: string) => Promise<boolean>;
  닫기: () => void;
}) {
  const [고른것, set고른것] = useState("");
  const [직접, set직접] = useState("");
  const [보내는중, set보내는중] = useState(false);
  const 사유 = 고른것 === "기타" ? 직접.trim() : 고른것;

  const 확인 = async () => {
    if (!사유 || 보내는중) return;
    set보내는중(true);
    try {
      if (await 보내기(사유)) 닫기();
    } finally {
      set보내는중(false);
    }
  };

  return (
    <Modal onClose={보내는중 ? undefined : 닫기} maxWidth="max-w-sm">
      <div className="p-5 flex flex-col gap-3">
        <h2 className="text-base font-bold text-text-primary">이 {무엇}을 신고할까요?</h2>
        {대상 && (
          <p className="text-xs text-text-muted bg-bg-elevated rounded-lg px-3 py-2 line-clamp-2 break-words">{대상}</p>
        )}
        <div role="radiogroup" aria-label="신고 사유" className="flex flex-wrap gap-1.5">
          {신고사유들.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={고른것 === r} onClick={() => set고른것(r)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                고른것 === r
                  ? "bg-accent-red/15 text-accent-red border-accent-red/40 font-semibold"
                  : "border-border text-text-secondary hover:border-accent-red/40 hover:text-accent-red"
              }`}>
              {r}
            </button>
          ))}
        </div>
        {고른것 === "기타" && (
          <input value={직접} onChange={(e) => set직접(e.target.value)} autoFocus maxLength={200}
            aria-label="신고 사유 직접 쓰기" placeholder="신고 사유를 직접 입력하세요"
            className="w-full bg-bg-elevated border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-accent-red/50" />
        )}
      </div>
      <ModalFooter onCancel={닫기} onConfirm={확인} 확인글={보내는중 ? "보내는 중..." : "신고"}
        확인가능={!!사유} 진행중={보내는중} />
    </Modal>
  );
}

/** 서버 답을 알림 한 줄로 — 409 는 이미 신고한 것. 보낸 결과(창을 닫을지)와 함께 */
export async function 신고보내기(
  보내기: () => Promise<unknown>,
  무엇: "글" | "댓글",
  알리기: (글: string, 종류: "success" | "error") => void,
): Promise<boolean> {
  try {
    await 보내기();
    알리기("신고가 접수되었습니다", "success");
    return true;
  } catch (e: any) {
    if (e?.response?.status === 409) {
      알리기(무엇 === "글" ? "이미 신고한 게시글입니다" : "이미 신고한 댓글입니다", "error");
      return true;
    }
    알리기("신고하지 못했습니다", "error");
    return false;
  }
}
