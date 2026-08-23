"""
미국 상장 종목 목록 — "미국 모든 종목이 조회 가능하면 좋겠어"

지금까지 미국 종목은 코드에 적어둔 128개가 전부였다. Finnhub 검색 경로가
있긴 했지만 API 키가 있어야 하고, 없으면 조용히 128개로 떨어졌다. 그래서
그 밖의 종목은 검색조차 되지 않았다 — 국내 목록이 내장 115개로 돌던 것과
똑같은 상황이다.

목록은 NASDAQ Trader 의 심볼 디렉터리에서 받는다. 키가 필요 없고, 매일
갱신되고, 파이프로 구분된 평문이라 가볍다. 두 파일로 나뉘어 있다.

  nasdaqlisted.txt — 나스닥 상장 전부
  otherlisted.txt  — NYSE·NYSE American·NYSE Arca(ETF 대부분)·BATS·IEX

컬럼은 순서가 아니라 **머리글 이름으로** 찾는다. 위치로 읽으면 파일 형식이
한 칸만 밀려도 이름 자리에 시장 구분이 들어오는데, 그게 조용히 통과한다.

받아온 목록이 이상하면 쓰지 않는다(_쓸만한가). 국내 목록에서 세 단계 폴백이
전부 실패한 채로 프로덕션이 한참을 돌았고, 화면에는 '종목이 좀 적네'로만
보였다. 같은 일을 반복하지 않으려면 '적으면 안 받은 것으로 친다'가 필요하다.
"""
import logging

import httpx

log = logging.getLogger(__name__)

NASDAQ_TRADER = "https://www.nasdaqtrader.com/dynamic/SymDir"

# NYSE Arca(P) 에 ETF 대부분이 상장돼 있다. 코드→표시 이름.
_거래소 = {
    "A": "AMEX", "N": "NYSE", "P": "NYSE ARCA", "Z": "BATS", "V": "IEX",
}

# 야후에서 통하는 심볼은 영문·숫자·붙임표로만 이뤄져 있다.
_허용글자 = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-")

# 심볼 모양만 보고 거르면 안 된다.
#
# 처음에는 '기호가 섞인 심볼은 버린다'로 했다. 그런데 이 파일의 ACT Symbol
# 열은 클래스주를 BRK.A·BRK.B 처럼 점으로 쓴다 — 그 규칙이면 버크셔가
# 통째로 사라진다. 반대로 우선주는 AGM$C 이고, 다른 열(NASDAQ Symbol)에서는
# AGM-C 로 오는데 야후는 AGM-PC 를 쓴다. 즉 모양만으로는 살릴 것과 버릴 것을
# 가를 수 없다.
#
# 종목 이름은 사람이 읽으라고 쓴 것이라 훨씬 분명하다. 아래 낱말이 든 것은
# 야후에서 조회되지 않는 종류라, 검색에 나와도 눌러보면 빈 화면이다.
_버릴낱말 = (
    "preferred", "pfd", "warrant", " units", " rights", "when issued",
    "% notes", "subordinated", "debenture",
)
# 'depositary' 는 여기 없다. 미국예탁증서(ADR)는 알리바바처럼 멀쩡히 거래되는
# 종목이고 294건이나 된다 — 우선주 설명문에도 같은 낱말이 나오지만, 그쪽은
# 'preferred' 가 함께 들어 있어 위에서 걸러진다.


def _버릴이름인가(이름: str) -> bool:
    낮춘것 = 이름.lower()
    return any(w in 낮춘것 for w in _버릴낱말)

# 목록이 이만큼도 안 되면 받다 만 것으로 본다. 실제 상장 종목은 나스닥만
# 해도 4,000개가 넘는다.
_최소건수 = 2000
# 형식이 바뀌어 엉뚱한 열을 심볼로 읽고 있는지 보는 잣대.
#
# '전부 있어야 한다'로 하면 안 된다. 두 파일 중 하나만 와도 쓰기로 했는데,
# 나스닥 파일만 오면 JPM 이 없고 otherlisted 만 오면 AAPL 이 없다. 그걸로
# 버리면 4,000개짜리 멀쩡한 목록을 통째로 날린다. 반대로 하나만 보면
# 우연히 맞을 수 있으니, 양쪽에서 골라 두고 '몇 개는 있어야 한다'로 본다.
_기준종목 = ("AAPL", "MSFT", "NVDA",     # 나스닥
             "JPM", "JNJ", "WMT")        # NYSE
_기준최소 = 2


