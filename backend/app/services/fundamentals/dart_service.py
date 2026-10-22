"""
OpenDART API — 국내 기업 공시/재무제표
https://opendart.fss.or.kr — 무료
"""
import httpx
from app.core.http import SSL
import zipfile
import io
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from app.core.config import settings
from app.core.cache import cache
from app.db.database import SessionLocal
from app.models.stock import DisclosuresCache, DartCorpMapCache
from app.core.cpu import io_worker_count

BASE = "https://opendart.fss.or.kr/api"


# 재무제표 계정과목 코드
ACCOUNT_CODES = {
    "revenue":    ["ifrs-full_Revenue", "dart_Revenue"],
    "op_income":  ["ifrs-full_ProfitLossFromOperatingActivities", "dart_OperatingIncomeLoss"],
    "net_income": ["ifrs-full_ProfitLoss", "dart_ProfitLoss"],
    "assets":     ["ifrs-full_Assets"],
    "equity":     ["ifrs-full_Equity"],
    "liabilities":["ifrs-full_Liabilities"],
}


def _db_get_corp_map(max_age_h: float) -> dict | None:
    """Render 재시작 등으로 메모리 캐시가 비워졌을 때 DB에서 corp_map 복구
    (매번 수 MB ZIP을 재다운로드하지 않도록)"""
    db = SessionLocal()
    try:
        row = db.query(DartCorpMapCache).filter(DartCorpMapCache.id == 1).first()
        if not row or not row.data:
            return None
        if row.fetched_at and (datetime.utcnow() - row.fetched_at) > timedelta(hours=max_age_h):
            return None
        return row.data
    except Exception:
        return None
    finally:
        db.close()


def _db_set_corp_map(data: dict):
    if not data:
        return
    db = SessionLocal()
    try:
        row = db.query(DartCorpMapCache).filter(DartCorpMapCache.id == 1).first()
        if row:
            row.data = data
            row.fetched_at = datetime.utcnow()
        else:
            db.add(DartCorpMapCache(id=1, data=data, fetched_at=datetime.utcnow()))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _db_get_disclosures(symbol: str, max_age_h: float) -> list | None:
    db = SessionLocal()
    try:
        row = db.query(DisclosuresCache).filter(DisclosuresCache.symbol == symbol).first()
        if not row or row.data is None:
            return None
        if row.fetched_at and (datetime.utcnow() - row.fetched_at) > timedelta(hours=max_age_h):
            return None
        return row.data
    except Exception:
        return None
    finally:
        db.close()


def _db_set_disclosures(symbol: str, data: list):
    if data is None:
        return
    db = SessionLocal()
    try:
        row = db.query(DisclosuresCache).filter(DisclosuresCache.symbol == symbol).first()
        if row:
            row.data = data
            row.fetched_at = datetime.utcnow()
        else:
            db.add(DisclosuresCache(symbol=symbol, data=data, fetched_at=datetime.utcnow()))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


