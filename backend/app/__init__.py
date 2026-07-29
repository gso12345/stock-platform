"""이 패키지가 로드되는 순간이 앱에서 가장 이른 시점이다.

무거운 라이브러리(pandas·yfinance·FinanceDataReader…)는 전부 이 아래에서
import 되므로, 여기서 계측을 켜야 각각이 메모리를 얼마나 늘리는지 잴 수 있다.
실패해도 앱은 그대로 뜬다 — 계측은 어디까지나 부가 기능이다.
"""
try:
    from app.core.libmem import install as _install_libmem
    _install_libmem()
except Exception:  # pragma: no cover
    pass