def _헤더맵(줄: str) -> dict[str, int]:
    """머리글 이름 → 열 번호. 위치가 아니라 이름으로 읽기 위한 것."""
    return {이름.strip().lower(): i for i, 이름 in enumerate(줄.split("|"))}


def _심볼정리(sym: str) -> str | None:
    """야후에서 통하는 표기로 바꾼다. 못 쓸 것은 None.

    클래스 구분자는 파일·열마다 BRK.B / BRK/B 로 제각각이라 둘 다 야후
    표기(BRK-B)로 맞춘다. 종류를 가리는 일은 여기서 하지 않는다 —
    _버릴이름인가 가 이름을 보고 판단한다."""
    sym = (sym or "").strip().upper().replace("/", "-").replace(".", "-")
    if not sym or set(sym) - _허용글자:
        return None
    return sym


def _파싱(본문: str, 기본거래소: str) -> list[dict]:
    """파이프로 구분된 심볼 디렉터리 한 파일을 읽는다.

    마지막 줄은 항상 'File Creation Time: ...' 이고 컬럼 수가 맞지 않는다.
    빠뜨리면 심볼이 'File Creation Time: 0130202502' 인 종목이 하나 생긴다."""
    줄들 = [l for l in 본문.splitlines() if l.strip()]
    if len(줄들) < 2:
        return []

    열 = _헤더맵(줄들[0])
    심볼열 = 열.get("symbol", 열.get("act symbol"))
    이름열 = 열.get("security name")
    if 심볼열 is None or 이름열 is None:
        log.warning(f"심볼 디렉터리 머리글이 예상과 다릅니다: {줄들[0][:120]}")
        return []
    거래소열 = 열.get("exchange")
    etf열   = 열.get("etf")
    시험열  = 열.get("test issue")

    rows = []
    for 줄 in 줄들[1:]:
        칸 = 줄.split("|")
        if len(칸) <= max(심볼열, 이름열):
            continue                      # 'File Creation Time' 꼬리줄
        if 시험열 is not None and len(칸) > 시험열 and 칸[시험열].strip().upper() == "Y":
            continue                      # 시험용 종목 — 실제로 거래되지 않는다
        이름 = 칸[이름열].strip()
        if not 이름 or _버릴이름인가(이름):
            continue
        sym = _심볼정리(칸[심볼열])
        if not sym:
            continue
        etf = (etf열 is not None and len(칸) > etf열
               and 칸[etf열].strip().upper() == "Y")
        거래소 = 기본거래소
        if 거래소열 is not None and len(칸) > 거래소열:
            거래소 = _거래소.get(칸[거래소열].strip().upper(), 기본거래소)
        rows.append({
            "s": sym,
            # 이름은 화면에 한 줄로 나온다. 우선주 설명문은 200자가 넘는데
            # 그런 것은 위에서 이미 걸러졌고, 남은 것도 80자면 충분하다.
            "n": 이름[:80],
            "x": 거래소,
            "m": "ETF" if etf else "US",
        })
    return rows


def _쓸만한가(rows: list[dict]) -> bool:
    """받아온 목록을 실제로 쓸지 판단한다.

    '조용히 적은 목록으로 도는' 상태가 제일 나쁘다. 검색이 안 되는데
    화면에는 아무 표시가 없어서, 국내 목록이 내장 115개로 돌 때 아무도
    몇 주 동안 몰랐다."""
    if len(rows) < _최소건수:
        log.warning(f"미국 종목 목록이 {len(rows)}개뿐입니다 — 받다 만 것으로 보고 버립니다")
        return False
    있는것 = {r["s"] for r in rows}
    맞은것 = [s for s in _기준종목 if s in 있는것]
    if len(맞은것) < _기준최소:
        log.warning(f"미국 종목 목록 {len(rows)}개 중 기준 종목이 {맞은것} 뿐입니다"
                    f" — 형식이 바뀐 것으로 보고 버립니다")
        return False
    return True


def _받기(client: httpx.Client, 파일: str) -> str:
    r = client.get(f"{NASDAQ_TRADER}/{파일}", timeout=20)
    r.raise_for_status()
    return r.text


