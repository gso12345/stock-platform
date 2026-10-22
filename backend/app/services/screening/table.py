"""스크리닝 표 — 기초(시세·시가총액·이름) + 원천(재무) + 종목별 야후 줄을 칸별 표(pandas)로 합친다.

전 종목(국내 약 2,700 · 미국 약 7,000)을 종목마다 dict 로 들면 1만 줄에 25~50MB 다(재 봤다). 512MB
서버라 감당이 안 된다. 칸별로 들면(숫자 칸은 numpy 배열) 몇 MB 다. 거르기·세우기도 배열 연산이라
0.15 CPU 에서도 빠르고, 화면에 보낼 한 쪽(100줄)만 dict 로 바꾼다.

어느 값을 쓰나 — 앞의 것이 비었을 때만 뒤의 것
  이름·거래소·업종·산업·국가   기초(국내 KRX 한글 이름, 미국 한글 이름·나스닥 분류) → 야후 줄
  가격·등락·거래량·시가총액     야후 줄(5분마다 묶음 시세로 고친다) → 기초
  재무·기술 지표               야후 줄 → 원천에서 낸 값(KRX·네이버·DART·SEC)
  부채비율                     원천(부채총계 ÷ 자본총계) → 야후 줄 — 야후는 '차입금 ÷ 자본' 이라
                              한 칸에 두 정의가 섞이지 않게 원천을 먼저 쓴다
  4년 흐름(해·매출·EPS)·3년 성장률  야후 줄 → 원천(미국 SEC, 국내 DART 매출·KRX EPS). 세 칸은 한 벌로
                              고른다 — 칸마다 따로 고르면 야후의 해와 SEC 의 매출이 짝을 잃는다
원천의 비율(PER·PBR·배당수익률 …)은 지금 가격으로 다시 나눈다 — 받은 날의 가격으로 낸 값이라서다.
"""
from __future__ import annotations

import math
import re
import time

import numpy as np
import pandas as pd

from app.services.market.yf_service import 스크리닝_숫자키, _SECTOR_KO, _도메인
from app.services.screening.names_ko import 국내업종_어림, 나라_이름, 산업_이름

#: 거르고 세울 수 있는 숫자 칸 + 묶음 시세로 다시 나눌 때 쓰는 칸
숫자칸 = tuple(sorted(스크리닝_숫자키)) + (
    "high_52w", "low_52w", "dividend_rate", "forward_eps", "scanned_at", "fin_at")
글자칸 = ("name", "name_en", "market", "exchange", "sector", "industry", "country",
         "currency", "fin_currency", "domain")
목록칸 = ("fin_years", "rev_hist", "eps_hist")
#: 화면에 정수로 보내는 칸(예전 줄과 같게)
_정수칸 = frozenset({"volume", "market_cap", "ipo_year"})
#: 원천(부채총계 ÷ 자본총계)을 야후 줄보다 먼저 쓰는 칸
_원천먼저 = frozenset({"debt_ratio"})
#: 4년 흐름 — 해 수와, 원천에서 낸 흐름의 돈(SEC 는 달러로 적은 값만 받고, DART·KRX 는 원이다)
흐름해수 = 4
_흐름돈 = {"US": "USD", "KR": "KRW"}
#: 퀀트(성장 점수)가 쓰는 전년 대비 성장률 — 화면에는 안 보내는 안쪽 칸
성장칸 = ("_rev_yoy", "_ni_yoy", "_op_yoy")
#: 원천의 순이익·영업이익 칸 이름(지난해 값은 끝에 _prev)
_재무칸 = {"US": (("us_sec",), "earnings", "op_income"), "KR": (("kr_dart", "kr_naver"), "net_income", "op_income")}

#: 나스닥 업종(영문) → 한글. 야후 업종은 yf_service._SECTOR_KO — 두 갈래가 한 표에 섞여도
#: 같은 업종은 같은 이름이 되게 맞춘다(안 그러면 고르기 목록에 '금융' 과 '금융서비스' 가 따로 선다)
나스닥업종_한글 = {
    "Technology": "기술", "Telecommunications": "통신서비스", "Health Care": "헬스케어",
    "Finance": "금융", "Real Estate": "부동산", "Consumer Discretionary": "경기소비재",
    "Consumer Staples": "필수소비재", "Industrials": "산업재", "Basic Materials": "소재",
    "Energy": "에너지", "Utilities": "유틸리티", "Miscellaneous": "기타",
}
#: 야후 업종 중 나스닥 이름에 맞춰 부르는 것(종목 상세는 yf_service._SECTOR_KO 그대로)
_야후업종_맞춤 = {"Financial Services": "금융", "Financials": "금융"}


def 업종_한글(업종: object) -> str | None:
    if not isinstance(업종, str) or not 업종.strip():
        return None
    return 나스닥업종_한글.get(업종) or _야후업종_맞춤.get(업종) or _SECTOR_KO.get(업종) or 업종


def _틀(줄들: list[dict]) -> pd.DataFrame:
    """줄 목록 → 종목(symbol)을 열쇠로 한 표. 같은 종목이 둘이면 앞의 것"""
    if not 줄들:
        return pd.DataFrame(index=pd.Index([], name="symbol", dtype=object))
    df = pd.DataFrame.from_records(줄들)
    if "symbol" not in df.columns:
        return pd.DataFrame(index=pd.Index([], name="symbol", dtype=object))
    df = df[df["symbol"].notna()].drop_duplicates("symbol", keep="first")
    return df.set_index("symbol")


def _수(df: pd.DataFrame | None, 칸: str, idx: pd.Index) -> pd.Series | None:
    if df is None or 칸 not in df.columns:
        return None
    return pd.to_numeric(df[칸], errors="coerce").reindex(idx)