class DARTService:
    @property
    def _configured(self) -> bool:
        return bool(settings.DART_API_KEY)

    def _get(self, endpoint: str, params: dict) -> dict:
        params["crtfc_key"] = settings.DART_API_KEY
        try:
            r = httpx.get(f"{BASE}/{endpoint}", params=params, timeout=15, verify=SSL)
            return r.json()
        except Exception:
            return {"status": "999"}

    # ── 종목코드 → corp_code 매핑 ─────────────────────
    def get_corp_code(self, stock_code: str) -> str | None:
        """6자리 종목코드 → DART corp_code"""
        ck = f"dart:corp:{stock_code}"
        if c := cache.get(ck):
            return c

        # 전체 기업코드 파일 다운로드 (최초 1회) — 메모리 캐시 없으면 DB → 없으면 재다운로드
        corp_map = cache.get_stale("dart:corp_map")
        if not corp_map:
            corp_map = _db_get_corp_map(max_age_h=720)  # 30일까지 재사용
            if corp_map:
                cache.set("dart:corp_map", corp_map, 86400)  # DB에서 복구한 경우 메모리에도 채워둠
        if not corp_map:
            corp_map = self._load_corp_map()
            if corp_map:
                cache.set("dart:corp_map", corp_map, 86400)  # 24시간
                _db_set_corp_map(corp_map)

        if not corp_map:
            return None

        code = corp_map.get(stock_code)
        if code:
            cache.set(ck, code, 86400)
        return code

    def _load_corp_map(self) -> dict:
        """DART 전체 기업코드 XML 다운로드 후 파싱"""
        if not self._configured:
            return {}
        try:
            r = httpx.get(
                f"{BASE}/corpCode.xml",
                params={"crtfc_key": settings.DART_API_KEY},
                timeout=30, verify=SSL,
            )
            with zipfile.ZipFile(io.BytesIO(r.content)) as z:
                with z.open("CORPCODE.xml") as f:
                    tree = ET.parse(f)
            corp_map = {}
            for item in tree.getroot().findall("list"):
                stock_code = item.findtext("stock_code", "").strip()
                corp_code  = item.findtext("corp_code", "").strip()
                if stock_code and len(stock_code) == 6:
                    corp_map[stock_code] = corp_code
            return corp_map
        except Exception:
            return {}

    # ── 재무제표 조회 ──────────────────────────────────
    def get_financials(self, stock_code: str, years: int = 5) -> dict:
        """연간/분기 재무제표 (매출, 영업이익, 당기순이익)"""
        if not self._configured:
            return {"annual": [], "quarterly": []}

        # 6자리로 정규화 (005930.KS → 005930)
        code6 = stock_code.replace(".KS", "").replace(".KQ", "")

        ck = f"dart:fin:{code6}"
        if c := cache.get(ck):
            return c

        corp_code = self.get_corp_code(code6)
        if not corp_code:
            return {"annual": [], "quarterly": []}

        current_year = datetime.now().year
        annual_jobs = [(str(y), "11011") for y in range(current_year, current_year - years, -1)]
        quarterly_jobs = [
            (str(y), rt)
            for y in [current_year, current_year - 1]
            for rt, label in [("11012", f"{y}H1"), ("11013", f"{y}Q1"), ("11014", f"{y}Q3")]
        ]

        # 연간/분기 조회를 동시 실행 (순차 13회 → 병렬)
        with ThreadPoolExecutor(max_workers=io_worker_count(default=8)) as ex:
            annual_futs = [ex.submit(self._fetch_single, corp_code, y, rt) for y, rt in annual_jobs]
            quarterly_futs = [ex.submit(self._fetch_single, corp_code, y, rt) for y, rt in quarterly_jobs]
            annual_rows = [f.result() for f in annual_futs]
            quarterly_rows = [f.result() for f in quarterly_futs]
        annual_rows = [r for r in annual_rows if r]
        quarterly_rows = [r for r in quarterly_rows if r]

        result = {
            "annual":    sorted(annual_rows,    key=lambda x: x["period"])[-5:],
            "quarterly": sorted(quarterly_rows, key=lambda x: x["period"])[-8:],
        }
        cache.set(ck, result, 3600)
        return result

    def _fetch_single(self, corp_code: str, year: str, report_type: str) -> dict | None:
        d = self._get("fnlttSinglAcnt.json", {
            "corp_code": corp_code,
            "bsns_year": year,
            "reprt_code": report_type,
            "fs_div": "CFS",  # 연결재무제표 우선
        })
        if d.get("status") != "000":
            # 연결 없으면 별도 재무제표
            d = self._get("fnlttSinglAcnt.json", {
                "corp_code": corp_code,
                "bsns_year": year,
                "reprt_code": report_type,
                "fs_div": "OFS",
            })
        if d.get("status") != "000":
            return None

        acc_map: dict[str, int] = {}
        for item in d.get("list", []):
            acc_id  = item.get("account_id", "")
            thstrm  = item.get("thstrm_amount", "").replace(",", "").strip()
            try:
                acc_map[acc_id] = int(thstrm)
            except ValueError:
                pass

        def find_value(keys: list[str]) -> int | None:
            for k in keys:
                if k in acc_map:
                    return acc_map[k]
            return None

        revenue     = find_value(ACCOUNT_CODES["revenue"])
        op_income   = find_value(ACCOUNT_CODES["op_income"])
        net_income  = find_value(ACCOUNT_CODES["net_income"])
        assets      = find_value(ACCOUNT_CODES["assets"])
        equity      = find_value(ACCOUNT_CODES["equity"])
        liabilities = find_value(ACCOUNT_CODES["liabilities"])

        if revenue is None and op_income is None:
            return None

        label_map = {
            "11011": f"{year}", "11012": f"{year}H1",
            "11013": f"{year}Q1", "11014": f"{year}Q3",
        }
        row = {
            "period":       label_map.get(report_type, year),
            "revenue":      revenue,
            "op_income":    op_income,
            "net_income":   net_income,
            "total_assets": assets,
            "total_equity": equity,
        }
        if revenue:
            if op_income is not None:
                row["op_margin"] = round(op_income / revenue * 100, 2)
            if net_income is not None:
                row["net_margin"] = round(net_income / revenue * 100, 2)
        if equity:
            if liabilities is not None:
                row["debt_ratio"] = round(liabilities / equity * 100, 2)
            if net_income is not None:
                row["roe"] = round(net_income / equity * 100, 2)
        if assets and net_income is not None:
            row["roa"] = round(net_income / assets * 100, 2)
        return row

    # ── 공시 목록 ──────────────────────────────────────
    def get_disclosures(self, stock_code: str, page_count: int = 10) -> list:
        if not self._configured:
            return []
        code6 = stock_code.replace(".KS","").replace(".KQ","")
        ck = f"dart:disc:{code6}"
        if c := cache.get(ck):
            return c

        # DB fresh(1시간) → 외부 API → DB stale(30일, API 실패 시 폴백)
        db_fresh = _db_get_disclosures(code6, max_age_h=1)
        if db_fresh is not None:
            cache.set(ck, db_fresh, 1800)
            return db_fresh

        corp_code = self.get_corp_code(code6)
        if not corp_code:
            return _db_get_disclosures(code6, max_age_h=720) or []
        end_de = datetime.now().strftime("%Y%m%d")
        bgn_de = (datetime.now() - timedelta(days=365)).strftime("%Y%m%d")
        d = self._get("list.json", {
            "corp_code": corp_code, "page_count": page_count,
            "bgn_de": bgn_de, "end_de": end_de,
        })
        items = d.get("list", [])
        if not items and d.get("status") != "000":
            # API 실패(상태코드 비정상) — DB에 남은 직전 데이터로 폴백 (30일까지)
            stale = _db_get_disclosures(code6, max_age_h=720)
            if stale is not None:
                return stale
        result = [
            {
                "title":    item.get("report_nm"),
                "date":     item.get("rcept_dt"),
                "reporter": item.get("flr_nm"),
                "url":      f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={item.get('rcept_no')}",
            }
            for item in items
        ]
        cache.set(ck, result, 1800)
        _db_set_disclosures(code6, result)
        return result

    # ── 여러 회사의 주요계정 한꺼번에 (스크리닝) ───────────
    def get_main_accounts_multi(self, stock_codes: list[str], year: str) -> dict[str, dict]:
        """여러 회사의 그해 사업보고서 주요계정 → {6자리 코드: {revenue, op_income, net_income,
        assets, liabilities, equity}}. 다중회사 주요계정(fnlttMultiAcnt)은 한 번에 100곳까지 —
        국내 상장사 전부가 서른 번 남짓이다. 연결(CFS)이 있으면 연결, 없으면 별도(OFS)."""
        if not self._configured:
            return {}
        corp = {c: self.get_corp_code(c) for c in stock_codes}
        corp = {c: v for c, v in corp.items() if v}
        코드들 = list(corp.values())
        out: dict[str, dict] = {}
        for i in range(0, len(코드들), 100):
            d = self._get("fnlttMultiAcnt.json", {
                "corp_code": ",".join(코드들[i:i + 100]), "bsns_year": year, "reprt_code": "11011"})
            if d.get("status") != "000":
                continue
            out.update(주요계정_읽기(d.get("list") or []))
        return out


