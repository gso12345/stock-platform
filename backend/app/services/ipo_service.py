"""
공모주 상장일 시초가 예측 — '공모주' 메뉴.

자료
----
38커뮤니케이션(www.38.co.kr)의 세 목록을 종목 이름으로 합친다.

  · 수요예측결과  — 희망공모가 밴드, 확정 공모가, 공모금액, 기관경쟁률, 의무보유확약
  · 공모주 청약일정 — 청약일, 청약경쟁률
  · 신규상장      — 상장일, 공모가, 시초가, 첫날 종가

표는 칸의 '자리' 가 아니라 머리글 이름으로 읽는다. 사이트가 칸을 하나 넣거나
빼도 그대로 읽히고, 머리글 이름이 바뀌어 못 읽으면 지금 머리글이 무엇인지를
관리자 화면 '공모주 …' 줄에 남긴다. 이 코드를 만든 환경은 바깥 사이트에
나갈 수 없어서 실제 페이지를 열어 맞춰 보지 못했다 — 처음 배포되는 회차에
그 줄이 답이다.

받은 것은 종목별 기록으로 DB 에 쌓는다(ipo_snapshots). 평소에는 목록의 앞쪽
몇 쪽만 다시 받으므로, 지난 공모주는 DB 에 남아 있어야 견줄 과거가 생긴다.
처음에는(쌓인 것이 모자라면) 새 규칙이 시작된 때까지 거슬러 받는다.

예측
----
2023-06-26 상장분부터 첫날 가격 범위가 공모가의 60~400% 로 바뀌었다. 그 전에는
시초가가 공모가의 90~200% 안에서만 정해져 '2배' 에서 막혀 있었다 — 지금과
견줄 수 없으므로 그날 이후 상장만 쓴다.

맞히는 값은 '시초가 ÷ 공모가' 의 로그다. 두 가지를 같이 쓴다.

  · 비슷했던 공모주 — 기관경쟁률·의무보유확약·청약경쟁률·밴드 안 위치·공모금액·
    최근 공모주 분위기가 가까운 과거 공모주들. 범위(가운데 절반)와 확률
    (따블 이상, 공모가 아래)도 여기서 나온다. 화면에 그 종목들을 그대로 보여 준다.
  · 회귀(릿지) — 같은 항목으로 세운 직선 모델.

둘의 가운데를 예측값으로 한다. 그리고 시간 순서대로 걸어가며 — 그때까지
상장한 것만으로 다음 공모주를 맞혀 보며 — 얼마나 맞았는지를 함께 보여 준다.
스팩·리츠는 성격이 달라 저희끼리만 견준다.

분위기를 재는 법(직전 10곳 평균 / 요즘 상장일수록 크게)과 '최근 오차 보정'
(직전 몇 곳이 예측보다 높게·낮게 시작한 만큼 반쯤 따라간다)을 엮은 네 방식을
모두 걸어가며 맞혀 보고, 맞힐 날까지 가장 잘 맞아 온 방식을 쓴다(방식들).
"""
from __future__ import annotations

import logging
import math
import os
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone

import httpx

from app.core.http import SSL

log = logging.getLogger(__name__)

KST = timezone(timedelta(hours=9))

#: 이날 상장분부터 첫날 가격 범위가 공모가의 60~400% 다(그 전에는 시초가 90~200%)
새규칙_시작 = date(2023, 6, 26)
하한배율, 상한배율 = 0.6, 4.0

#: 자료 원천. https 가 안 되면 http 로 한 번 더 묻는다
_바탕들 = [os.getenv("IPO_SOURCE_BASE", "https://www.38.co.kr"), "http://www.38.co.kr"]
#: 수요예측은 두 쪽이다 — 결과(o=r1: 기관경쟁률·의무보유확약)와 일정(o=r: 수요예측일·
#: 밴드·확정공모가·공모금액). 처음에는 o=r 을 결과로 알고 읽었는데, 배포해 보니 그
#: 표의 머리글이 '종목명 | 수요예측일 | 희망공모가(원) | 확정공모가 | 공모금액(백만) |
#: 주간사' 였다 — 경쟁률·확약이 없다. 일정 쪽도 공모금액을 주므로 같이 읽는다.
_목록경로 = {
    "수요예측": "/html/fund/index.htm?o=r1",
    "수요예측일정": "/html/fund/index.htm?o=r",
    "청약": "/html/fund/index.htm?o=k",
    "신규상장": "/html/fund/index.htm?o=nw",
}
#: 관리자 화면 '데이터 수집' 줄 이름
_건강이름 = {"수요예측": "공모주 수요예측", "수요예측일정": "공모주 수요예측일정",
            "청약": "공모주 청약일정", "신규상장": "공모주 신규상장"}

_H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept-Language": "ko-KR,ko;q=0.9",
    "Referer": "https://www.38.co.kr/",
}

#: 평소 다시 받는 쪽 수 / 처음 거슬러 받을 때의 최대 쪽 수.
#: 처음 배포에서 청약일정이 30쪽에 420줄(쪽당 14줄)이었다 — 새 규칙 시작(2023-06)
#: 까지 닿으려면 30쪽으로는 모자랄 수 있다. 그 날짜에 닿으면 알아서 멈춘다
평소_쪽수 = int(os.getenv("IPO_PAGES", 2))
거슬러_쪽수 = int(os.getenv("IPO_BACKFILL_PAGES", 50))
#: 다시 받는 간격(초)
갱신간격 = int(os.getenv("IPO_REFRESH_SEC", 6 * 3600))
#: 하나도 못 받았으면 이만큼은 다시 묻지 않는다(초) — 막힌 동안 화면을 열 때마다
#: 원천을 두드리지 않게
실패쉼 = int(os.getenv("IPO_RETRY_SEC", 600))
#: 쪽 사이에 쉬는 시간(초) — 남의 사이트를 몰아서 두드리지 않는다
쪽_쉼 = float(os.getenv("IPO_PAGE_PAUSE", 0.3))


def 오늘() -> date:
    return datetime.now(KST).date()


# ── 글자 → 값 ──────────────────────────────────────────────
def _수(s) -> "float | None":
    """'12,000원' → 12000.0. 숫자가 없으면 None."""
    m = re.search(r"-?\d+(?:\.\d+)?", str(s or "").replace(",", ""))
    return float(m.group()) if m else None


def _경쟁률(s) -> "float | None":
    """'1,234.56:1' · '1234.56 대 1' → 1234.56. 0 이나 '-' 는 '아직 없음' 이다."""
    v = _수(str(s or "").split(":")[0])
    return v if v and v > 0 else None


def _퍼센트(s) -> "float | None":
    """'45.67%' → 45.67. 확약 0% 는 값이다('없음' 과 다르다)."""
    글 = str(s or "").strip()
    if not 글 or 글 in ("-", "—"):
        return None
    return _수(글)


