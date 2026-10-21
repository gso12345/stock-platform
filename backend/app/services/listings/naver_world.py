"""미국 종목의 한글 이름 — 네이버 해외주식 시가총액 목록.

사용자: "국내 해외 모두 한글로된 회사명이 나오도록 해줘". 미국 종목의 한글 이름은 코드에 적어 둔
주요 159곳(ticker_service.KO_NAME_MAP)뿐이었다. 네이버 해외주식은 거래소별 시가총액 순 목록에
종목마다 한글 이름(stockName, 예: '엔비디아')을 붙여 준다 — 쪽(100곳)마다 한 번이면 전 종목이다.

이 목록은 응답 모양을 여기서 확인할 수 없었다(검사 환경은 바깥에 못 나간다). 그래서
  · 종목 목록이 응답 어디에 있든 'stockName' 을 가진 dict 들의 목록을 찾아 읽고
  · 한글이 든 이름만 받고
  · 전부 합쳐 500곳이 안 되면 못 받은 것으로 친다(관리자 화면 '해외 한글 이름(네이버)' 에 남는다).
못 받으면 KO_NAME_MAP 과 영문 이름으로 나온다.
"""
from __future__ import annotations

import logging
import re
import time

import httpx

from app.core.http import SSL

log = logging.getLogger(__name__)

목록주소 = "https://api.stock.naver.com/stock/exchange/{거래소}/marketValue"
거래소들 = ("NASDAQ", "NYSE", "AMEX")
쪽크기 = 100
#: 거래소마다 이만큼까지만 넘긴다 — 시가총액 순이라 뒤쪽은 거래가 거의 없는 종목이다
최대쪽 = 60
최소이름수 = 500
_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://m.stock.naver.com/"}
_한글 = re.compile(r"[가-힣]")
_심볼꼴 = re.compile(r"^[A-Z0-9][A-Z0-9.\-]{0,9}$")


def _종목들(j) -> list[dict]:
    """응답에서 종목 목록을 찾는다 — 'stockName' 을 가진 dict 가 든 첫 목록"""
    할일 = [j]
    while 할일:
        x = 할일.pop(0)
        if isinstance(x, list):
            if x and all(isinstance(v, dict) for v in x) and any("stockName" in v for v in x):
                return x
            할일.extend(v for v in x if isinstance(v, (dict, list)))
        elif isinstance(x, dict):
            할일.extend(v for v in x.values() if isinstance(v, (dict, list)))
    return []


def 쪽_읽기(j) -> dict[str, str]:
    """한 쪽 → {티커: 한글 이름}. 티커는 우리(야후) 꼴로 — 'BRK.B' → 'BRK-B'"""
    out: dict[str, str] = {}
    for z in _종목들(j):
        이름 = str(z.get("stockName") or "").strip()
        sym = str(z.get("symbolCode") or "").strip().upper()
        if not sym:
            sym = str(z.get("reutersCode") or "").strip().upper().split(".")[0]
        sym = sym.replace(".", "-")
        if 이름 and _한글.search(이름) and _심볼꼴.match(sym):
            out[sym] = 이름
    return out


def fetch_names() -> dict[str, str]:
    """{티커: 한글 이름}. 모자라면(최소이름수 미만) 빈 것 — 부르는 쪽이 지난 것을 쓴다"""
    out: dict[str, str] = {}
    with httpx.Client(follow_redirects=True, verify=SSL, headers=_HEADERS, timeout=15) as client:
        for 거래소 in 거래소들:
            for 쪽 in range(1, 최대쪽 + 1):
                try:
                    r = client.get(목록주소.format(거래소=거래소), params={"page": 쪽, "pageSize": 쪽크기})
                    if r.status_code != 200:
                        break
                    이름들 = 쪽_읽기(r.json())
                except Exception as e:
                    log.debug("네이버 해외 이름 %s %d쪽 실패: %s", 거래소, 쪽, type(e).__name__)
                    break
                새것 = {k: v for k, v in 이름들.items() if k not in out}
                if not 새것:
                    break                     # 빈 쪽이거나, 쪽을 넘겨도 같은 쪽이 온다
                out.update(새것)
                time.sleep(0.1)
    if len(out) < 최소이름수:
        log.warning("네이버 해외 한글 이름이 모자람(%d곳)", len(out))
        return {}
    return out
