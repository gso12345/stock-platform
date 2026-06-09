import math


def safe_float(v) -> float | None:
    """nan/inf/None을 None으로 변환, 문자열 콤마 제거 후 float 변환"""
    if v is None:
        return None
    try:
        if isinstance(v, str):
            v = v.replace(",", "")
        f = float(v)
        return None if (math.isnan(f) or math.isinf(f)) else f
    except (TypeError, ValueError):
        return None
