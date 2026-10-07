"""이미 받아 둔 시세 — 내 자산·관심종목 목록에 같이 실어 보내는 것.

원래 portfolio 라우트 안에 있던 것을 관심종목도 쓰게 여기로 옮겼다.
"""
from app.core.cache import cache


def 받아둔시세(items: list) -> list[dict]:
    """이미 캐시에 있는 시세만 긁어 온다. **여기서 새로 받지 않는다.**

    ── 왜 보유목록에 시세를 얹나 ──

    화면이 평가금액을 그리려면 왕복이 두 번 필요했다. 종목을 받아야
    무엇의 시세를 물어볼지 알 수 있어서다.

        /portfolio/items  ──▶  (답)  ──▶  /watchlist/prices  ──▶  (답)

    앞의 답이 오기 전에는 뒤를 시작조차 못 한다. 서버가 아무리 빨라도
    한국↔서버 왕복이 한 번 통째로 더 붙고, 그동안 총자산·손익·비중이
    전부 빈칸이다. 종목 수와 무관하게 늘 붙는 대기다.

    시세는 이미 메모리에 있다 — 스케줄러가 채우고, 다른 사람이 본
    종목도 거기 남는다. 있는 것을 같이 실어 보내면 첫 그림이 곧바로
    찬다. 없는 종목은 null 로 두고, 화면은 늘 하던 대로 시세 조회를
    한 번 더 해서 채운다. 그러니 이건 **덤**이지 대체가 아니다.

    캐시 조회뿐이라 바깥 호출이 0 이고, 사전 조회 몇 번이 전부다.

    같은 종목이 005930 으로도 005930.KS 로도 들어 있다 — 어느 경로로
    들어왔느냐에 따라 다르므로 둘 다 본다(portfolio_snapshot 과 같은 규칙).

    캐시의 지난 값에도 없으면 마지막으로 받은 가격(cache.마지막시세)을
    쓴다. 지난 값 보관함은 스케줄러가 시세를 몰아서 쓸 때 밀려나지만,
    그쪽은 가격 몇 개만 오래 기억한다. stale 로 표시해 보낸다 — 화면은
    어차피 낡은 값으로 꽂고 곧바로 새 시세를 다시 묻는다.

    관심종목에는 asset_class 가 없어서 getattr 로 읽는다.
    """
    나온것: list[dict] = []
    본것: set[tuple] = set()
    for it in items:
        sym, mkt = it.symbol, it.market
        if not sym or (getattr(it, "asset_class", None) or "") == "현금":
            continue                     # 현금에는 시세가 없다
        if (sym, mkt) in 본것:
            continue                     # 같은 종목을 여러 줄로 담았을 때
        본것.add((sym, mkt))
        민 = sym.upper().replace(".KS", "").replace(".KQ", "")
        후보 = [sym, 민] + ([f"{민}.KS", f"{민}.KQ"] if 민.isdigit() else [])
        찾음 = None
        for k in 후보:
            담긴것 = cache.get(f"price:{k}") or cache.get_stale(f"price:{k}")
            if 담긴것 and 담긴것.get("price"):
                찾음 = 담긴것
                break
        if 찾음 is None:
            for k in 후보:
                if 마지막 := cache.마지막시세(k):
                    찾음 = {**마지막, "stale": True}
                    break
        if 찾음 is not None:
            나온것.append({**찾음, "symbol": sym, "market": mkt})
    return 나온것