#: NASDAQ Trader 가 막혔을 때 쓰는 대체 경로.
#
# 국내 종목 목록이 이미 같은 방식을 쓴다 — KRX 가 403 을 주면
# raw.githubusercontent 에 있는 사본을 받는다. 미국 쪽에는 그게 없어서,
# nasdaqtrader.com 이 막히면 순위 대상이 코드에 적어 둔 372개로 떨어졌다.
# 그러면 '미국 전종목 순위' 가 아니라 'S&P500 안에서의 순위' 다.
#
# 이 저장소는 세 거래소 심볼을 하루 한 번 갱신해 텍스트로 올려 둔다.
# 종목 코드만 있고 이름·거래소 구분이 없으므로, 파일별로 거래소를
# 붙이고 이름은 심볼로 둔다 — 순위를 매기는 데는 코드만 있으면 되고,
# 이름은 시세를 받을 때 함께 온다.
_거울 = "https://raw.githubusercontent.com/rreichel3/US-Stock-Symbols/main"
_거울_파일 = (("nasdaq/nasdaq_tickers.txt", "NASDAQ"),
              ("nyse/nyse_tickers.txt",     "NYSE"),
              ("amex/amex_tickers.txt",     "AMEX"))


def _거울에서_받기() -> tuple[list[dict], str]:
    rows: list[dict] = []
    받은것 = []
    try:
        with httpx.Client(follow_redirects=True, timeout=20,
                          headers={"User-Agent": "Mozilla/5.0"}) as cl:
            for 경로, 거래소 in _거울_파일:
                try:
                    r = cl.get(f"{_거울}/{경로}")
                    r.raise_for_status()
                    몫 = 0
                    for 줄 in r.text.splitlines():
                        코드 = 줄.strip().upper()
                        # 우선주·워런트·유닛은 점이나 하이픈이 붙는다.
                        # 시세 조회가 안 되는 것들이라 여기서 거른다 —
                        # 원래 파일도 같은 이유로 걸러져 있다.
                        if not 코드 or not 코드.isalnum() or len(코드) > 5:
                            continue
                        rows.append({"s": 코드, "n": 코드, "x": 거래소, "m": "US"})
                        몫 += 1
                    if 몫:
                        받은것.append(f"{거래소} {몫}개")
                except Exception as e:
                    log.warning("거울 %s 실패: %s", 경로, type(e).__name__)
    except Exception as e:
        return [], f"거울 접속 실패 ({type(e).__name__})"
    return rows, "GitHub 거울 " + " + ".join(받은것)


def fetch_listing() -> tuple[list[dict], str]:
    """미국 상장 종목 목록을 받아온다. (목록, 출처) — 실패하면 ([], 사유).

    두 파일 중 하나만 와도 쓴다. nasdaqlisted 만 오면 ETF 가 거의 없고
    (ETF 는 대부분 NYSE Arca 에 있다), otherlisted 만 오면 나스닥 종목이
    빠진다. 둘 다 실패했을 때만 빈손으로 돌아간다."""
    rows: list[dict] = []
    받은파일 = []
    try:
        with httpx.Client(follow_redirects=True,
                          headers={"User-Agent": "Mozilla/5.0"}) as cl:
            for 파일, 기본 in (("nasdaqlisted.txt", "NASDAQ"),
                              ("otherlisted.txt", "NYSE")):
                try:
                    몫 = _파싱(_받기(cl, 파일), 기본)
                    if 몫:
                        rows.extend(몫)
                        받은파일.append(f"{파일} {len(몫)}개")
                except Exception as e:
                    log.warning(f"{파일} 받기 실패: {type(e).__name__}: {e}")
    except Exception as e:
        log.warning(f"NASDAQ Trader 접속 실패: {type(e).__name__}: {e}")
        return [], f"접속 실패 ({type(e).__name__})"

    if not rows:
        """본 경로가 빈손이면 거울을 본다.

        예전에는 여기서 그냥 포기했고, 그러면 순위 대상이 코드에 적어 둔
        372개로 떨어졌다 — 화면에는 아무 표시도 없이 'S&P500 안에서의
        순위' 가 뜬다."""
        거울행, 거울출처 = _거울에서_받기()
        if 거울행:
            rows = 거울행
            받은파일 = [거울출처]
        else:
            return [], f"응답 없음 · {거울출처}"

    # 같은 종목이 두 파일에 겹쳐 나오는 경우가 있다(이전 상장 이력 등).
    # 먼저 온 것을 남긴다 — 나스닥 쪽 이름이 더 정확하다.
    본것, 정리 = set(), []
    for r in rows:
        if r["s"] in 본것:
            continue
        본것.add(r["s"])
        정리.append(r)

    if not _쓸만한가(정리):
        return [], f"목록이 미덥지 않음 ({len(정리)}개)"
    출처 = 받은파일[0] if 받은파일 and 받은파일[0].startswith("GitHub") \
        else "NASDAQ Trader " + " + ".join(받은파일)
    return 정리, 출처
