/**
 * 모달 바닥의 취소·확인 두 단추.
 *
 * 세 모달(관심종목 담기, 내 자산 담기, 현금 넣기)이 같은 스무 줄을
 * 각자 갖고 있었다. class 는 글자까지 같았고 다른 것은 단추 글씨뿐이다.
 *
 * 이런 것이 갈라져 있으면 한쪽만 고쳐진다. 나중에 '저장 중에는 못
 * 닫는다' 같은 규칙을 넣을 때 세 곳을 다 찾아야 하고, 하나를 빠뜨리면
 * 그 모달만 다르게 동작한다.
 */
export default function ModalFooter({
  onCancel, onConfirm, 확인글, 취소글 = "취소", 진행중, 확인가능 = true,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  /** 확인 단추 글씨. 저장 중에는 부르는 쪽이 "추가 중..." 처럼 바꿔 보낸다 */
  확인글: React.ReactNode;
  취소글?: string;
  /** 저장 중이면 둘 다 잠근다 — 두 번 눌러 두 벌이 들어가는 것을 막는다 */
  진행중?: boolean;
  확인가능?: boolean;
}) {
  const 공통 = "flex-1 px-4 py-2 text-sm font-semibold rounded-lg transition-colors " +
                "disabled:opacity-40 disabled:cursor-not-allowed";
  return (
    <div className="flex gap-2 px-5 py-4 border-t border-border">
      <button
        onClick={onCancel}
        disabled={진행중}
        className={`${공통} border border-border text-text-muted hover:text-text-primary hover:border-accent-blue/40`}
      >{취소글}</button>
      <button
        onClick={onConfirm}
        disabled={!확인가능 || 진행중}
        className={`${공통} bg-accent-blue text-white hover:bg-accent-blue`}
      >{확인글}</button>
    </div>
  );
}
