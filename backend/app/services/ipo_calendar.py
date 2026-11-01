"""공모주 일정을 내 캘린더로 — 청약·상장 날짜를 iCalendar(.ics) 로 낸다.

두 가지로 쓴다.
  · 구독: 아이폰·구글 캘린더에 이 주소를 한 번 걸어 두면, 캘린더가 몇 시간마다 다시 받아
    새 공모주 일정이 저절로 생긴다(사용자가 앱을 안 열어도).
  · 한 곳만: ?name= 으로 그 공모주 일정만 받아 캘린더에 넣는다.

증권사를 고르면(?brokers=) 그 증권사가 주관하는 공모주만 — 청약은 계좌가 있는 증권사로만 한다.
화면의 '증권사로 거르기'(frontend components/ipo/ipoBrokers.ts)와 같은 규칙으로 이름을 나눈다.
"""
from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, timedelta, timezone

from app.core.config import 앱주소
from app.services import ipo_service

#: 구독 캘린더에 남겨 둘 지난 일정 — 상장하자마자 사라지면 '언제 상장했더라' 를 못 본다
지난일정_날수 = 60

#: 증권사 옛 이름 → 지금 이름 (ipoBrokers.ts 의 새이름과 같게)
_새이름 = {
    "미래에셋대우": "미래에셋증권",
    "신한금융투자": "신한투자증권",
    "하나금융투자": "하나증권",
    "KTB투자증권": "다올투자증권",
    "이베스트투자증권": "LS증권",
    "하이투자증권": "iM증권",
}


def 증권사들(주관사: "str | None") -> list[str]:
    """주관사 칸 → 증권사 이름들. 괄호·㈜·'외 2' 는 빼고, 옛 이름은 지금 이름으로. 같은 이름은 한 번만"""
    if not 주관사:
        return []
    out: list[str] = []
    for 조각 in re.split(r"[,，/·、&+\n]|\s{2,}", 주관사):
        이름 = re.sub(r"\([^)]*\)|㈜|주식회사", "", 조각)
        이름 = re.sub(r"\s*외\s*\d*\s*(?:곳|개사|사)?\s*$", "", 이름)
        이름 = re.sub(r"\s+", "", 이름)
        if not 이름 or 이름 == "-":
            continue
        이름 = _새이름.get(이름, 이름)
        if 이름 not in out:
            out.append(이름)
    return out


#: 알림 받을 증권사를 고르는 칸에 실을 기간 — 지난 이만큼(다가오는 것 포함) 공모주를 주관한 증권사
증권사목록_햇수 = 3


def 증권사_목록(기록: dict, 기준일: date) -> list[dict]:
    """공모주를 주관한 증권사 — 많이 맡은 순(같으면 이름 순). [{name, count}]

    알림 설정의 '어떤 증권사 공모주만 알려 줄까' 칩이 쓴다(사용자: "알림설정에서 그냥 어떤 증권사만
    알림이 오게할지 설정할 수 있도록 해줘"). 지금 다가오는 공모주에 없는 증권사도 고를 수 있어야 한다 —
    청약 계좌가 있는 증권사는 공모주가 잡히기 전에 미리 고른다. 그래서 지난 3년을 본다."""
    시작 = 기준일 - timedelta(days=365 * 증권사목록_햇수)
    수: dict[str, int] = {}
    for r in 기록.values():
        날짜들 = [d for k in ("list_date", "sub_end", "sub_start", "forecast_date") if (d := ipo_service._d(r.get(k)))]
        if not 날짜들 or max(날짜들) < 시작:
            continue
        for 이름 in 증권사들(r.get("underwriter")):
            수[이름] = 수.get(이름, 0) + 1
    return [{"name": 이름, "count": n} for 이름, n in sorted(수.items(), key=lambda kv: (-kv[1], kv[0]))]


# ── iCalendar 글 ──────────────────────────────────────────────
def _글(s: str) -> str:
    """TEXT 값 — 역빗금·쌍반점·쉼표·줄바꿈을 막는다(RFC 5545 3.3.11)"""
    return (s.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
             .replace("\r\n", "\\n").replace("\n", "\\n"))


def _접기(줄: str) -> list[str]:
    """한 줄은 75바이트까지(RFC 5545 3.1). 한글은 한 자가 3바이트라 글자 가운데서 자르면 깨진다 —
    글자 단위로 세어 자르고, 이어지는 줄은 빈칸 하나로 시작한다."""
    out, 지금, 바이트 = [], "", 0
    for 자 in 줄:
        n = len(자.encode("utf-8"))
        한도 = 75 if not out else 74          # 이어지는 줄은 앞의 빈칸 몫을 뺀다
        if 바이트 + n > 한도:
            out.append(지금)
            지금, 바이트 = "", 0
        지금 += 자
        바이트 += n
    out.append(지금)
    return [out[0]] + [" " + x for x in out[1:]]


def _날(d: date) -> str:
    return d.strftime("%Y%m%d")


def _원(v) -> str:
    return f"{float(v):,.0f}원"