def _범위(s) -> "tuple[float | None, float | None]":
    """'10,000~12,000' → (10000, 12000). 하나뿐이면 (v, v)."""
    수들 = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", str(s or "").replace(",", ""))]
    if not 수들:
        return None, None
    return (수들[0], 수들[1]) if len(수들) >= 2 else (수들[0], 수들[0])


_날짜꼴 = re.compile(r"(\d{4})[./-](\d{1,2})[./-](\d{1,2})")


def _날짜(s) -> "date | None":
    """'2025.10.13' · '2025/10/13' · '2025-10-13' → date. 범위면 앞의 것."""
    m = _날짜꼴.search(str(s or ""))
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


def _기간(s) -> "tuple[date | None, date | None]":
    """'2025.10.13~10.14' → (10/13, 10/14). 끝에 해가 없으면 시작의 해(해를 넘기면 다음 해)."""
    글 = str(s or "")
    시작 = _날짜(글)
    if not 시작:
        return None, None
    뒤 = 글.split("~", 1)[1] if "~" in 글 else ""
    끝 = _날짜(뒤)
    if not 끝 and (m := re.search(r"(\d{1,2})[./-](\d{1,2})", 뒤)):
        try:
            끝 = date(시작.year, int(m.group(1)), int(m.group(2)))
            if 끝 < 시작:
                끝 = date(시작.year + 1, 끝.month, 끝.day)
        except ValueError:
            끝 = None
    return 시작, 끝 or 시작


def 열쇠(이름: str) -> str:
    """같은 종목을 세 목록에서 같은 이름으로 찾기 위한 열쇠."""
    s = re.sub(r"\s+", "", str(이름 or ""))
    s = s.replace("(주)", "").replace("㈜", "").replace("주식회사", "")
    s = re.sub(r"\((?:유가|코스피|코스닥|코넥스|KOSPI|KOSDAQ)\)$", "", s, flags=re.I)
    return s.upper()


def 종류(이름: str) -> str:
    """스팩·리츠는 따로 견준다 — 시초가가 움직이는 까닭이 일반 공모주와 다르다."""
    s = re.sub(r"\s+", "", str(이름 or ""))
    if "스팩" in s or "SPAC" in s.upper():
        return "spac"
    if "리츠" in s or "REIT" in s.upper():
        return "reit"
    return "normal"


# ── 표 읽기 ────────────────────────────────────────────────
def _표들(html: str) -> list:
    """페이지의 표마다 줄 목록. 칸은 (글자, 링크).

    표가 표 안에 겹겹이 든 페이지다(바깥은 화면 틀). 줄과 칸은 자기 표의
    것만 담는다 — 안 그러면 바깥 표의 한 칸에 안쪽 표 전체 글자가 들어간다."""
    from bs4 import BeautifulSoup
    try:
        soup = BeautifulSoup(html, "lxml")
    except Exception:
        soup = BeautifulSoup(html, "html.parser")
    out = []
    for t in soup.find_all("table"):
        줄들 = []
        for tr in t.find_all("tr"):
            if tr.find_parent("table") is not t:
                continue
            칸들 = []
            for c in tr.find_all(["td", "th"]):
                if c.find_parent("tr") is not tr:
                    continue
                a = c.find("a")
                칸들.append((" ".join(c.get_text(" ", strip=True).split()),
                             (a.get("href") or "") if a else ""))
            if 칸들:
                줄들.append(칸들)
        if 줄들:
            out.append(줄들)
    return out


def _말(s: str) -> str:
    """머리글 견주기용 — 빈칸과 괄호 속 단위를 뺀다('공모가(원)' → '공모가')."""
    return re.sub(r"\s+", "", re.sub(r"\(.*?\)", "", str(s or "")))


def _칸찾기(머리글: list, 규칙: dict) -> "dict | None":
    """규칙: 칸 이름 → (꼭 있어야 할 것인가, [들어 있을 말 후보…], [들어 있으면 안 될 말…]).

    칸마다 다른 칸이어야 한다 — 한 칸에 모든 말이 들어 있으면(바깥 화면 틀의
    한 칸이 안쪽 표 전체를 품은 경우) 표가 아니다."""
    말들 = [_말(h) for h in 머리글]
    자리: dict = {}
    for 이름, (꼭, 후보, 빼기) in 규칙.items():
        for i, h in enumerate(말들):
            if i in 자리.values():
                continue
            if any(k in h for k in 후보) and not any(x in h for x in 빼기) and len(h) <= 12:
                자리[이름] = i
                break
        if 이름 not in 자리 and 꼭:
            return None
    return 자리


def _표에서(html: str, 규칙: dict) -> "tuple[list[dict], str]":
    """규칙에 맞는 머리글을 가진 표를 찾아 줄마다 {칸이름: (글자, 링크)} 로. (줄들, 실패 이유)

    못 찾으면 '자료 표처럼 생긴 것'(첫 줄과 칸 수가 같은 줄이 가장 많은 표)의
    첫 줄을 이유에 붙인다 — 머리글 이름이 바뀌었으면 무엇으로 바뀌었는지 보인다."""
    닮은표: "tuple[int, str] | None" = None
    for 줄들 in _표들(html):
        for i, 줄 in enumerate(줄들[:4]):
            자리 = _칸찾기([c[0] for c in 줄], 규칙)
            if not 자리:
                continue
            결과 = []
            for 다음 in 줄들[i + 1:]:
                if len(다음) <= max(자리.values()):
                    continue
                결과.append({k: 다음[j] for k, j in 자리.items()})
            return 결과, ""
        칸수 = len(줄들[0])
        if 칸수 >= 4:
            같은줄 = sum(1 for z in 줄들 if len(z) == 칸수)
            if not 닮은표 or 같은줄 > 닮은표[0]:
                닮은표 = (같은줄, " | ".join(c[0] for c in 줄들[0])[:80])
    return [], ("표를 못 찾음" + (f" — 원천 표 머리글(그대로): {닮은표[1]}" if 닮은표 else ""))


def _번호(링크: str) -> str:
    m = re.search(r"[?&]no=(\d+)", 링크 or "")
    return m.group(1) if m else ""


_이름칸 = (True, ["기업명", "종목명", "회사명"], [])
#: 주관사 칸 — 원천(38)은 옛 용어 '주간사' 로 적어서 둘 다 찾는다. 화면 글은 표준 용어 '주관사'

