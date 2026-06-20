"""
OpenDART API — 국내 기업 공시/재무제표
https://opendart.fss.or.kr — 무료
"""
import httpx
import zipfile
import io
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta
from app.core.config import settings
from app.core.cache import cache
from app.db.database import SessionLocal
from app.models.stock import DisclosuresCache, DartCorpMapCache

BASE = "https://opendart.fss.or.kr/api"

REPORT_TYPES = {
    "11011": "사업보고서 (연간)",
    "11012": "반기보고서",
    "11013": "1분기보고서",
    "11014": "3분기보고서",
}

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
            r = httpx.get(f"{BASE}/{endpoint}", params=params, timeout=15)
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
                timeout=30,
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
        annual_rows, quarterly_rows = [], []

        # 최근 5개년 연간
        for y in range(current_year, current_year - years, -1):
            row = self._fetch_single(corp_code, str(y), "11011")
            if row:
                annual_rows.append(row)

        # 최근 4개 분기
        for y in [current_year, current_year - 1]:
            for rt, label in [("11012", f"{y}H1"), ("11013", f"{y}Q1"), ("11014", f"{y}Q3")]:
                row = self._fetch_single(corp_code, str(y), rt)
                if row:
                    quarterly_rows.append(row)
                if len(quarterly_rows) >= 8:
                    break

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

        revenue    = find_value(ACCOUNT_CODES["revenue"])
        op_income  = find_value(ACCOUNT_CODES["op_income"])
        net_income = find_value(ACCOUNT_CODES["net_income"])

        if revenue is None and op_income is None:
            return None

        label_map = {
            "11011": f"{year}", "11012": f"{year}H1",
            "11013": f"{year}Q1", "11014": f"{year}Q3",
        }
        return {
            "period":     label_map.get(report_type, year),
            "revenue":    revenue,
            "op_income":  op_income,
            "net_income": net_income,
        }

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


dart_service = DARTService()