def _설명(r: dict, 무엇: str) -> str:
    줄 = []
    if r.get("offer_price"):
        줄.append(f"확정 공모가 {_원(r['offer_price'])}")
    elif r.get("band_low") and r.get("band_high"):
        줄.append(f"희망 공모가 {float(r['band_low']):,.0f}~{_원(r['band_high'])}")
    if 무엇 == "청약":
        if r.get("underwriter"):
            줄.append(f"주관사 {' · '.join(증권사들(r['underwriter'])) or r['underwriter']}")
        if r.get("inst_ratio") is not None:
            줄.append(f"기관경쟁률 {float(r['inst_ratio']):,.0f}:1")
        if r.get("lockup_pct") is not None:
            줄.append(f"의무보유확약 {float(r['lockup_pct']):.1f}%")
        if r.get("equal_shares") is not None:
            줄.append(f"균등 배정 약 {float(r['equal_shares']):g}주")
        줄.append("청약은 보통 마지막 날 오후 4시에 마감해요.")
    else:
        if r.get("market"):
            줄.append(f"시장 {r['market']}")
    앱 = 앱주소()
    if 앱:
        줄.append(f"시초가 예측: {앱}/ipo")
    return "\n".join(줄)


def _uid(r: dict, 무엇: str) -> str:
    """같은 공모주·같은 일정은 늘 같은 UID — 다시 받으면 새로 생기지 않고 고쳐진다(날짜가 바뀌어도)"""
    열쇠 = hashlib.sha1(str(r.get("name")).encode("utf-8")).hexdigest()[:20]
    return f"ipo-{열쇠}-{'sub' if 무엇 == '청약' else 'list'}@stock-platform"


def _일정(r: dict, 무엇: str, 시작: date, 끝: date, 찍은때: str) -> list[str]:
    """하루 종일 일정 하나. 끝(DTEND)은 그다음 날이다(RFC 5545 — 끝은 안 들어간다).
    알람은 첫날 아침 — 청약은 8시 30분(휴대폰 알림과 같은 때, 청약은 10시에 열린다), 상장일은
    9시(장이 열리는 때)."""
    return [
        "BEGIN:VEVENT",
        f"UID:{_uid(r, 무엇)}",
        f"DTSTAMP:{찍은때}",
        f"DTSTART;VALUE=DATE:{_날(시작)}",
        f"DTEND;VALUE=DATE:{_날(끝 + timedelta(days=1))}",
        f"SUMMARY:{_글(f'[{무엇}] ' + (r.get('name') or '공모주'))}",
        f"DESCRIPTION:{_글(_설명(r, 무엇))}",
        "TRANSP:TRANSPARENT",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        f"DESCRIPTION:{_글(f'{무엇} — ' + (r.get('name') or '공모주'))}",
        "TRIGGER:PT8H30M" if 무엇 == "청약" else "TRIGGER:PT9H",
        "END:VALARM",
        "END:VEVENT",
    ]


def 고르기(기록: dict, 기준일: date, 이름: "str | None" = None, 증권사: "list[str] | tuple" = ()) -> list[dict]:
    """캘린더에 실을 공모주 — 청약일이나 상장일이 있고, 지난 일정은 60일까지만(이름을 콕 집으면 날짜는 안 본다)"""
    고른 = set(증권사)
    out = []
    for r in 기록.values():
        if 이름 and r.get("name") != 이름:
            continue
        if 고른 and not (set(증권사들(r.get("underwriter"))) & 고른):
            continue
        날짜들 = [d for k in ("list_date", "sub_end", "sub_start") if (d := ipo_service._d(r.get(k)))]
        if not 날짜들:
            continue
        if not 이름 and max(날짜들) < 기준일 - timedelta(days=지난일정_날수):
            continue
        out.append(r)
    out.sort(key=lambda r: (ipo_service._d(r.get("sub_start")) or ipo_service._d(r.get("list_date")) or date.max,
                            r.get("name") or ""))
    return out


def 만들기(공모주들: list[dict], 지금: "datetime | None" = None, 이름: str = "공모주 일정") -> str:
    """iCalendar 글 한 벌. 줄 끝은 CRLF"""
    찍은때 = (지금 or datetime.now(timezone.utc)).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    줄 = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//stock-platform//ipo//KO",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_글(이름)}",
        "X-WR-TIMEZONE:Asia/Seoul",
        # 구독한 캘린더가 다시 받는 간격 — 일정은 하루에 몇 번 바뀌는 정도다
        "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
        "X-PUBLISHED-TTL:PT6H",
    ]
    for r in 공모주들:
        청약시작 = ipo_service._d(r.get("sub_start"))
        if 청약시작:
            청약끝 = ipo_service._d(r.get("sub_end")) or 청약시작
            줄 += _일정(r, "청약", 청약시작, max(청약끝, 청약시작), 찍은때)
        상장 = ipo_service._d(r.get("list_date"))
        if 상장:
            줄 += _일정(r, "상장", 상장, 상장, 찍은때)
    줄.append("END:VCALENDAR")
    return "\r\n".join(조각 for l in 줄 for 조각 in _접기(l)) + "\r\n"


def 달력(이름: "str | None" = None, 증권사: "list[str] | tuple" = ()) -> str:
    """주소 하나로 받는 캘린더 — 자료가 묵었으면 뒤에서 새로 받기 시작한다(캘린더가 부를 때도)"""
    기록 = ipo_service.기록들()
    ipo_service._뒤에서_받기()
    제목 = f"공모주 · {이름}" if 이름 else ("공모주 일정 · " + "·".join(증권사) if 증권사 else "공모주 일정")
    return 만들기(고르기(기록, ipo_service.오늘(), 이름, 증권사), 이름=제목)