_규칙 = {
    "수요예측": {
        "이름": _이름칸,
        "예측일": (False, ["예측일"], []),
        "희망": (False, ["희망"], []),
        "공모가": (False, ["공모가", "확정가"], ["희망", "대비", "/"]),
        "금액": (False, ["공모금액", "금액"], []),
        "기관": (True, ["경쟁률"], []),
        "확약": (True, ["확약"], []),
        "주관사": (False, ["주관사", "주간사"], []),
    },
    "수요예측일정": {
        "이름": _이름칸,
        "예측일": (True, ["예측일"], []),
        "희망": (True, ["희망"], []),
        "공모가": (False, ["확정공모가", "확정", "공모가"], ["희망", "대비", "/"]),
        "금액": (False, ["공모금액", "금액"], []),
        "주관사": (False, ["주관사", "주간사"], []),
    },
    "청약": {
        "이름": _이름칸,
        "일정": (True, ["일정", "청약일"], []),
        "공모가": (False, ["확정공모가", "확정"], ["희망"]),
        "희망": (False, ["희망"], []),
        "청약": (True, ["경쟁률"], []),
        "주관사": (False, ["주관사", "주간사"], []),
    },
    "신규상장": {
        "이름": _이름칸,
        "상장일": (True, ["상장일"], []),
        "공모가": (True, ["공모가"], ["대비", "/", "희망"]),
        "시초가": (True, ["시초가"], ["/", "대비"]),
        "종가": (False, ["첫날종가", "첫날"], []),
    },
}


def 읽기_수요예측(html: str) -> "tuple[list[dict], str]":
    줄들, 이유 = _표에서(html, _규칙["수요예측"])
    out = []
    for z in 줄들:
        이름 = z["이름"][0]
        if not 이름 or 이름 in ("기업명", "종목명"):
            continue
        out.append({
            "name": 이름, "no": _번호(z["이름"][1]),
            **_일정칸(z),
            "inst_ratio": _경쟁률(z["기관"][0]),
            "lockup_pct": _퍼센트(z["확약"][0]),
        })
    return out, 이유 if not out else ""


def _일정칸(z: dict) -> dict:
    """수요예측 두 표에 함께 있는 칸 — 있는 것만."""
    r: dict = {}
    if "예측일" in z:
        r["forecast_date"] = _iso(_날짜(z["예측일"][0]))
    if "희망" in z:
        r["band_low"], r["band_high"] = _범위(z["희망"][0])
    if "공모가" in z:
        r["offer_price"] = _수(z["공모가"][0])
    if "금액" in z:
        r["offer_amount"] = _수(z["금액"][0])
    if "주관사" in z:
        r["underwriter"] = z["주관사"][0]
    return r


def 읽기_수요예측일정(html: str) -> "tuple[list[dict], str]":
    줄들, 이유 = _표에서(html, _규칙["수요예측일정"])
    out = []
    for z in 줄들:
        이름 = z["이름"][0]
        if not 이름 or 이름 in ("기업명", "종목명"):
            continue
        out.append({"name": 이름, "no": _번호(z["이름"][1]), **_일정칸(z)})
    return out, 이유 if not out else ""


def 읽기_청약(html: str) -> "tuple[list[dict], str]":
    줄들, 이유 = _표에서(html, _규칙["청약"])
    out = []
    for z in 줄들:
        이름 = z["이름"][0]
        if not 이름 or 이름 in ("기업명", "종목명"):
            continue
        시작, 끝 = _기간(z["일정"][0])
        r = {
            "name": 이름, "no": _번호(z["이름"][1]),
            "sub_start": _iso(시작), "sub_end": _iso(끝),
            "sub_ratio": _경쟁률(z["청약"][0]),
            "underwriter": z["주관사"][0] if "주관사" in z else None,
        }
        if "공모가" in z:
            r["offer_price"] = _수(z["공모가"][0])
        if "희망" in z:
            r["band_low"], r["band_high"] = _범위(z["희망"][0])
        out.append(r)
    return out, 이유 if not out else ""


def 읽기_신규상장(html: str) -> "tuple[list[dict], str]":
    줄들, 이유 = _표에서(html, _규칙["신규상장"])
    out = []
    for z in 줄들:
        이름 = z["이름"][0]
        if not 이름 or 이름 in ("기업명", "종목명"):
            continue
        out.append({
            "name": 이름, "no": _번호(z["이름"][1]),
            "list_date": _iso(_날짜(z["상장일"][0])),
            "offer_price": _수(z["공모가"][0]),
            "open_price": _수(z["시초가"][0]),
            "close_price": _수(z["종가"][0]) if "종가" in z else None,
        })
    return out, 이유 if not out else ""


_읽기 = {"수요예측": 읽기_수요예측, "수요예측일정": 읽기_수요예측일정,
        "청약": 읽기_청약, "신규상장": 읽기_신규상장}
#: 쪽을 넘기다 멈출 때 볼 날짜 칸
_날짜칸 = {"수요예측": "forecast_date", "수요예측일정": "forecast_date",
          "청약": "sub_start", "신규상장": "list_date"}


def _iso(d: "date | None") -> "str | None":
    return d.isoformat() if d else None


def _d(s) -> "date | None":
    try:
        return date.fromisoformat(s) if s else None
    except ValueError:
        return None


# ── 받기 ──────────────────────────────────────────────────
_좋은바탕: "str | None" = None


def _글로(r) -> str:
    """38 은 EUC-KR(cp949) 이다. 알려 주는 것이 utf-8 이면 그것을 따른다."""
    본 = r.content
    알림 = (r.headers.get("content-type") or "").lower()
    머리 = 본[:2048].decode("ascii", "ignore").lower()
    if "utf-8" in 알림 or "charset=utf-8" in 머리:
        return 본.decode("utf-8", "replace")
    return 본.decode("cp949", "replace")


def _받기(목록: str, 쪽: int) -> "tuple[str | None, str]":
    """(본문, 실패 이유)"""
    global _좋은바탕
    이유 = ""
    for 바탕 in ([_좋은바탕] if _좋은바탕 else []) + [b for b in _바탕들 if b != _좋은바탕]:
        try:
            r = httpx.get(f"{바탕}{_목록경로[목록]}&page={쪽}", headers=_H, timeout=12,
                          verify=SSL, follow_redirects=True)
        except Exception as e:
            이유 = f"연결 실패({type(e).__name__})"
            continue
        if r.status_code != 200:
            이유 = f"HTTP {r.status_code}"
            continue
        _좋은바탕 = 바탕
        return _글로(r), ""
    return None, 이유