def _먼저(idx: pd.Index, *들: "pd.Series | None", 숫자: bool = True) -> pd.Series:
    """앞의 것이 비었을 때만 뒤의 것. 글자 칸은 빈 글자도 빈 것으로 본다"""
    out = pd.Series(np.nan if 숫자 else None, index=idx, dtype=float if 숫자 else object)
    for s in 들:
        if s is None:
            continue
        s = s.reindex(idx)
        if not 숫자:
            s = s.where(s.map(lambda v: isinstance(v, str) and bool(v.strip())), None)
        out = out.where(out.notna(), s)
    return out


def _글자(df: pd.DataFrame | None, 칸: str, idx: pd.Index, 바꿈=None) -> pd.Series | None:
    """글자 칸. 바꿈(번역 따위)은 서로 다른 값마다 한 번만 부른다 — 7천 줄에 업종은 열몇 가지다"""
    if df is None or 칸 not in df.columns:
        return None
    s = df[칸].reindex(idx)
    if not 바꿈:
        return s
    return s.map({v: 바꿈(v) for v in s.dropna().unique()})


def _나눔(위: pd.Series | None, 아래: pd.Series | None, 곱: float = 1.0, 양수만: bool = True):
    """위 ÷ 아래 × 곱. 아래가 0 이하(양수만)거나 모르면 모름"""
    if 위 is None or 아래 is None:
        return None
    아래 = 아래.where(아래 > 0) if 양수만 else 아래.where(아래 != 0)
    return (위 / 아래 * 곱).round(2)


def _목록(v) -> list | None:
    return list(v) if isinstance(v, (list, tuple, np.ndarray)) and len(v) else None


#: 원천 줄의 흐름 목록(해들·값들) → 해마다 숫자 칸('rev@2024') — (해들 칸, 값들 칸, 숫자 칸 머리)
_흐름목록 = {
    "us_sec": (("fin_years", "rev_hist", "rev"), ("fin_years", "eps_hist", "eps")),
    "kr_dart": (("rev_years", "rev_hist", "rev"),),
    "kr_krx": (("eps_years", "eps_hist", "eps"),),
    # 네이버 연간 실적 — DART 키가 없고 KRX 가 로그인을 요구하는 동안 국내 흐름은 여기서 온다
    "kr_naver": (("rev_years", "rev_hist", "rev"), ("eps_years", "eps_hist", "eps")),
}
#: 4년 흐름을 내는 원천 — 시장 → (매출 원천들, EPS 원천들). 앞 원천에 없는 종목·해만 뒤 원천으로
_흐름원천 = {"US": (("us_sec",), ("us_sec",)), "KR": (("kr_dart", "kr_naver"), ("kr_krx", "kr_naver"))}


def 원천표(칸: str, 줄들: dict) -> pd.DataFrame | None:
    """원천 줄들({종목: {칸: 값}}) → 표. 흐름 목록(해들·값들)은 해마다 숫자 칸('rev@2024')으로 편다 —
    종목마다 목록을 들면 7천 줄에 몇 MB 이고, 표를 합칠 때도 줄마다 파이썬으로 돌아 느리다"""
    if not 줄들:
        return None
    펴기 = _흐름목록.get(칸)
    if 펴기:
        펼친: dict[str, dict] = {}
        for sym, 줄 in 줄들.items():
            줄 = dict(줄)
            for 해칸, 값칸, 머리 in 펴기:
                해들, 값들 = _목록(줄.get(해칸)), _목록(줄.pop(값칸, None))
                if 해들 and 값들 and len(해들) == len(값들):
                    for y, v in zip(해들, 값들):
                        if isinstance(v, (int, float)) and math.isfinite(v):
                            줄[f"{머리}@{int(y)}"] = float(v)
            for 해칸, _값칸, _머리 in 펴기:
                줄.pop(해칸, None)
            펼친[sym] = 줄
        줄들 = 펼친
    return pd.DataFrame.from_dict(줄들, orient="index")


def _해마다(df: pd.DataFrame | None, 머리: str, idx: pd.Index) -> dict[int, np.ndarray]:
    """원천 표의 해마다 숫자 칸 → {해: 값 배열(idx 차례, 모르면 NaN)}"""
    if df is None:
        return {}
    return {int(c.split("@", 1)[1]): pd.to_numeric(df[c], errors="coerce").reindex(idx).to_numpy(dtype=float)
            for c in df.columns if isinstance(c, str) and c.startswith(머리 + "@")}


def _국내재무(df: pd.DataFrame | None, idx: pd.Index, 시총: pd.Series, 비율칸: bool = False) -> dict:
    """국내 재무 원천 한 벌(DART · 네이버 연간 실적) → 칸들. 네이버는 ROE·부채비율을 낸 값으로 준다(비율칸)"""
    if df is None:
        return {}
    매출, 순이익, 자본 = _수(df, "revenue", idx), _수(df, "net_income", idx), _수(df, "equity", idx)
    return {
        "revenue": 매출, "earnings": 순이익,
        "operating_margin": _나눔(_수(df, "op_income", idx), 매출, 100),
        "profit_margin": _나눔(순이익, 매출, 100),
        "roe": _수(df, "roe", idx) if 비율칸 else _나눔(순이익, 자본, 100),
        "roa": None if 비율칸 else _나눔(순이익, _수(df, "assets", idx), 100),
        "debt_ratio": _수(df, "debt_ratio", idx) if 비율칸 else _나눔(_수(df, "liabilities", idx), 자본, 100),
        "ps_ratio": _나눔(시총, 매출),
    }


def _해마다_합침(원천: dict, 원들: tuple[str, ...], 머리: str, idx: pd.Index) -> dict[int, np.ndarray]:
    """여러 원천의 해마다 값 — 앞 원천에 없는 종목·해만 뒤 원천으로(DART 에 세 해, 네이버에 네 해면 네 해)"""
    합: dict[int, np.ndarray] = {}
    for 원 in 원들:
        for y, a in _해마다(원천.get(원), 머리, idx).items():
            합[y] = a if y not in 합 else np.where(np.isnan(합[y]), a, 합[y])
    return 합


