/**
 * 좋아요 단추 하나가 하는 일.
 *
 * 같은 코드가 네 곳에 있었다 — 글 상세의 댓글·답글, 모달의 댓글·답글.
 * 네 벌 다 똑같은 세 가지를 틀리게 하고 있었다.
 *
 *   1. 서버 답을 버렸다
 *      서버는 {liked, like_count} 로 진짜 값을 알려주는데 네 벌 모두
 *      응답을 쓰지 않았다. 화면이 들고 있던 값이 이미 틀렸으면
 *      (다른 기기에서 눌렀다든지) 누를 때마다 어긋난 채로 뒤집힌다.
 *
 *   2. 되돌릴 때 처음 값으로 돌아갔다
 *      실패하면 `setLikeCount(comment.like_count)` — 이건 화면이 처음
 *      그려질 때의 값이지 방금 누르기 직전의 값이 아니다. 눌렀다(5→6)
 *      다시 눌렀는데 그게 실패하면 6 이 아니라 5 로 돌아간다. 누른
 *      표시는 켜져 있는데 수는 하나 모자란 상태가 된다.
 *
 *   3. 연타를 막지 않았다
 *      서버 쪽은 토글이라 두 번 보내면 원위치다. 화면은 두 번 다
 *      뒤집으니 결과가 맞아 보이지만, 중간 응답이 늦게 오면 그 값으로
 *      덮이면서 뒤집힌 채로 남는다.
 *
 * 글 자체의 좋아요는 여기 안 넣었다. 그쪽은 낙관적 갱신을 부모 상태
 * (localPost / setPost) 에 하고 목록 쪽에도 알려 줘야 해서 모양이 다르다.
 */
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/authStore";

/** 서버가 돌려주는 것. 옛 응답을 대비해 둘 다 없을 수 있다고 본다 */
type 응답 = { liked?: boolean; like_count?: number } | null | undefined | void;

export function use좋아요(처음눌림: boolean, 처음수: number, 보내기: () => Promise<응답>) {
  const { isLoggedIn } = useAuthStore();
  const navigate = useNavigate();
  const [눌림, set눌림] = useState(처음눌림);
  const [수, set수] = useState(처음수);
  /* 상태가 아니라 ref 다 — 다시 그리지 않고 지금 보내는 중인지만 본다 */
  const 보내는중 = useRef(false);

  const 누르기 = async () => {
    if (!isLoggedIn) { navigate("/login"); return; }
    if (보내는중.current) return;
    보내는중.current = true;

    const 이전눌림 = 눌림;
    const 이전수 = 수;
    const 새눌림 = !이전눌림;
    const 새수 = Math.max(0, 새눌림 ? 이전수 + 1 : 이전수 - 1);
    set눌림(새눌림);
    set수(새수);

    try {
      const r = await 보내기();
      /* 서버가 알려준 값으로 맞춘다. 먼저 뒤집어 놓은 값은 "내가 알고
         있던 상태" 를 기준으로 한 추측이고, 서버는 토글이라 그 추측이
         틀리면 반대로 움직인다 */
      if (r && typeof r.liked === "boolean") {
        set눌림(r.liked);
        set수(typeof r.like_count === "number" ? r.like_count : 새수);
      }
    } catch {
      set눌림(이전눌림);
      set수(이전수);
    } finally {
      보내는중.current = false;
    }
  };

  return { 눌림, 수, 누르기 };
}