def _목록받기(목록: str, 쪽수: int) -> "tuple[list[dict], str]":
    """한 목록을 앞에서부터 쪽수만큼. 새 규칙보다 한참 앞 것이 나오면 멈춘다."""
    모음: list = []
    이유 = ""
    지난이름: set = set()
    멈출날 = 새규칙_시작 - timedelta(days=60)
    for 쪽 in range(1, 쪽수 + 1):
        본문, 이유 = _받기(목록, 쪽)
        if 본문 is None:
            break
        줄들, 이유 = _읽기[목록](본문)
        이름들 = {r["name"] for r in 줄들}
        if not 줄들 or 이름들 <= 지난이름:      # 끝 쪽을 넘으면 같은 쪽을 다시 준다
            break
        모음 += 줄들
        지난이름 |= 이름들
        날짜들 = [d for r in 줄들 if (d := _d(r.get(_날짜칸[목록])))]
        if 날짜들 and max(날짜들) < 멈출날:
            break
        if 쪽 < 쪽수 and 쪽_쉼:
            time.sleep(쪽_쉼)
    return 모음, ("" if 모음 else 이유 or "빈손")


# ── 기록 합치기 ────────────────────────────────────────────
def 합치기(기록: dict, 줄들: list) -> dict:
    """줄마다 그 종목 기록에 덮어쓴다 — 값이 있는 칸만(없는 칸이 알던 값을 지우지 않게)."""
    for r in 줄들:
        k = 열쇠(r.get("name"))
        if not k:
            continue
        옛 = dict(기록.get(k) or {"name": r["name"], "kind": 종류(r["name"])})
        for f, v in r.items():
            if v is not None and v != "":
                옛[f] = v
        기록[k] = 옛
    return 기록


def _코드붙이기(기록: dict) -> None:
    """상장한 종목에 코드·시장을 붙인다(종목 화면으로 이어 주려고)."""
    try:
        from app.services.ticker_service import get_kr_db
        이름표 = {열쇠(t["n"]): t for t in get_kr_db() if t.get("n") and t.get("c")}
    except Exception:
        return
    for r in 기록.values():
        if not r.get("code") and (t := 이름표.get(열쇠(r.get("name")))):
            r["code"], r["market"] = t["c"], t.get("x")


# ── 저장 ──────────────────────────────────────────────────
_기록: "dict | None" = None
_받은때: float = 0.0
_상태: dict = {}          # 목록별 {"rows", "reason", "at"}
_갱신중 = False
_시도때: float = 0.0       # 마지막으로 받으러 간 때(성공·실패 모두)
_자물쇠 = threading.Lock()


def _db_읽기() -> "tuple[dict, float, dict]":
    try:
        from app.db.database import SessionLocal
        from app.models.stock import IpoSnapshot
        db = SessionLocal()
        try:
            줄 = db.get(IpoSnapshot, "records")
            if 줄 and isinstance(줄.data, dict):
                at = 줄.fetched_at.replace(tzinfo=timezone.utc).timestamp() if 줄.fetched_at else 0.0
                return dict(줄.data.get("records") or {}), at, dict(줄.data.get("status") or {})
        finally:
            db.close()
    except Exception as e:
        log.debug("공모주 기록 읽기 실패: %s", type(e).__name__)
    return {}, 0.0, {}


def _db_쓰기(기록: dict, 상태: dict) -> None:
    try:
        from app.db.database import SessionLocal
        from app.models.stock import IpoSnapshot
        db = SessionLocal()
        try:
            줄 = db.get(IpoSnapshot, "records")
            값 = {"records": 기록, "status": 상태}
            if 줄:
                줄.data, 줄.fetched_at = 값, datetime.utcnow()
            else:
                db.add(IpoSnapshot(key="records", data=값, fetched_at=datetime.utcnow()))
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
    except Exception as e:
        log.warning("공모주 기록 남기기 실패: %s", type(e).__name__)


def 기록들() -> dict:
    """메모리에 든 기록. 처음 부를 때 DB 에서 읽는다."""
    global _기록, _받은때, _상태
    if _기록 is None:
        with _자물쇠:
            if _기록 is None:
                _기록, _받은때, _상태 = _db_읽기()
    return _기록


def _결과수(기록: dict) -> int:
    return sum(1 for r in 기록.values()
               if r.get("kind") == "normal" and r.get("open_price") and r.get("offer_price")
               and (d := _d(r.get("list_date"))) and d >= 새규칙_시작)


def 새로받기(쪽수: "int | None" = None) -> dict:
    """목록들을 받아 기록에 합치고 DB 에 남긴다. 목록별 줄 수를 돌려준다.

    목록마다 '거슬러 받기를 마쳤는지' 를 기억한다. 아직이면 새 규칙 시작
    때까지 거슬러 받고, 마쳤으면 앞쪽 몇 쪽만 받는다. 예전에는 '결과가 있는
    공모주가 충분한가' 하나로 정했는데, 그러면 나중에 고친 목록(수요예측결과)이
    다른 목록 덕에 '충분하다' 로 보여 과거를 영영 안 받았다."""
    global _기록, _받은때, _상태, _시도때
    from app.core import health
    _시도때 = time.time()
    기록 = dict(기록들())
    상태 = {}
    for 목록 in _목록경로:
        마침 = bool((_상태.get(목록) or {}).get("backfilled"))
        이번쪽수 = 쪽수 if 쪽수 is not None else (평소_쪽수 if 마침 else 거슬러_쪽수)
        줄들, 이유 = _목록받기(목록, 이번쪽수)
        합치기(기록, 줄들)
        상태[목록] = {"rows": len(줄들), "reason": 이유, "at": time.time(),
                     "backfilled": 마침 or (bool(줄들) and 이번쪽수 >= 거슬러_쪽수)}
        if 줄들:
            health.record_ok(_건강이름[목록], None, f"{len(줄들)}줄 · {이번쪽수}쪽까지")
        else:
            health.record_fail(_건강이름[목록], 이유 or "빈손")
    _코드붙이기(기록)
    if any(s["rows"] for s in 상태.values()):
        _db_쓰기(기록, 상태)
        _기록, _받은때 = 기록, time.time()
    _상태 = 상태
    _예측보관.clear()
    return {k: v["rows"] for k, v in 상태.items()}


def _모자란목록() -> bool:
    """받아야 할 목록 중 아직 한 번도 못 받은 것이 있나(새로 더한 목록, 막힌 목록)."""
    return any(not (_상태.get(k) or {}).get("rows") for k in _목록경로)


def _뒤에서_받기() -> bool:
    """오래됐거나 못 받은 목록이 있으면 뒤에서 새로 받는다(한 번에 하나만). 시작했으면 True.

    못 받은 목록이 있으면 6시간을 기다리지 않는다 — 고친 것을 배포해도 몇 시간
    뒤에야 반영되던 것을 막는다. 다만 막힌 동안은 실패쉼(10분)마다 한 번만."""
    global _갱신중
    지금 = time.time()
    if _갱신중 or 지금 - _시도때 < 실패쉼:
        return False
    if 지금 - _받은때 < 갱신간격 and not _모자란목록():
        return False
    try:
        from app.core import memory
        if not memory.has_headroom("공모주 자료"):
            return False
    except Exception:
        pass
    _갱신중 = True

    def 일():
        global _갱신중
        try:
            새로받기()
        except Exception as e:
            log.warning("공모주 자료 받기 실패: %s", type(e).__name__)
        finally:
            _갱신중 = False
    threading.Thread(target=일, daemon=True, name="ipo-refresh").start()
    return True


