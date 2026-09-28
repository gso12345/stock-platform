"""회원 한 명과 그 사람의 데이터를 **빠짐없이, 순서대로** 지운다.

관리자 삭제와 본인 탈퇴가 같이 쓴다. 두 곳에 따로 두면 한쪽에만 표가
추가되어, 어느 길로 나갔느냐에 따라 남는 데이터가 달라진다.

── 순서가 중요한 이유 ─────────────────────────────────────

User 쪽에 cascade 선언이 없고 외래키에도 ON DELETE 가 없다. 그래서
가리키는 쪽을 먼저 지우지 않으면 PostgreSQL 이 삭제를 막는다(SQLite 는
기본으로 외래키를 안 봐서 로컬에서는 드러나지 않는다).

특히 **남이 내 글에 단 것**이 걸린다. 다른 사람이 내 글에 단 댓글·좋아요·
투표·신고·알림은 그 사람의 행이지만 내 글을 가리킨다. 이걸 두고 내 글을
지우면 막힌다 — 예전 관리자 삭제가 바로 여기서 500 을 냈다.

── 한 덩어리로 ────────────────────────────────────────────

전부 한 트랜잭션이다. 중간에 실패하면 **아무것도 안 지운 상태**로
돌아간다. 반쯤 지워진 계정은 로그인은 되는데 글이 없는, 설명할 수 없는
상태가 된다.
"""
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from app.models.user import User


#: 내가 남의 글·사람에게 한 것 — (표, 나를 가리키는 칸)
내가한것 = [
    ("stock_post_likes", "user_id"),
    ("stock_comment_likes", "user_id"),
    ("stock_post_poll_votes", "user_id"),
    ("user_follows", "follower_id"),
    ("user_follows", "following_id"),
    ("reports", "reporter_id"),
    ("notifications", "user_id"),
    ("notifications", "actor_id"),
]

#: 나머지 개인 데이터. **가리키는 쪽이 먼저** 온다.
개인표 = [
    "user_profiles",
    "watchlist_folders",        # 그 안의 종목(watchlist_items)은 위에서 먼저 지운다
    "watchlists",
    "portfolio_items",          # portfolios 를 가리킨다
    "portfolio_snapshots",
    "portfolios",
    "backtest_results",         # strategies 를 가리킨다
    "strategies",
    "screening_presets",
    "price_alerts",
    "quant_score_weights",
    "portfolio_experiments",
]


def _ids(db: Session, sql: str, **값) -> list[int]:
    return [r[0] for r in db.execute(text(sql), 값).fetchall()]


def _지우기(db: Session, sql: str, 지운수: dict, 이름: str, **값) -> None:
    """IN 목록이 비었으면 부르지 않는다 — 빈 IN () 은 DB 마다 다르게 군다."""
    for v in 값.values():
        if isinstance(v, list) and not v:
            return
    문 = text(sql)
    for k, v in 값.items():
        if isinstance(v, list):
            문 = 문.bindparams(bindparam(k, expanding=True))
    r = db.execute(문, 값)
    if r.rowcount:
        지운수[이름] = 지운수.get(이름, 0) + r.rowcount


def 회원지우기(db: Session, user: User) -> dict:
    """지운 행 수를 {표: 개수} 로 돌려준다. commit 은 부르는 쪽이 한다."""
    uid = user.id
    지운수: dict = {}

    # ── 1. 내 글과, 그 글에 딸린 댓글(남의 것 포함) ──
    내글 = _ids(db, "SELECT id FROM stock_posts WHERE user_id = :uid", uid=uid)
    댓글 = set(_ids(db, "SELECT id FROM stock_comments WHERE user_id = :uid", uid=uid))
    if 내글:
        문 = text("SELECT id FROM stock_comments WHERE post_id IN :p").bindparams(
            bindparam("p", expanding=True))
        댓글 |= {r[0] for r in db.execute(문, {"p": 내글}).fetchall()}
    #: 지울 댓글에 달린 답글(남의 것)도 같이 — parent_id 가 가리키고 있다
    while 댓글:
        문 = text("SELECT id FROM stock_comments WHERE parent_id IN :c").bindparams(
            bindparam("c", expanding=True))
        더 = {r[0] for r in db.execute(문, {"c": list(댓글)}).fetchall()} - 댓글
        if not 더:
            break
        댓글 |= 더
    댓글목록 = sorted(댓글)

    # ── 2. 그것들을 가리키는 것부터 ──
    _지우기(db, "DELETE FROM stock_comment_likes WHERE comment_id IN :c", 지운수, "stock_comment_likes", c=댓글목록)
    _지우기(db, "DELETE FROM notifications WHERE comment_id IN :c", 지운수, "notifications", c=댓글목록)
    _지우기(db, "DELETE FROM reports WHERE comment_id IN :c", 지운수, "reports", c=댓글목록)
    _지우기(db, "DELETE FROM stock_post_likes WHERE post_id IN :p", 지운수, "stock_post_likes", p=내글)
    _지우기(db, "DELETE FROM stock_post_poll_votes WHERE post_id IN :p", 지운수, "stock_post_poll_votes", p=내글)
    _지우기(db, "DELETE FROM notifications WHERE post_id IN :p", 지운수, "notifications", p=내글)
    _지우기(db, "DELETE FROM reports WHERE post_id IN :p", 지운수, "reports", p=내글)

    # ── 3. 내가 남에게 한 것 ──
    for 표, 칸 in 내가한것:
        _지우기(db, f"DELETE FROM {표} WHERE {칸} = :uid", 지운수, 표, uid=uid)

    # ── 4. 댓글 → 글 ──
    #: 답글끼리 서로 가리켜도 **한 문장으로** 지우면 된다 — 외래키는 문장이
    #  끝날 때 본다(PostgreSQL·SQLite 둘 다).
    _지우기(db, "DELETE FROM stock_comments WHERE id IN :c", 지운수, "stock_comments", c=댓글목록)
    _지우기(db, "DELETE FROM stock_posts WHERE id IN :p", 지운수, "stock_posts", p=내글)

    # ── 5. 관심목록 종목 ──
    #: watchlist_items 에는 user_id 가 **없다.** 내 관심목록을 거쳐 찾는다
    #  (내 폴더에 든 종목도 모두 내 목록 안에 있다). 예전 관리자 삭제는
    #  'WHERE user_id' 로 지우려다 에러가 났고, 그걸 rollback 으로 넘기면서
    #  앞서 지운 것까지 되돌려 버렸다.
    내목록 = _ids(db, "SELECT id FROM watchlists WHERE user_id = :uid", uid=uid)
    _지우기(db, "DELETE FROM watchlist_items WHERE watchlist_id IN :w", 지운수, "watchlist_items", w=내목록)

    # ── 6. 나머지 개인 데이터 — 가리키는 쪽이 먼저 ──
    for 표 in 개인표:
        _지우기(db, f"DELETE FROM {표} WHERE user_id = :uid", 지운수, 표, uid=uid)

    db.delete(user)
    return 지운수


#: 이 파일이 치우는 (표, 칸). 사용자를 가리키는 표가 새로 생겼는데 여기
#  없으면 검사가 잡는다(tests/test_admin_safety.py). 아래 목록들을 그대로
#  모은 것이라, 목록에서 빼면 여기서도 빠진다.
치우는_칸 = set(내가한것) | {(표, "user_id") for 표 in 개인표} | {
    ("stock_comments", "user_id"), ("stock_posts", "user_id"),
}
