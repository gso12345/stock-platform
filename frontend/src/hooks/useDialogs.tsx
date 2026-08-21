/**
 * 확인창과 알림을 두 줄로 붙이는 도구.
 *
 * 관리자 화면은 ConfirmDialog 로 통일했는데 정작 사용자 화면은
 * window.confirm 과 alert 을 그대로 쓰고 있었다. 글·댓글 삭제처럼
 * 되돌릴 수 없는 일은 오히려 사용자 쪽에 더 많은데도.
 *
 * 브라우저 기본 창을 안 쓰는 이유 —
 *   · 앱 모양과 따로 논다
 *   · 무엇을 지우는지(대상 이름) 보여 줄 수 없다
 *   · 휴대폰에서 화면 한가운데를 덮고, 반드시 눌러야 사라진다
 *
 * 바꿀 곳이 열다섯 군데인데 파일마다 상태를 따로 두면 지저분해진다.
 * 부르는 쪽은 두 줄이면 된다 —
 *
 *     const { 묻기, 화면 } = use확인();
 *     ...
 *     <button onClick={() => 묻기({ title: "...", onConfirm: 지우기 })}>
 *     {화면}
 */
import { useCallback, useState } from "react";
import { Toast } from "@/components/ui";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

type 확인요청 = {
  title: string;
  message: string;
  /** 무엇에 대한 일인지. 목록에서 옆줄을 잘못 누르는 것이 가장 흔한 실수다 */
  대상?: string;
  위험?: boolean;
  확인글?: string;
  onConfirm: () => void | Promise<void>;
};

export function use확인() {
  const [요청, set요청] = useState<확인요청 | null>(null);
  const [진행중, set진행중] = useState(false);

  const 묻기 = useCallback((r: 확인요청) => set요청(r), []);

  const 화면 = 요청 ? (
    <ConfirmDialog
      title={요청.title}
      message={요청.message}
      대상={요청.대상}
      위험={요청.위험 ?? true}
      확인글={요청.확인글 ?? "삭제"}
      진행중={진행중}
      onConfirm={async () => {
        set진행중(true);
        try {
          await 요청.onConfirm();
        } catch (e) {
          // 여기서 잡지 않으면 처리되지 않은 거부로 새어 나가 화면이
          // 통째로 터진다. 무엇이 실패했는지 알리는 것은 부르는 쪽의
          // 몫이고(대개 토스트), 이 창은 닫히기만 하면 된다.
          console.error("확인창 동작 실패:", e);
        } finally {
          // 실패했더라도 창은 닫는다 — 열린 채로 두면 다시 누를 수
          // 있어 같은 일을 두 번 하게 된다
          set진행중(false);
          set요청(null);
        }
      }}
      onClose={() => { if (!진행중) set요청(null); }}
    />
  ) : null;

  return { 묻기, 화면 };
}

type 알림종류 = "error" | "success" | "info";

export function use알림() {
  const [알림, set알림] = useState<{ 글: string; 종류: 알림종류 } | null>(null);

  const 보이기 = useCallback(
    (글: string, 종류: 알림종류 = "info") => set알림({ 글, 종류 }), []);

  const 화면 = 알림 ? (
    <Toast message={알림.글} kind={알림.종류} onClose={() => set알림(null)} />
  ) : null;

  return { 보이기, 화면 };
}