# ── 예측 ──────────────────────────────────────────────────
#: 견줄 항목 — (이름, 화면 이름)
항목들 = (("inst", "기관경쟁률"), ("lock", "의무보유확약"), ("sub", "청약경쟁률"),
          ("band", "밴드 안 위치"), ("size", "공모금액"), ("mood", "최근 분위기"))
이웃수 = 8
#: 그룹 안에 결과가 이만큼은 있어야 예측한다
최소학습 = 8
#: 회귀는 이만큼 줄이 있어야 세운다
최소회귀 = 15


def 특징(r: dict, 분위기: "float | None") -> dict:
    """기록 → 견줄 값들. 모르는 것은 None."""
    def _v(k):
        v = r.get(k)
        return float(v) if isinstance(v, (int, float)) else None
    기관, 확약, 청약 = _v("inst_ratio"), _v("lockup_pct"), _v("sub_ratio")
    공모가, 상단, 금액 = _v("offer_price"), _v("band_high"), _v("offer_amount")
    return {
        "inst": math.log1p(기관) if 기관 is not None else None,
        "lock": 확약 / 100 if 확약 is not None else None,
        "sub": math.log1p(청약) if 청약 is not None else None,
        "band": (공모가 / 상단 - 1) if 공모가 and 상단 else None,
        "size": math.log(금액) if 금액 and 금액 > 0 else None,
        "mood": 분위기,
    }


def 결과배율(r: dict) -> "float | None":
    시초, 공모 = r.get("open_price"), r.get("offer_price")
    if not 시초 or not 공모 or 시초 <= 0 or 공모 <= 0:
        return None
    return 시초 / 공모


def _학습감(기록: dict, 그룹: str) -> list:
    """새 규칙 뒤 상장해 시초가가 있는 같은 그룹 공모주를 상장일 순으로."""
    out = []
    for r in 기록.values():
        d = _d(r.get("list_date"))
        if (r.get("kind") or 종류(r.get("name"))) != 그룹 or not d or d < 새규칙_시작:
            continue
        if 결과배율(r) is None:
            continue
        out.append(r)
    out.sort(key=lambda r: r["list_date"])
    return out


def _분위기값(앞y: list, 반감: "float | None" = None) -> "float | None":
    """앞서 상장한 공모주들의 log(시초가/공모가) 를 모은 값 — 요즘 공모주 시장 온도.

    반감이 없으면 직전 10곳 평균(처음 방식). 있으면 직전 20곳을, 그 곳 수만큼
    거슬러 갈 때마다 무게가 절반이 되게 가중평균한다 — 분위기가 바뀌면 빨리 따라간다."""
    if len(앞y) < 3:
        return None
    if 반감 is None:
        앞 = 앞y[-10:]
        return sum(앞) / len(앞)
    앞 = 앞y[-20:]
    무게 = [0.5 ** ((len(앞) - 1 - k) / 반감) for k in range(len(앞))]
    return sum(w * y for w, y in zip(무게, 앞)) / sum(무게)


class 모델:
    """기록 한 벌로 여러 번 맞힐 때 학습표를 한 번만 만든다.

    학습표의 각 줄은 '그 공모주 상장일 전' 의 분위기를 쓴다 — 줄의 값이
    맞힐 대상에 따라 달라지지 않으므로, 대상마다 '그날 전 상장' 까지만
    잘라 쓰면 된다(시간순 검증이 60번 맞혀도 표는 한 번).

    반감 — 분위기를 모으는 방식(_분위기값). 학습표와 맞힐 대상이 같은 방식을 쓴다."""

    def __init__(self, 기록: dict, 반감: "float | None" = None):
        self.기록 = 기록
        self.반감 = 반감
        self._표: dict = {}

    def 표(self, 그룹: str) -> list:
        """[(특징, y, 기록, 상장일)] — 상장일 순."""
        if 그룹 not in self._표:
            감 = _학습감(self.기록, 그룹)
            ys = [math.log(결과배율(r)) for r in 감]
            날 = [_d(r["list_date"]) for r in 감]
            표, j = [], 0
            for i, r in enumerate(감):
                while j < i and 날[j] < 날[i]:      # 같은 날 상장은 서로의 '앞' 이 아니다
                    j += 1
                표.append((특징(r, _분위기값(ys[:j], self.반감)), ys[i], r, 날[i]))
            self._표[그룹] = 표
        return self._표[그룹]

    def 그날전(self, 그룹: str, 기준일: date) -> list:
        return [x for x in self.표(그룹) if x[3] < 기준일]

    def 분위기(self, 그룹: str, 기준일: date) -> "float | None":
        return _분위기값([x[1] for x in self.그날전(그룹, 기준일)], self.반감)

    def 예측(self, 대상: dict, 기준일: "date | None" = None) -> dict:
        return _예측(self, 대상, 기준일 or 오늘())


def 분위기(기록: dict, 기준일: date, 그룹: str = "normal") -> "float | None":
    """기준일 전 상장한 공모주 10개의 log(시초가/공모가) 평균 — 요즘 공모주 시장 온도."""
    return 모델(기록).분위기(그룹, 기준일)


def _가중분위(값무게: list, q: float) -> float:
    쌍 = sorted(값무게)
    전체 = sum(w for _, w in 쌍)
    누적 = 0.0
    for v, w in 쌍:
        누적 += w
        if 누적 >= q * 전체 - 1e-12:
            return v
    return 쌍[-1][0]


def _통계(표: list) -> dict:
    통계 = {}
    for f, _ in 항목들:
        값 = [x[0][f] for x in 표 if x[0][f] is not None]
        if len(값) >= 5:
            평 = sum(값) / len(값)
            편 = math.sqrt(sum((v - 평) ** 2 for v in 값) / len(값))
            if 편 > 1e-9:
                통계[f] = (평, 편)
    return 통계


def _이웃(표: list, 대상: dict, 통계: dict, k: int = 이웃수):
    쓸것 = [f for f, _ in 항목들 if 대상.get(f) is not None and f in 통계]
    if len(쓸것) < 2:
        return None
    거리 = []
    for 특, y, r, _ in 표:
        공통 = [f for f in 쓸것 if 특[f] is not None]
        if len(공통) < max(2, len(쓸것) - 1):
            continue
        d = math.sqrt(sum(((대상[f] - 특[f]) / 통계[f][1]) ** 2 for f in 공통) / len(공통))
        거리.append((d, y, r))
    if len(거리) < min(k, 최소학습):
        return None
    거리.sort(key=lambda x: x[0])
    return 거리[:k], 쓸것