def 원천_흐름(시장: str, idx: pd.Index, 원천: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """원천에서 낸 4년 흐름 → (끝해[줄], 매출[줄, 4], EPS[줄, 4]). 네 해는 끝해(그 종목에 값이 있는 마지막
    해)에서 거슬러 이어진 해이고 오래된 해부터, 모르면 NaN. 값이 하나도 없는 종목은 끝해가 NaN
      미국  SEC — 매출·EPS 모두 frames 의 네 해
      국내  DART — 사업보고서의 당기·전기·전전기 매출, KRX — 해마다 같은 날 지표의 EPS"""
    n = len(idx)
    빈 = (np.full(n, np.nan), np.full((n, 흐름해수), np.nan), np.full((n, 흐름해수), np.nan))
    if 시장 not in _흐름원천:
        return 빈
    매출원들, eps원들 = _흐름원천[시장]
    매출, eps = _해마다_합침(원천, 매출원들, "rev", idx), _해마다_합침(원천, eps원들, "eps", idx)
    if not 매출 and not eps:
        return 빈
    # 앞에 빈 해를 붙여 둔다 — 어느 종목이든 끝해에서 거슬러 네 칸이 늘 들어간다
    해들 = list(range(min([*매출, *eps]) - 흐름해수 + 1, max([*매출, *eps]) + 1))
    M, E = np.full((n, len(해들)), np.nan), np.full((n, len(해들)), np.nan)
    for j, y in enumerate(해들):
        if y in 매출:
            M[:, j] = 매출[y]
        if y in eps:
            E[:, j] = eps[y]
    있음 = ~(np.isnan(M) & np.isnan(E))
    마지막 = len(해들) - 1 - np.argmax(있음[:, ::-1], axis=1)
    창 = 마지막[:, None] + np.arange(1 - 흐름해수, 1)[None, :]
    끝해 = np.where(있음.any(axis=1), np.asarray(해들, dtype=float)[마지막], np.nan)
    return 끝해, np.take_along_axis(M, 창, axis=1), np.take_along_axis(E, 창, axis=1)


def _연평균(값: np.ndarray) -> np.ndarray:
    """[줄, 4] → 3년 전 → 마지막 해 연평균 성장률(%). 어느 한쪽이라도 없거나 0 이하면 NaN
    (yf_service._연평균성장 과 같은 식)"""
    처음, 끝 = 값[:, 0], 값[:, -1]
    with np.errstate(invalid="ignore", divide="ignore"):
        r = np.round(((끝 / 처음) ** (1 / 3) - 1) * 100, 1)
    return np.where((처음 > 0) & (끝 > 0), r, np.nan)


def _전년대비(지금, 전) -> np.ndarray | None:
    """(지금 − 전) ÷ |전| × 100 — quant_score.collect_quant_metrics 가 재무제표로 내는 성장률과 같은 식"""
    if 지금 is None or 전 is None:
        return None
    지금, 전 = np.asarray(지금, dtype=float), np.asarray(전, dtype=float)
    with np.errstate(invalid="ignore", divide="ignore"):
        v = np.round((지금 - 전) / np.abs(전) * 100, 2)
    return np.where(np.isfinite(v) & (전 != 0), v, np.nan)


def _흐름_엮기(끝: int, r: dict) -> dict:
    """표의 해마다 숫자 칸(_rev0…_eps3) → {fin_years, rev_hist, eps_hist}. 앞쪽의 빈 해만 뺀다
    (가운데를 빼면 '3년 전' 이 4년 전이 된다 — yf_service.연간흐름 과 같다)"""
    def 값(v, 자리):
        if not isinstance(v, (int, float)) or not math.isfinite(v):
            return None
        return int(round(float(v))) if 자리 is None else round(float(v), 자리)
    매출 = [값(r.get(f"_rev{i}"), None) for i in range(흐름해수)]
    eps = [값(r.get(f"_eps{i}"), 2) for i in range(흐름해수)]
    시작 = next((i for i in range(흐름해수) if 매출[i] is not None or eps[i] is not None), None)
    if 시작 is None:
        return {}
    return {"fin_years": list(range(끝 - 흐름해수 + 1 + 시작, 끝 + 1)),
            "rev_hist": 매출[시작:], "eps_hist": eps[시작:]}


def _흐름_달러로(칸들: dict, idx: pd.Index, 환율표: pd.DataFrame | None) -> None:
    """야후 줄의 4년 흐름이 장부 돈(TSMC 대만 달러)이면 지금 환율로 시세 돈(달러)으로 바꾼다 — 사용자: "스크리닝
    TSMC가 대만달러로 나와". 해마다 그해 환율이 아니라 지금 환율로 바꾸므로 성장률은 장부 돈의 성장률 그대로다.
    환율을 모르는 돈은 그대로 둔다(fin_currency 도 장부 돈 그대로 — 화면이 그 돈으로 적는다). 바꾼 줄은 fin_fx 에
    원래 돈을 남긴다(화면 설명)"""
    장부 = 칸들.get("fin_currency")
    if 장부 is None or 환율표 is None or "usd" not in 환율표.columns:
        return
    달러 = pd.to_numeric(환율표["usd"], errors="coerce").to_dict()
    시세 = 칸들.get("currency")
    시세돈 = 시세.reindex(idx).tolist() if 시세 is not None else [None] * len(idx)
    바꿈: dict[str, str] = {}
    for s, 장, 시 in zip(idx, 장부.reindex(idx).tolist(), 시세돈):
        r = 달러.get(장) if isinstance(장, str) and 장 != "USD" else None
        if r is None or not (r > 0) or (isinstance(시, str) and 시 != "USD"):
            continue
        for 칸, 자리 in (("rev_hist", None), ("eps_hist", 2)):
            v = _목록(칸들[칸].get(s)) if 칸 in 칸들 else None
            if v is not None:
                칸들[칸].at[s] = [None if not isinstance(x, (int, float)) or not math.isfinite(x)
                                 else (int(round(x * r)) if 자리 is None else round(x * r, 자리)) for x in v]
                바꿈[s] = 장
    if 바꿈:
        칸들["fin_currency"] = 장부.copy()
        칸들["fin_currency"].loc[list(바꿈)] = "USD"
        칸들["fin_fx"] = pd.Series(바꿈, dtype=object).reindex(idx)
        # 야후의 해마다 EPS 는 원주 1주의 값이다(ADR 1주와 다를 수 있다) — 시세 1주로 맞출 근거가 없어 그대로 두고 적는다
        칸들["eps_basis"] = pd.Series({s: "ordinary" for s in 바꿈}, dtype=object).reindex(idx)


def _원천_흐름_설명(칸들: dict, idx: pd.Index, 원천줄: pd.Series, sec: pd.DataFrame | None,
                 배율: pd.Series | None) -> None:
    """원천(SEC)의 흐름을 쓰는 줄의 설명 칸 — 해외 상장사의 값을 달러로 바꿨으면 원래 돈(fin_fx), EPS 흐름을 시세
    1주로 못 맞췄으면(시가총액·순이익을 몰라) 원주 1주 기준(eps_basis). 야후 흐름에서 온 설명은 지운다"""
    원래돈 = _글자(sec, "fin_fx", idx)
    외국 = _수(sec, "foreign", idx)
    if 원래돈 is not None or "fin_fx" in 칸들:
        있던 = 칸들.get("fin_fx", pd.Series(None, index=idx, dtype=object))
        새것 = 원래돈 if 원래돈 is not None else pd.Series(None, index=idx, dtype=object)
        칸들["fin_fx"] = 있던.astype(object).where(~원천줄, 새것)
    if 외국 is not None or "eps_basis" in 칸들:
        맞춤 = 배율.notna() if 배율 is not None else pd.Series(False, index=idx)
        못맞춤 = 원천줄 & (외국.fillna(0) > 0 if 외국 is not None else False) & ~맞춤
        있던 = 칸들.get("eps_basis", pd.Series(None, index=idx, dtype=object)).astype(object)
        칸들["eps_basis"] = 있던.where(~원천줄, None).where(~못맞춤, "ordinary")


#: 시세 ÷ 장부 EPS 가 시가총액 ÷ 순이익과 이만큼(배) 넘게 어긋나면 그 EPS 는 시세 1주의 것이 아니다
EPS_어긋남 = 3.0

#: 미국에 상장한 국내 회사 ADR 중 SEC 연간 공시(20-F)가 아직 없는 것 → (국내 종목, ADR 1주가 원주 몇 주인가).
#: SK하이닉스는 2026년 7월 나스닥에 상장했다(ADR 10주 = 원주 1주) — 첫 20-F 가 나오면 SEC 값이 먼저다
국내_ADR: dict[str, tuple[str, float]] = {"SKHY": ("000660", 0.1)}
#: 원주 줄에서 그대로 가져오는 칸 — 비율이라 돈 단위·주식 수와 상관없다
_원주_비율칸 = ("per", "forward_per", "pbr", "ps_ratio", "peg_ratio", "ev_ebitda", "roe", "roa", "operating_margin",
            "profit_margin", "dividend_yield", "debt_ratio", "current_ratio", "rev_cagr_3y", "eps_cagr_3y",
            "forward_eps_growth", "_rev_yoy", "_ni_yoy", "_op_yoy")
_원주_돈칸 = ("revenue", "earnings", "fcf", "net_debt")
_원주_주당칸 = ("eps", "forward_eps", "dividend_rate")


def _국내원주로(칸들: dict, idx: pd.Index, 원주줄들: dict, 환율표: pd.DataFrame | None) -> None:
    """국내 회사 ADR(SEC 공시가 아직 없다)의 빈 칸을 국내 원주 줄로 — 사용자: "스크리닝 지표가 아예 안나오는 종목이
    있어(… SK하이닉스 ADR …)". 비율(PER·PBR·ROE …)은 그대로, 원화 금액은 지금 환율로 달러로, 주당 값은 ADR 1주로.
    원화 환율을 모르면 비율만"""
    원화 = None
    if 환율표 is not None and "usd" in 환율표.columns and "KRW" in 환율표.index:
        v = pd.to_numeric(환율표["usd"], errors="coerce").get("KRW")
        원화 = float(v) if v is not None and v == v and v > 0 else None

    def 칸(이름: str, 글: bool = False) -> pd.Series:
        if 이름 not in 칸들:
            칸들[이름] = pd.Series(None if 글 else np.nan, index=idx, dtype=object if 글 else float)
        elif 글:
            칸들[이름] = 칸들[이름].astype(object)
        return 칸들[이름]

    def 넣기(이름: str, 값, 글: bool = False) -> None:
        if 값 is None or (isinstance(값, float) and not math.isfinite(값)):
            return
        s = 칸(이름, 글)
        if pd.isna(s.get(adr)):
            s.at[adr] = 값

    for adr, 줄 in 원주줄들.items():
        if adr not in idx or adr not in 국내_ADR or not 줄:
            continue
        비율 = 국내_ADR[adr][1]
        for 이름 in _원주_비율칸:
            넣기(이름, 줄.get(이름))
        for 이름 in ("sector", "industry"):
            넣기(이름, 줄.get(이름), 글=True)
        if 원화 is None:
            continue
        for 이름 in _원주_돈칸:
            v = 줄.get(이름)
            넣기(이름, None if v is None else round(v * 원화, 2))
        for 이름 in _원주_주당칸:
            v = 줄.get(이름)
            넣기(이름, None if v is None else round(v * 원화 * 비율, 4))
        # 흐름 — 야후·SEC 흐름이 없을 때만
        if _목록(줄.get("fin_years")) and not _목록(칸("fin_years", 글=True).get(adr)) \
                and not (isinstance(칸들.get("_흐름끝"), pd.Series) and pd.notna(칸들["_흐름끝"].get(adr))):
            칸("fin_years", 글=True).at[adr] = list(줄["fin_years"])
            칸("rev_hist", 글=True).at[adr] = [None if x is None else int(round(x * 원화)) for x in 줄.get("rev_hist") or []]
            칸("eps_hist", 글=True).at[adr] = [None if x is None else round(x * 원화 * 비율, 2)
                                             for x in 줄.get("eps_hist") or []]
            칸("fin_currency", 글=True).at[adr] = "USD"
            칸("fin_fx", 글=True).at[adr] = "KRW"


def _시세주_EPS(sec: pd.DataFrame, idx: pd.Index, 가격: pd.Series, 시총: pd.Series,
               순이익: pd.Series | None, eps: pd.Series | None) -> tuple[pd.Series, pd.Series]:
    """시세 1주의 EPS 와, 장부 EPS(흐름)를 거기에 맞출 배율 → (EPS, 배율 — 맞출 필요 없으면 NaN).

    장부 EPS 가 시세 1주의 것이 아닌 회사가 있다 — 사용자: "스크리닝 지표가 아예 안나오는 종목이 있어(알파벳, 버크셔 …)"
      · 알파벳: A·B·C 주마다 따로 적어(SEC frames 에 없다) EPS·PER 이 비었다
      · 버크셔 B: SEC 의 EPS 는 A 주 1주의 값이라 시세(B 주) ÷ EPS 가 0.01 이 된다
      · 해외 상장사(TSMC): 장부 EPS 는 원주 1주의 값인데 시세는 ADR(원주 5주) 1주다
    이런 회사는 순이익 × 시세 ÷ 시가총액(= 시세 1주의 몫)을 쓴다 — PER 은 시가총액 ÷ 순이익과 같아진다.
    시가총액이 회사 전체의 값이라 주식 종류·ADR 비율과 상관없다"""
    n = pd.Series(np.nan, index=idx)
    if 순이익 is None:
        return (eps if eps is not None else n), n
    몫 = (가격 * 순이익 / 시총.where(시총 > 0)).round(4)
    if eps is None:
        return 몫, n
    외국 = _수(sec, "foreign", idx)
    외국 = 외국.fillna(0) > 0 if 외국 is not None else pd.Series(False, index=idx)
    with np.errstate(divide="ignore", invalid="ignore"):
        견줌 = eps / 몫
    # 부호가 다르면(우선주 배당을 떼고 보통주 몫이 적자가 된 회사) 장부 EPS 가 맞다 — 크기만 견준다
    어긋남 = (견줌 > EPS_어긋남) | ((견줌 > 0) & (견줌 < 1 / EPS_어긋남))
    믿음 = eps.notna() & ~외국 & ~어긋남.fillna(False)
    쓸것 = eps.where(믿음, 몫)
    배율 = (몫 / eps).where(~믿음 & 몫.notna() & eps.notna() & (eps != 0) & (np.sign(몫) == np.sign(eps)))
    return 쓸것, 배율


def 원천에서_낸값(시장: str, idx: pd.Index, 가격: pd.Series, 시총: pd.Series, 원천: dict) -> dict:
    """원천(받은 날 기준)에서 지금 가격으로 다시 낸 칸들 → {칸: Series}"""
    낸: dict[str, pd.Series] = {}

    def 둠(칸, *값들):
        s = _먼저(idx, *값들)
        if s.notna().any():
            낸[칸] = s

    if 시장 == "KR":
        krx, 네이버, dart = 원천.get("kr_krx"), 원천.get("kr_naver"), 원천.get("kr_dart")
        깃헙 = 원천.get("kr_git")
        eps = _먼저(idx, _수(krx, "eps", idx), _수(네이버, "eps", idx))
        bps = _먼저(idx, _수(krx, "bps", idx), _수(네이버, "bps", idx))
        dps = _수(krx, "dps", idx)
        선행eps = _수(네이버, "forward_eps", idx)
        # DART 의 순이익·자본으로 낸 PER·PBR 은 마지막 갈래 — 비지배지분까지 든 값이라 어림이다
        순이익d, 자본d = _수(dart, "net_income", idx), _수(dart, "equity", idx)
        둠("eps", eps)
        둠("per", _나눔(가격, eps), _수(krx, "per", idx), _수(네이버, "per", idx), _나눔(시총, 순이익d))
        둠("pbr", _나눔(가격, bps), _수(krx, "pbr", idx), _수(네이버, "pbr", idx), _나눔(시총, 자본d))
        둠("dividend_rate", dps)
        둠("dividend_yield", _나눔(dps, 가격, 100, 양수만=False) if dps is not None else None,
           _수(krx, "dividend_yield", idx), _수(네이버, "dividend_yield", idx))
        둠("forward_eps", 선행eps)
        둠("forward_per", _나눔(가격, 선행eps), _수(네이버, "forward_per", idx))
        if 선행eps is not None:
            둠("forward_eps_growth", ((선행eps / eps.where(eps > 0) - 1) * 100).round(1))
        # 1년 시세(야후 .KS·.KQ) — 주요 종목 밖의 1년 수익률·RSI, 네이버가 아직 안 준 52주 고저
        시세 = 원천.get("kr_px")
        for 칸 in ("return_1m", "return_3m", "return_1y"):
            둠(칸, _수(krx, 칸, idx), _수(깃헙, 칸, idx), _수(시세, 칸, idx))
        둠("rsi", _수(시세, "rsi", idx))
        고점 = _먼저(idx, _수(네이버, "high_52w", idx), _수(시세, "high_52w", idx))
        저점 = _먼저(idx, _수(네이버, "low_52w", idx), _수(시세, "low_52w", idx))
        둠("high_52w", 고점)
        둠("low_52w", 저점)
        둠("pct_from_52w_high", ((가격 / 고점.where(고점 > 0) - 1) * 100).round(2))
        둠("pct_from_52w_low", ((가격 / 저점.where(저점 > 0) - 1) * 100).round(2))
        # 재무 — DART(연결 재무제표) → 네이버 연간 실적(DART 키가 없을 때 국내 재무는 여기서만 온다). 칸마다 한
        # 원천의 값끼리 낸다(DART 매출 ÷ 네이버 영업이익 처럼 섞지 않는다)
        재무들 = [_국내재무(dart, idx, 시총), _국내재무(네이버, idx, 시총, 비율칸=True)]
        for 칸 in ("revenue", "earnings", "operating_margin", "profit_margin", "roe", "roa", "debt_ratio", "ps_ratio"):
            둠(칸, *(재무.get(칸) for 재무 in 재무들))
    elif 시장 == "US":
        sec = 원천.get("us_sec")
        if sec is not None:
            매출, 순이익 = _수(sec, "revenue", idx), _수(sec, "earnings", idx)
            자본, eps, dps = _수(sec, "equity", idx), _수(sec, "eps", idx), _수(sec, "dps", idx)
            시세eps, 배율 = _시세주_EPS(sec, idx, 가격, 시총, 순이익, eps)
            둠("revenue", 매출)
            둠("earnings", 순이익)
            둠("eps", 시세eps)
            둠("per", _나눔(가격, 시세eps))
            if 배율.notna().any():
                낸["_eps배율"] = 배율
            둠("pbr", _나눔(시총, 자본))
            둠("ps_ratio", _나눔(시총, 매출))
            둠("roe", _나눔(순이익, 자본, 100))
            둠("roa", _나눔(순이익, _수(sec, "assets", idx), 100))
            둠("operating_margin", _나눔(_수(sec, "op_income", idx), 매출, 100))
            둠("profit_margin", _나눔(순이익, 매출, 100))
            둠("debt_ratio", _나눔(_수(sec, "liabilities", idx), 자본, 100))
            둠("dividend_rate", dps)
            if dps is not None:
                둠("dividend_yield", _나눔(dps, 가격, 100, 양수만=False))
            현금, 설비 = _수(sec, "ocf", idx), _수(sec, "capex", idx)
            if 현금 is not None and 설비 is not None:
                둠("fcf", 현금 - 설비)
        # 1년 시세(야후 spark) — 주요 종목 밖의 52주 고저·수익률·RSI
        시세 = 원천.get("us_px")
        if 시세 is not None:
            고점, 저점 = _수(시세, "high_52w", idx), _수(시세, "low_52w", idx)
            둠("high_52w", 고점)
            둠("low_52w", 저점)
            if 고점 is not None:
                둠("pct_from_52w_high", ((가격 / 고점.where(고점 > 0) - 1) * 100).round(2))
            if 저점 is not None:
                둠("pct_from_52w_low", ((가격 / 저점.where(저점 > 0) - 1) * 100).round(2))
            for 칸 in ("return_1m", "return_3m", "return_1y", "rsi"):
                둠(칸, _수(시세, 칸, idx))
    return 낸


class 스크리닝표:
    """한 시장의 전 종목 표. 만든 뒤에는 바꾸지 않는다 — 새로 만들어 갈아 끼운다"""

    def __init__(self, df: pd.DataFrame, 기초수: int = 0, 만든때: float | None = None):
        self.df = df
        self.기초수 = 기초수
        self.만든때 = 만든때 or time.time()
        self._고를값 = None

    def __len__(self) -> int:
        return len(self.df)

    def 고를값들(self) -> dict:
        """국가·섹터·산업·거래소 조건에 내놓을 값들 — 그 시장 전체에 실제로 있는 것만, 가나다(ABC)순"""
        if self._고를값 is None:
            self._고를값 = {
                k: (sorted({v for v in self.df[k].tolist() if isinstance(v, str) and v})
                    if k in self.df.columns else [])
                for k in ("country", "sector", "industry", "exchange")}
        return self._고를값

    def _거름(self, filters: dict, q: str) -> np.ndarray:
        df = self.df
        고름 = np.ones(len(df), dtype=bool)
        for 칸, 조건 in (filters or {}).items():
            if 칸 not in df.columns:
                return np.zeros(len(df), dtype=bool)        # 모르는 값 — 아무도 못 지난다
            값 = df[칸]
            if "eq" in 조건:
                # 업종·나라는 한글로 바꿔 담는다 — 예전에 영문('Technology')으로 저장해 둔 보기도
                # 같은 번역을 거쳐 맞춘다(안 그러면 저장한 보기가 조용히 0개가 된다)
                바꿈 = {"sector": 업종_한글, "country": 나라_이름, "industry": 산업_이름}.get(칸)
                목표 = 바꿈(조건["eq"]) if 바꿈 else 조건["eq"]
                고름 &= (값 == 목표).to_numpy(dtype=bool)
                continue
            수 = pd.to_numeric(값, errors="coerce").to_numpy(dtype=float)
            맞음 = ~np.isnan(수)                             # 값이 없으면 조건을 통과시키지 않는다
            if "min" in 조건:
                맞음 &= 수 >= 조건["min"]
            if "max" in 조건:
                맞음 &= 수 <= 조건["max"]
            고름 &= 맞음
        말들 = [m for m in (re.sub(r"\s+", "", 조각).lower() for 조각 in re.split(r"[,，]", q or "")) if m]
        if 말들 and "_찾기" in df.columns:
            글 = df["_찾기"]
            맞음 = np.zeros(len(df), dtype=bool)
            for m in 말들:
                맞음 |= 글.str.contains(m, regex=False).to_numpy(dtype=bool)
            고름 &= 맞음
        return 고름

    def 한줄(self, 종목: str) -> dict | None:
        """한 종목의 줄(화면에 보내는 꼴) + 퀀트가 쓰는 전년 대비 성장률(성장칸). 없으면 None"""
        if 종목 not in self.df.index:
            return None
        r = {"symbol": 종목, **self.df.loc[종목].to_dict()}
        줄 = _줄(r)
        for k in 성장칸:
            v = r.get(k)
            if isinstance(v, (int, float)) and math.isfinite(v):
                줄[k] = float(v)
        return 줄

    def 결과(self, filters: dict, q: str, 세울칸: str, 내림: bool, 앞: int, 몇: int) -> tuple[list[dict], int]:
        """거르고 세운 뒤 앞(offset)부터 몇(limit) 줄. 값 없는 종목은 오름·내림 어느 쪽이든 맨 뒤
        (예전엔 없는 값을 0 으로 쳐서, PER 낮은 순이면 PER 모르는 적자 기업이 1등부터 깔렸다)"""
        고름 = self._거름(filters, q)
        자리 = np.flatnonzero(고름)
        if 세울칸 in self.df.columns and len(자리):
            값 = pd.to_numeric(self.df[세울칸], errors="coerce").to_numpy(dtype=float)[자리]
            있음 = ~np.isnan(값)
            순서 = np.argsort(-값[있음] if 내림 else 값[있음], kind="stable")
            자리 = np.concatenate([자리[있음][순서], 자리[~있음]])
        쪽 = self.df.iloc[자리[앞:앞 + 몇]].reset_index()
        return [_줄(r) for r in 쪽.to_dict("records")], len(자리)


def _줄(r: dict) -> dict:
    out = {}
    끝 = r.get("_흐름끝")
    if isinstance(끝, float) and math.isfinite(끝):
        out.update(_흐름_엮기(int(끝), r))
    for k, v in r.items():
        if k.startswith("_") or v is None:
            continue
        if isinstance(v, float):
            if not math.isfinite(v):
                continue
            if k in _정수칸:
                v = int(round(v))
        elif isinstance(v, (np.floating, np.integer)):
            v = v.item()
            if isinstance(v, float) and not math.isfinite(v):
                continue
        out[k] = v
    return out


def 만들기(시장: str, 기초: list[dict], 풍부: list[dict], 원천: dict | None = None) -> 스크리닝표:
    """기초 줄(전 종목) ∪ 종목별 야후 줄 → 한 시장의 표. 원천은 service 가 들고 있는 것
    ({"kr_krx": DataFrame, "kr_naver": …, "kr_dart": …, "us_sec": …})"""
    원천 = 원천 or {}
    기, 풍 = _틀(기초), _틀(풍부)
    idx = 기.index.union(풍.index, sort=False)
    if not len(idx):
        return 스크리닝표(pd.DataFrame(columns=["symbol"]), 0)
    칸들: dict[str, pd.Series] = {}

    for 칸 in ("price", "change_rate", "volume", "market_cap"):
        칸들[칸] = _먼저(idx, _수(풍, 칸, idx), _수(기, 칸, idx))
    가격, 시총 = 칸들["price"], 칸들["market_cap"]
    # 상장한 해(나스닥) — 화면이 새로 상장한 종목에 '첫 연간 공시 전' 을 알린다(재무 칸이 비는 까닭)
    if (상장해 := _수(기, "ipo_year", idx)) is not None and 상장해.notna().any():
        칸들["ipo_year"] = 상장해
    낸 = 원천에서_낸값(시장, idx, 가격, 시총, 원천)
    # 4년 흐름 — 야후 줄에 흐름이 있으면 그 한 벌, 없으면 원천의 한 벌. 원천의 것은 해마다 숫자 칸으로
    # 들고, 화면에 보낼 줄에서만 목록으로 엮는다(_줄)
    끝해, 흐름매출, 흐름eps = 원천_흐름(시장, idx, 원천)
    # 장부 EPS 가 시세 1주의 것이 아닌 회사(ADR·다른 종류 주식)는 흐름도 시세 1주로 맞춘다(성장률은 그대로다)
    배율 = 낸.pop("_eps배율", None)
    if 배율 is not None:
        흐름eps = 흐름eps * np.where(np.isfinite(배율.to_numpy(dtype=float)), 배율.to_numpy(dtype=float), 1.0)[:, None]
    야후흐름 = (풍["fin_years"].reindex(idx).map(lambda v: _목록(v) is not None).to_numpy(dtype=bool)
              if "fin_years" in 풍.columns else np.zeros(len(idx), dtype=bool))
    if 시장 == "US" and "fin_currency" in 풍.columns:
        # 장부 돈이 달러가 아닌 회사(TSMC)는 원천(SEC — 달러로 바꾸고 ADR 1주로 맞춘 것)의 흐름이 있으면 그것을 쓴다
        해외야후 = 풍["fin_currency"].reindex(idx).map(lambda v: isinstance(v, str) and v != "USD")
        야후흐름 &= ~(해외야후.to_numpy(dtype=bool) & ~np.isnan(끝해))
    원천씀 = ~np.isnan(끝해) & ~야후흐름
    if 원천씀.any():
        낸["rev_cagr_3y"] = pd.Series(np.where(원천씀, _연평균(흐름매출), np.nan), index=idx)
        낸["eps_cagr_3y"] = pd.Series(np.where(원천씀, _연평균(흐름eps), np.nan), index=idx)
    for 칸 in 숫자칸:
        if 칸 in 칸들:
            continue
        풍값 = _수(풍, 칸, idx)
        값 = _먼저(idx, 낸.get(칸), 풍값) if 칸 in _원천먼저 else _먼저(idx, 풍값, 낸.get(칸))
        if 값.notna().any():
            칸들[칸] = 값

    국내 = 시장 == "KR"
    for 칸 in 글자칸:
        if 칸 == "sector":
            # 국내는 KRX 업종('전기·전자') 갈래만 — 야후 업종('기술')과 갈래가 달라 섞으면 고르기 목록에 같은
            # 업종이 두 이름으로 나뉜다. KRX 가 막히면(로그인) 표준산업분류로 어림한 같은 이름의 업종.
            # 둘 다 없을 때만 야후 것
            값 = _먼저(idx, _글자(원천.get("kr_krx"), "sector", idx) if 국내 else None,
                     _글자(원천.get("kr_git"), "industry", idx, 국내업종_어림) if 국내 else None, 숫자=False)
            if not 값.notna().any():
                값 = _먼저(idx, _글자(기, 칸, idx, 업종_한글), _글자(풍, 칸, idx, 업종_한글), 숫자=False)
        elif 칸 == "industry":
            # 국내는 표준산업분류(한국어), 미국은 나스닥 분류 → 야후 — 영문은 모두 한국어로
            값 = _먼저(idx, _글자(원천.get("kr_git"), "industry", idx) if 국내 else None,
                     _글자(기, 칸, idx, 산업_이름), _글자(풍, 칸, idx, 산업_이름), 숫자=False)
        elif 칸 == "country":
            값 = _먼저(idx, _글자(기, 칸, idx, 나라_이름), _글자(풍, 칸, idx, 나라_이름), 숫자=False)
        elif 칸 == "domain":
            # 로고 — 국내는 KRX 기업 상세의 누리집(GitHub)으로 전 종목에
            값 = _먼저(idx, _글자(기, 칸, idx), _글자(풍, 칸, idx),
                     _글자(원천.get("kr_git"), "homepage", idx, _도메인) if 국내 else None, 숫자=False)
        elif 칸 == "name_en":
            # 영문 이름은 찾기에만 쓴다 — 야후 줄의 이름은 영문이다('samsung' 으로도 찾게). 야후 상세가
            # 막히면 이름 자리에 종목 코드가 오는데, 그건 영문 이름이 아니다
            야후이름 = _글자(풍, "name", idx)
            if 야후이름 is not None:
                야후이름 = 야후이름.where(야후이름 != idx.to_series(index=idx))
            값 = _먼저(idx, _글자(기, 칸, idx), _글자(풍, 칸, idx), 야후이름, 숫자=False)
        else:
            값 = _먼저(idx, _글자(기, 칸, idx), _글자(풍, 칸, idx), 숫자=False)
        if 값.notna().any():
            칸들[칸] = 값
    칸들.setdefault("market", pd.Series(시장, index=idx, dtype=object))
    for 칸 in 목록칸:
        if 칸 in 풍.columns:
            # 원천의 흐름을 쓰는 줄에는 야후 흐름을 두지 않는다(_줄 이 원천 흐름 위에 덮어쓴다)
            칸들[칸] = 풍[칸].reindex(idx).where(~pd.Series(원천씀, index=idx), None)
    if 시장 == "US":
        _흐름_달러로(칸들, idx, 원천.get("us_fx"))
    # 전년 대비 성장률(퀀트) — 매출은 원천의 흐름(마지막 두 해), 순이익·영업이익은 원천의 지난해 값. 국내는 DART 에
    # 없는 종목을 네이버 연간 실적으로(그해·지난해를 한 원천에서 — 원천끼리 섞으면 해가 어긋난다)
    재무원들, 순칸, 영칸 = _재무칸.get(시장, ((), None, None))

    def 전년(칸: str) -> np.ndarray | None:
        값 = None
        for 원 in 재무원들:
            재무 = 원천.get(원)
            if 재무 is None:
                continue
            v = _전년대비(_수(재무, 칸, idx), _수(재무, f"{칸}_prev", idx))
            if v is not None:
                값 = v if 값 is None else np.where(np.isnan(값), v, 값)
        return 값
    for 칸, 값 in (("_rev_yoy", _전년대비(흐름매출[:, -1], 흐름매출[:, -2])),
                  ("_ni_yoy", 전년(순칸) if 순칸 else None), ("_op_yoy", 전년(영칸) if 영칸 else None)):
        if 값 is not None and np.isfinite(값).any():
            칸들[칸] = pd.Series(값, index=idx)
    if 원천씀.any():
        칸들["_흐름끝"] = pd.Series(np.where(원천씀, 끝해, np.nan), index=idx)
        for i in range(흐름해수):
            칸들[f"_rev{i}"] = pd.Series(np.where(원천씀, 흐름매출[:, i], np.nan), index=idx)
            칸들[f"_eps{i}"] = pd.Series(np.where(원천씀, 흐름eps[:, i], np.nan), index=idx)
        # 흐름의 돈은 그 흐름을 낸 곳의 돈이다(화면이 막대 설명에 쓴다)
        원천줄 = pd.Series(원천씀, index=idx)
        장부돈 = 칸들.get("fin_currency", pd.Series(None, index=idx, dtype=object))
        칸들["fin_currency"] = 장부돈.where(~원천줄, _흐름돈.get(시장))
        if 시장 == "US":
            _원천_흐름_설명(칸들, idx, 원천줄, 원천.get("us_sec"), 배율)
    if 시장 == "US" and 원천.get("kr_adr"):
        _국내원주로(칸들, idx, 원천["kr_adr"], 원천.get("us_fx"))

    df = pd.DataFrame(칸들, index=idx)
    df.index.name = "symbol"
    # 찾기 — 티커·이름(한글)·영문 이름. 띄어쓰기·대소문자는 가리지 않는다('bank of' → Bank of America)
    찾기 = df.index.to_series().astype(str)
    for 칸 in ("name", "name_en"):
        if 칸 in df.columns:
            찾기 = 찾기 + "|" + df[칸].fillna("").astype(str)
    df["_찾기"] = 찾기.str.replace(r"\s+", "", regex=True).str.lower()
    # 같은 글자가 수천 번 되풀이되는 칸은 범주형으로 — 글자를 한 벌만 든다(1만 줄에서 몇 MB)
    for 칸 in ("market", "exchange", "sector", "industry", "country", "currency", "fin_currency"):
        if 칸 in df.columns:
            df[칸] = df[칸].astype("category")
    # 기본 차례 — 시가총액 큰 것부터(같은 값끼리 세울 때 이 차례를 지킨다)
    if "market_cap" in df.columns:
        df = df.iloc[np.argsort(-df["market_cap"].fillna(-np.inf).to_numpy(), kind="stable")]
    return 스크리닝표(df, 기초수=len(기))
