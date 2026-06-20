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

        # 전체 기업코드 파일 다운로드 (최초 1회)
        corp_map = cache.get_stale("dart:corp_map")
        if not corp_map:
            corp_map = self._load_corp_map()
            if corp_map:
                cache.set("dart:corp_map", corp_map, 86400)  # 24시간

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
        corp_code = self.get_corp_code(code6)
        if not corp_code:
            return []
        end_de = datetime.now().strftime("%Y%m%d")
        bgn_de = (datetime.now() - timedelta(days=365)).strftime("%Y%m%d")
        d = self._get("list.json", {
            "corp_code": corp_code, "page_count": page_count,
            "bgn_de": bgn_de, "end_de": end_de,
        })
        items = d.get("list", [])
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
        return result


dart_service = DARTService()