def _릿지(표: list, 대상: dict, 통계: dict, λ: float = 1.0) -> "float | None":
    """대상에 있는 항목으로 직선 모델을 세워 맞힌다. 줄이 모자라면 항목을 덜어 낸다."""
    import numpy as np
    쓸것 = [f for f, _ in 항목들 if 대상.get(f) is not None and f in 통계]
    # 적게 채워진 항목부터 덜어 낸다
    쓸것.sort(key=lambda f: -sum(1 for x in 표 if x[0][f] is not None))
    while 쓸것:
        줄 = [x for x in 표 if all(x[0][f] is not None for f in 쓸것)]
        if len(줄) >= 최소회귀:
            break
        쓸것.pop()
    if not 쓸것:
        return None
    X = np.array([[(x[0][f] - 통계[f][0]) / 통계[f][1] for f in 쓸것] for x in 줄])
    y = np.array([x[1] for x in 줄])
    평y = y.mean()
    β = np.linalg.solve(X.T @ X + λ * np.eye(len(쓸것)), X.T @ (y - 평y))
    v = np.array([(대상[f] - 통계[f][0]) / 통계[f][1] for f in 쓸것])
    return float(평y + v @ β)


def 호가단위(가격: float) -> int:
    """유가증권·코스닥 공통 호가 단위(2023-01-25 부터)."""
    for 위, 단위 in ((2_000, 1), (5_000, 5), (20_000, 10), (50_000, 50),
                     (200_000, 100), (500_000, 500)):
        if 가격 < 위:
            return 단위
    return 1_000


def 가격으로(공모가: float, 배율: float) -> int:
    """공모가 × 배율 을 첫날 범위(60~400%) 안으로 넣고 호가 단위에 맞춘다."""
    배율 = min(max(배율, 하한배율), 상한배율)
    p = 공모가 * 배율
    단위 = 호가단위(p)
    return int(round(p / 단위) * 단위)


def 예측하기(기록: dict, 대상: dict, 기준일: "date | None" = None) -> dict:
    """대상(기록 모양) 의 시초가를 맞힌다. 기준일 전에 상장한 것만 쓴다.

    돌려주는 것 — 예측이 되면 {"ok": True, ...}, 안 되면 {"ok": False, "reason"}."""
    return 모델(기록).예측(대상, 기준일)


def _예측(m: "모델", 대상: dict, 기준일: date) -> dict:
    공모가 = 대상.get("offer_price")
    if not 공모가 or 공모가 <= 0:
        return {"ok": False, "reason": "확정 공모가가 나오면 예측해요"}
    if 대상.get("inst_ratio") is None or 대상.get("lockup_pct") is None:
        return {"ok": False, "reason": "수요예측 결과(기관경쟁률·확약)가 나오면 예측해요"}
    그룹 = 대상.get("kind") or 종류(대상.get("name"))
    표 = m.그날전(그룹, 기준일)
    if len(표) < 최소학습:
        이름 = {"spac": "스팩", "reit": "리츠"}.get(그룹, "공모주")
        return {"ok": False, "reason": f"견줄 {이름} 결과가 아직 {len(표)}건뿐이에요"}
    통계 = _통계(표)
    대상특징 = 특징(대상, _분위기값([x[1] for x in 표], m.반감))
    이웃결과 = _이웃(표, 대상특징, 통계)
    if not 이웃결과:
        return {"ok": False, "reason": "견줄 만큼 비슷한 공모주가 없어요"}
    이웃, 쓴것 = 이웃결과
    무게 = [(y, 1.0 / (d + 0.25)) for d, y, _ in 이웃]
    이웃값 = _가중분위(무게, 0.5)
    회귀값 = _릿지(표, 대상특징, 통계)
    ŷ = (이웃값 + 회귀값) / 2 if 회귀값 is not None else 이웃값
    ŷ = min(max(ŷ, math.log(하한배율)), math.log(상한배율))
    합 = sum(w for _, w in 무게)
    아래, 위 = math.exp(_가중분위(무게, 0.25)), math.exp(_가중분위(무게, 0.75))
    배율 = math.exp(ŷ)
    이름표 = dict(항목들)
    return {
        "ok": True,
        "group": 그룹,
        "ratio": round(배율, 4),
        "price": 가격으로(공모가, 배율),
        "return_pct": round((min(max(배율, 하한배율), 상한배율) - 1) * 100, 1),
        "range": {"low_ratio": round(max(아래, 하한배율), 4), "high_ratio": round(min(위, 상한배율), 4),
                  "low_price": 가격으로(공모가, 아래), "high_price": 가격으로(공모가, 위)},
        "p_double": round(sum(w for y, w in 무게 if y >= math.log(2) - 1e-9) / 합, 3),
        "p_below": round(sum(w for y, w in 무게 if y < -1e-9) / 합, 3),
        "neighbors": [_이웃줄(r, y) for _, y, r in 이웃[:5]],
        "used": [이름표[f] for f in 쓴것],
        "missing": [이름표[f] for f, _ in 항목들 if 대상특징.get(f) is None],
        "n_train": len(표),
        "parts": {"neighbors_ratio": round(math.exp(이웃값), 4),
                  "regression_ratio": round(math.exp(회귀값), 4) if 회귀값 is not None else None},
    }


def _이웃줄(r: dict, y: float) -> dict:
    return {"name": r.get("name"), "code": r.get("code"), "list_date": r.get("list_date"),
            "ratio": round(math.exp(y), 4), "inst_ratio": r.get("inst_ratio"),
            "lockup_pct": r.get("lockup_pct"), "sub_ratio": r.get("sub_ratio"),
            "offer_price": r.get("offer_price"), "open_price": r.get("open_price")}


#: 지난 공모주를 '맞혔다' 고 보는 폭(%) — 실제 시초가가 예측 시초가의 ±이만큼 안.
#: 수익률 차이(%p)로 재면 많이 오른 공모주일수록 차이가 커 보인다 — +270% 와 +300% 는
#: 30%p 차이지만 값으로는 3.7배와 4.0배, 8% 차이다. 예상 범위(비슷했던 공모주 가운데
#: 절반) 안에 들었는지로 재면 잘 맞아도 절반쯤은 밖이라, 쌓일수록 50% 로 모일 뿐이다
맞힘폭 = 10