def _계정칸(이름: str) -> str | None:
    """주요계정의 계정 이름 → 칸. 회사마다 조금씩 다르게 적는다 — '수익(매출액)', '당기순이익(손실)'.
    '법인세차감전 순이익' 은 순이익이 아니다"""
    이름 = 이름.replace(" ", "")
    if "매출액" in 이름 or 이름 in ("수익", "영업수익", "매출"):
        return "revenue"
    if 이름.startswith("영업이익"):
        return "op_income"
    if 이름.startswith("당기순이익"):
        return "net_income"
    return {"자산총계": "assets", "부채총계": "liabilities", "자본총계": "equity"}.get(이름)


def _금액(v) -> float | None:
    try:
        return float(str(v or "").replace(",", "").strip())
    except ValueError:
        return None


def 주요계정_읽기(줄들: list) -> dict[str, dict]:
    """fnlttMultiAcnt 의 list → {6자리 코드: {칸: 금액, rev_years, rev_hist, op_income_prev, net_income_prev}}.
    연결(CFS)을 별도(OFS)보다 먼저 쓴다. 매출은 사업보고서에 함께 적힌 전기·전전기까지 — 스크리닝의 매출 흐름
    (오래된 해부터)이다. 영업이익·순이익은 전기 값도 — 퀀트의 성장 점수다"""
    모음: dict[str, dict[str, dict]] = {}
    for z in 줄들:
        if not isinstance(z, dict):
            continue
        code = str(z.get("stock_code") or "").strip()
        칸 = _계정칸(str(z.get("account_nm") or ""))
        값 = _금액(z.get("thstrm_amount"))
        if len(code) != 6 or not 칸 or 값 is None:
            continue
        갈래 = 모음.setdefault(code, {}).setdefault(str(z.get("fs_div") or "OFS"), {})
        갈래[칸] = 값
        해 = str(z.get("bsns_year") or "").strip()
        if 칸 == "revenue" and 해.isdigit():
            갈래["rev_years"] = [int(해) - 2, int(해) - 1, int(해)]
            갈래["rev_hist"] = [_금액(z.get("bfefrmtrm_amount")), _금액(z.get("frmtrm_amount")), 값]
        elif 칸 in ("op_income", "net_income") and (전기 := _금액(z.get("frmtrm_amount"))) is not None:
            갈래[f"{칸}_prev"] = 전기                       # 퀀트 성장 점수(전년 대비)
    return {code: 갈래.get("CFS") or 갈래.get("OFS") or {} for code, 갈래 in 모음.items()}


dart_service = DARTService()