#: 견줘 보는 방식 — (열쇠, 화면 이름, 분위기 반감, 최근 오차 보정)
#:
#: 2026년 7~8월에는 연달아 높게 봤고, 9월 말부터는 여섯 곳이 연달아 예측보다 38~92%
#: 높게 시작했다 — 직전 10곳 평균으로 잰 분위기가 바뀐 시장을 늦게 따라갔다. 그래서
#: 둘을 더해 본다.
#:   · 빠른 분위기 — 요즘 상장한 곳일수록 크게 본다(_분위기값 반감 3곳)
#:   · 최근 오차 보정 — 직전 몇 곳이 그 방식의 예측보다 높게(낮게) 시작했으면 그
#:     평균의 절반만큼 올려(내려) 잡는다
#: 어느 쪽이 나은지는 시장이 정한다 — 넷을 모두 걸어가며 맞혀 보고, 맞힐 날 전 직전
#: 몇 곳에서 가장 잘 맞아 온 방식을 쓴다(_고르기). 분위기가 몇 곳마다 바뀌는 가짜
#: 세상에서는 보정이 맞힘을 30% → 40% 로 올렸고, 바뀌지 않는 세상에서는 기본이 골라졌다
방식들 = (
    ("base", "기본", None, False),
    ("fast", "빠른 분위기", 3, False),
    ("base_fix", "기본 + 최근 오차 보정", None, True),
    ("fast_fix", "빠른 분위기 + 최근 오차 보정", 3, True),
)
#: 최근 오차 보정 — 직전 몇 곳의 오차를, 그 평균의 얼마만큼, 며칠 안에 상장한 것만, 많아야 얼마까지
보정_곳, 보정_몫, 보정_기한 = 3, 0.5, 90
보정_한도 = math.log(1.5)
#: 방식 고르기 — 직전 몇 곳의 성적으로 고르나. 이보다 덜 쌓였으면 기본을 쓴다
고르기_곳, 고르기_최소 = 40, 10


def _걸음(기록: dict, 곳: int) -> list:
    """최근 상장한 일반 공모주 '곳' 개를 상장일 순으로, 분위기 방식마다 그 전 상장만으로 맞힌다.

    [(기록, 상장일, 실제 y, {반감: log 예측배율})] — 한 방식이라도 못 맞힌 줄은 뺀다."""
    모델들 = {반감: 모델(기록, 반감) for _, _, 반감, _ in 방식들}
    out = []
    for _, y, r, d in next(iter(모델들.values())).표("normal")[-곳:]:
        대상 = {**r, "open_price": None, "close_price": None}
        예측들 = {반감: m.예측(대상, d) for 반감, m in 모델들.items()}
        if all(p.get("ok") for p in 예측들.values()):
            out.append((r, d, y, {반감: math.log(p["ratio"]) for 반감, p in 예측들.items()}))
    return out


def _보정값(걸음: list, 기본: list, 기준일: date) -> float:
    """기준일 전 직전 보정_곳 곳(보정_기한 일 안)이 이 방식의 예측(기본)보다 얼마나 높게
    시작했나 — log 오차 평균에 보정_몫을 곱해 ±보정_한도 로 자른 값. 없으면 0."""
    오차 = [e[2] - 기본[j] for j, e in enumerate(걸음)
            if e[1] < 기준일 and (기준일 - e[1]).days <= 보정_기한][-보정_곳:]
    if not 오차:
        return 0.0
    return min(max(보정_몫 * sum(오차) / len(오차), -보정_한도), 보정_한도)


def _방식별(걸음: list) -> dict:
    """{방식 열쇠: [줄마다 log 예측배율]} — 보정은 그 줄 상장일 전의 오차만 쓴다."""
    out = {}
    for k, _, 반감, 보정 in 방식들:
        기본 = [e[3][반감] for e in 걸음]
        out[k] = [min(max(v + (_보정값(걸음, 기본, e[1]) if 보정 else 0.0),
                          math.log(하한배율)), math.log(상한배율))
                  for v, e in zip(기본, 걸음)]
    return out


def _고르기(걸음: list, 방식값: dict, 기준일: date) -> str:
    """기준일 전 상장한 직전 고르기_곳 곳에서 가장 잘 맞아 온 방식 — log 오차 절댓값의 합이
    가장 작은 것. 같으면 방식들의 앞쪽. 덜 쌓였으면 기본."""
    앞 = [j for j, e in enumerate(걸음) if e[1] < 기준일][-고르기_곳:]
    if len(앞) < 고르기_최소:
        return 방식들[0][0]
    return min((k for k, *_ in 방식들),
               key=lambda k: sum(abs(걸음[j][2] - 방식값[k][j]) for j in 앞))


def _차이(r: dict, 로그배율: float) -> tuple:
    """(예측 배율, 예측 시초가, 실제 ÷ 예측 − 1 을 화면에 적는 정수 %)"""
    배율 = math.exp(로그배율)
    가격 = 가격으로(r["offer_price"], 배율)
    return 배율, 가격, round((r["open_price"] / 가격 - 1) * 100)


def _성적(차이들: list) -> dict:
    절대 = sorted(abs(x) for x in 차이들)
    n = len(절대)
    return {"median_abs_diff_pct": 절대[n // 2] if n else None,
            "hit_rate": round(sum(a <= 맞힘폭 for a in 절대) / n, 3) if n else None}


def _검증(기록: dict, 최근: int, 기준일: date) -> tuple:
    """(화면에 줄 시간순 검증, 기준일에 쓸 방식 {"key", "name", "반감", "보정"(log)}).

    줄마다 그 줄 상장일 전에 가장 잘 맞아 온 방식으로 맞힌 값을 보여 준다 — 방식을
    고를 때도 그 뒤의 결과는 보지 않는다. 방식별 성적(methods)은 같은 줄들을 그 방식
    하나로만 맞혔을 때다."""
    걸음 = _걸음(기록, 최근 + 고르기_곳 + 보정_곳)
    방식값 = _방식별(걸음)
    이름 = {k: 화면이름 for k, 화면이름, *_ in 방식들}
    줄들, 방향 = [], []
    방식차이: dict = {k: [] for k in 이름}
    for i in range(max(0, len(걸음) - 최근), len(걸음)):
        r, d, _, _ = 걸음[i]
        고른 = _고르기(걸음, 방식값, d)
        배율, 가격, 차이 = _차이(r, 방식값[고른][i])
        실제 = 결과배율(r)
        방향.append((배율 >= 1) == (실제 >= 1))
        for k in 방식차이:
            방식차이[k].append(_차이(r, 방식값[k][i])[2])
        줄들.append({"name": r["name"], "code": r.get("code"), "list_date": r["list_date"],
                     "offer_price": r["offer_price"], "open_price": r["open_price"],
                     "actual_ratio": round(실제, 4), "pred_ratio": round(배율, 4), "pred_price": 가격,
                     "diff_pct": 차이, "hit": abs(차이) <= 맞힘폭, "method": 고른})
    n = len(줄들)
    지금 = _고르기(걸음, 방식값, 기준일)
    반감, 보정 = next((b, f) for k, _, b, f in 방식들 if k == 지금)
    c = _보정값(걸음, [e[3][반감] for e in 걸음], 기준일) if 보정 else 0.0
    검증 = {
        "n": n,
        "hit_band_pct": 맞힘폭,
        **_성적([x["diff_pct"] for x in 줄들]),
        "direction_hit": round(sum(방향) / n, 3) if n else None,
        "method": {"key": 지금, "name": 이름[지금], "pick_window": 고르기_곳},
        "methods": [{"key": k, "name": 이름[k], **_성적(방식차이[k])} for k in 이름],
        "rows": 줄들[::-1],
    }
    return 검증, {"key": 지금, "name": 이름[지금], "반감": 반감, "보정": c}


def 걸어가며_검증(기록: dict, 최근: int = 60) -> dict:
    """최근 상장한 일반 공모주를 하나씩, 그 전에 상장한 것만으로 맞혀 본다.

    차이는 '실제 시초가 ÷ 예측 시초가 − 1' 을 화면에 적는 정수(%)로 반올림한 값이고,
    맞힘도 그 정수로 가른다 — 적힌 숫자와 ✓·✗ 가 어긋나지 않게."""
    return _검증(기록, 최근, 오늘())[0]


def _방식대로(모델들: dict, 대상: dict, 기준일: date, 지금: dict) -> dict:
    """대상을 지금 쓰는 방식으로 맞힌다. 방식은 일반 공모주로 골랐으므로 스팩·리츠는 기본 그대로.

    모델들 — {반감: 모델}. 기본(None)과 지금 방식의 반감이 들어 있어야 한다."""
    if (대상.get("kind") or 종류(대상.get("name"))) != "normal":
        return 모델들[None].예측(대상, 기준일)
    p = 모델들[지금["반감"]].예측(대상, 기준일)
    if not p.get("ok"):
        return p
    p = {**p, "method": {"key": 지금["key"], "name": 지금["name"]},
         "parts": {**p["parts"], "correction_pct": round((math.exp(지금["보정"]) - 1) * 100)}}
    if 지금["보정"]:
        배율 = min(max(p["ratio"] * math.exp(지금["보정"]), 하한배율), 상한배율)
        p.update(ratio=round(배율, 4), price=가격으로(대상["offer_price"], 배율),
                 return_pct=round((배율 - 1) * 100, 1))
    return p


def _모델들(기록: dict, 지금: dict) -> dict:
    모델들 = {None: 모델(기록)}
    if 지금["반감"] is not None:
        모델들[지금["반감"]] = 모델(기록, 지금["반감"])
    return 모델들


# ── 화면에 줄 것 ───────────────────────────────────────────
def 단계(r: dict, 기준일: date) -> str:
    상장 = _d(r.get("list_date"))
    if r.get("open_price"):
        return "상장"
    if 상장 and 상장 <= 기준일:
        return "상장"
    if 상장:
        return "상장 예정"
    if r.get("sub_ratio") is not None:
        return "청약 완료"
    끝 = _d(r.get("sub_end"))
    if 끝 and 끝 >= 기준일 and r.get("inst_ratio") is not None:
        return "청약 예정"
    if r.get("inst_ratio") is not None:
        return "수요예측 완료"
    return "수요예측 전"


def _다가오는(기록: dict, 기준일: date) -> list:
    """아직 시초가가 없는 최근·앞으로의 공모주."""
    out = []
    for r in 기록.values():
        if r.get("open_price"):
            continue
        날짜들 = [d for k in ("list_date", "sub_end", "sub_start", "forecast_date") if (d := _d(r.get(k)))]
        if not 날짜들 or max(날짜들) < 기준일 - timedelta(days=7):
            continue
        out.append(r)
    out.sort(key=lambda r: (_d(r.get("list_date")) or date.max,
                            _d(r.get("sub_start")) or date.max, r.get("name") or ""))
    return out


_예측보관: dict = {}


def 한눈에() -> dict:
    """공모주 메뉴가 한 번에 받는 것 — 다가오는 공모주(예측과 함께)·최근 결과·정확도·자료 상태."""
    기록 = 기록들()
    새로받는중 = _뒤에서_받기()
    기준일 = 오늘()
    열 = (id(기록), _받은때, 기준일)
    if (있음 := _예측보관.get("값")) and _예측보관.get("열") == 열:
        return {**있음, "refreshing": 새로받는중 or _갱신중}
    검증, 지금 = _검증(기록, 60, 기준일)
    모델들 = _모델들(기록, 지금)
    다가옴 = [{**_공개(r), "stage": 단계(r, 기준일), "prediction": _방식대로(모델들, r, 기준일, 지금)}
              for r in _다가오는(기록, 기준일)]
    값 = {
        "as_of": datetime.fromtimestamp(_받은때, KST).isoformat() if _받은때 else None,
        "upcoming": 다가옴,
        "recent": 검증.pop("rows")[:30],
        "accuracy": 검증,
        "train_since": 새규칙_시작.isoformat(),
        "n_records": len(기록),
        "n_results": _결과수(기록),
        "source": {"name": "38커뮤니케이션", "lists": {k: {"rows": v.get("rows", 0), "reason": v.get("reason", "")}
                                                      for k, v in _상태.items()}},
    }
    _예측보관.update(열=열, 값=값, 지금=지금)
    return {**값, "refreshing": 새로받는중 or _갱신중}


_공개칸 = ("name", "code", "market", "kind", "forecast_date", "band_low", "band_high",
          "offer_price", "offer_amount", "inst_ratio", "lockup_pct", "sub_start", "sub_end",
          "sub_ratio", "list_date", "underwriter")


def _공개(r: dict) -> dict:
    return {k: r.get(k) for k in _공개칸}


def 직접_예측(값: dict) -> dict:
    """사람이 넣은 숫자로 맞힌다(공모주 메뉴의 '직접 넣어 보기'). 다가오는 공모주와 같은 방식으로."""
    대상 = {
        "name": "직접 입력", "kind": 값.get("kind") or "normal",
        "offer_price": 값.get("offer_price"), "inst_ratio": 값.get("inst_ratio"),
        "lockup_pct": 값.get("lockup_pct"), "sub_ratio": 값.get("sub_ratio"),
        "band_low": 값.get("band_low"), "band_high": 값.get("band_high"),
        "offer_amount": 값.get("offer_amount"),
    }
    기록 = 기록들()
    기준일 = 오늘()
    # 화면을 열 때(한눈에) 고른 방식을 그대로 쓴다. 서버가 막 떠서 아직 없으면 지금 고른다
    if _예측보관.get("열") == (id(기록), _받은때, 기준일) and _예측보관.get("지금"):
        지금 = _예측보관["지금"]
    else:
        지금 = _검증(기록, 60, 기준일)[1]
    return _방식대로(_모델들(기록, 지금), 대상, 기준일, 지금)
