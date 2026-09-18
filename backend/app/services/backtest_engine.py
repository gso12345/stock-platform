import pandas as pd
import numpy as np
from typing import Optional


class BacktestEngine:
    def __init__(self, initial_capital: float = 10_000_000):
        self.initial_capital = initial_capital

    def run(self, ohlcv: list, entry_conditions: dict, exit_conditions: dict,
            stop_loss: Optional[float] = None, take_profit: Optional[float] = None,
            position_size: float = 0.95, initial_capital: Optional[float] = None,
            거래비용: float = 0.0, 평가시작: Optional[str] = None,
            무위험수익률: float = 0.0) -> dict:
        """거래비용 — 0.001 이면 0.1%. 살 때도 팔 때도 뗀다.

        평가시작 — 'YYYY-MM-DD'. **지표는 받은 자료 전부로 만들고, 매매와
        기록은 이 날부터** 한다. 앞쪽 봉은 지표를 데우는 데만 쓰인다.

        왜 필요한가 — 엔진은 받은 자료로만 지표를 만든다. 요청한 기간을
        딱 잘라 주면 MA200 은 앞 199봉이 비고, 빈 값에서는 어떤 신호도
        안 난다. 1년 백테스트라면 **79%가 죽은 구간**이 된다(실측:
        거래 1건, 데워서 재면 6건).

        앞을 그냥 같이 재면 안 된다 — 그러면 요청한 것보다 긴 기간의
        성적이 나온다. 지표는 데운 값으로, 성과는 요청한 구간만.

        자산배분 백테스트에는 이미 들어가 있었는데 이쪽에는 없었다.
        **같은 화면의 두 탭이 다른 기준으로 계산**하고 있었던 셈이다 —
        나란히 놓고 보면 신호 쪽이 무조건 좋아 보인다.

        신호 매매는 자산배분보다 사고파는 횟수가 훨씬 많아서 영향도 더
        크다. 하루에 한 번 사고파는 전략이면 1년에 500번이고, 0.1% 씩
        떼면 그것만으로 연 수십 %가 사라진다.
        """
        if len(ohlcv) < 5:
            return {}
        df = pd.DataFrame(ohlcv)
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values("date").reset_index(drop=True)
        df = self._add_all_indicators(df)

        capital = initial_capital if initial_capital is not None else self.initial_capital
        비용률 = max(float(거래비용 or 0.0), 0.0)
        비용합 = 0.0
        position = 0
        entry_price = 0.0
        entry_date = None
        trades = []
        equity_curve = []

        """한 줄씩 볼 때 iterrows 를 안 쓴다.

        iterrows 는 봉마다 pandas Series 를 새로 만든다. 10년치 2,520봉을
        재 보니 순회에만 0.086초가 걸렸는데, 같은 것을 dict 목록으로
        바꾸면 0.020초다 — **4.3배**. 계산 결과는 한 글자도 안 달라진다.

        이게 왜 큰가 — 유니버스 백테스트는 이 일을 316종목에 한다.
        계산만으로 23초가 걸려서 화면의 30초 시한을 넘기고 있었다(실측).

        지표 계산은 전체의 11% 뿐이었다. 89%가 이 순회였다 —
        처음에는 지표가 범인일 거라 짐작했는데 재 보니 아니었다."""
        줄들 = df.to_dict("records")
        """데우는 구간은 건너뛴다 — 지표는 이미 위에서 다 만들어졌다.

        건너뛰되 `줄들` 은 통째로 들고 간다. 크로스 판정이 `줄들[i-1]`
        을 보기 때문이다. 평가 첫날의 '어제' 가 없으면 그날 크로스는
        영영 안 잡힌다."""
        시작칸 = 0
        if 평가시작:
            for i, row in enumerate(줄들):
                if str(row["date"].date()) >= 평가시작:
                    시작칸 = i
                    break
            else:
                return {}          # 평가할 구간이 아예 없다

        for i in range(시작칸, len(줄들)):
            row = 줄들[i]
            price = row["close"]
            portfolio_value = capital + position * price
            equity_curve.append({"date": str(row["date"].date()),
                                 "value": round(float(portfolio_value), 0)})

            if position > 0:
                pnl = (price - entry_price) / entry_price * 100
                """손절·익절은 **장중**에 닿는다. 종가로만 보면 안 된다.

                예전에는 종가만 봤다. 그래서 장중에 저가가 -30% 를 찍고
                종가가 -1% 로 회복한 날, 손절 10% 를 걸어 뒀는데도 **한 번도
                안 팔렸다**(실측: 손절 0건). 실제로는 그날 팔렸어야 한다.

                이게 왜 큰가 — 백테스트 결과가 **한쪽으로만** 틀린다.
                손절을 놓치면 그 뒤에 값이 돌아온 경우만 살아남아, 실제보다
                수익률이 높고 MDD 가 낮게 나온다. 손절을 걸수록 결과가 더
                좋아 보이는, 정반대의 그림이 된다.

                체결가는 손절선·익절선으로 잡는다. 저가가 -30% 까지
                갔더라도 -10% 에 걸어 둔 주문은 -10% 근처에서 체결된다 —
                저가로 잡으면 실제보다 훨씬 나쁘게 나온다. (갭 하락으로
                시가가 이미 선 아래면 그 시가가 체결가다.)

                한 봉 안에서 손절선과 익절선에 **둘 다** 닿을 수 있다.
                일봉만으로는 어느 쪽이 먼저인지 알 수 없으므로 **손절을
                먼저** 본다 — 모르면 나쁜 쪽으로 세는 것이 백테스트의 규칙이다.
                반대로 하면 실제로는 손절된 거래가 익절로 기록된다."""
                저 = row.get("low", price)
                고 = row.get("high", price)
                시 = row.get("open", price)
                if stop_loss:
                    손절선 = entry_price * (1 - stop_loss / 100)
                    if 저 <= 손절선:
                        체결 = min(시, 손절선)          # 갭 하락이면 시가가 이미 아래
                        실현 = (체결 - entry_price) / entry_price * 100
                        받은돈 = position * 체결
                        비용합 += 받은돈 * 비용률
                        capital += 받은돈 * (1 - 비용률)
                        trades.append(self._trade("손절", entry_date, row["date"].date(),
                                                  entry_price, 체결, 실현, position, 비용률))
                        position = 0; continue
                if take_profit:
                    익절선 = entry_price * (1 + take_profit / 100)
                    if 고 >= 익절선:
                        체결 = max(시, 익절선)          # 갭 상승이면 시가가 이미 위
                        실현 = (체결 - entry_price) / entry_price * 100
                        받은돈 = position * 체결
                        비용합 += 받은돈 * 비용률
                        capital += 받은돈 * (1 - 비용률)
                        trades.append(self._trade("익절", entry_date, row["date"].date(),
                                                  entry_price, 체결, 실현, position, 비용률))
                        position = 0; continue
                if self._check(row, 줄들, i, exit_conditions):
                    받은돈 = position * price
                    비용합 += 받은돈 * 비용률
                    capital += 받은돈 * (1 - 비용률)
                    trades.append(self._trade("청산", entry_date, row["date"].date(), entry_price, price, pnl, position, 비용률))
                    position = 0
                    """판 봉에서는 **다시 안 산다.**

                    손절·익절은 위에서 `continue` 로 이미 그러고 있었는데
                    조건 청산만 빠져 있었다. 그래서 파는 조건과 사는
                    조건이 같은 봉에 맞으면 같은 값에 그대로 되샀다 —
                    값이 40봉 내내 그대로인 자료로 재 보니 **거래 40건에
                    수수료 173만원, 수익률 -16.71%** 가 나왔다. 같은
                    엔진 안에서 두 길이 다르게 동작하고 있었다."""
                    continue

            if position == 0 and self._check(row, 줄들, i, entry_conditions):
                """수수료까지 낼 수 있는 만큼만 산다.
                (1 + 비용률) 로 나누지 않으면 살 돈을 다 쓰고 나서
                수수료를 못 내 현금이 마이너스가 된다."""
                shares = int(capital * position_size / (price * (1 + 비용률)))
                if shares > 0:
                    position = shares
                    entry_price = price
                    entry_date = row["date"].date()
                    낸돈 = shares * price
                    비용합 += 낸돈 * 비용률
                    capital -= 낸돈 * (1 + 비용률)

        if position > 0:
            p = df["close"].iloc[-1]
            pnl = (p - entry_price) / entry_price * 100
            받은돈 = position * p
            비용합 += 받은돈 * 비용률
            capital += 받은돈 * (1 - 비용률)
            trades.append(self._trade("만기청산", entry_date, df["date"].iloc[-1].date(), entry_price, p, pnl, position, 비용률))
            position = 0

        """**마지막 봉의 거래까지 곡선에 넣는다.**

        곡선은 봉마다 그 봉의 매매를 하기 **전** 값을 적는다. 중간
        봉에서는 그 봉에 낸 수수료가 다음 봉 값에 나타나니 괜찮은데,
        마지막 봉에는 다음이 없다. 그래서 마지막 봉에 판 수수료가
        수익률에 영영 안 들어갔다 — 실측으로 수수료 합 56,621원 중
        32,930원이 빠져 36.72% 와 36.39% 가 갈렸다. costs 에는 더해 놓고
        곡선에는 없는, 같은 결과 안에서 앞뒤가 안 맞는 상태였다.

        만기청산만 고치면 **마지막 봉에서 조건으로 팔린 경우**가 그대로
        남는다. 그래서 어느 길로 끝났든 마지막 값을 '지금 가진 현금 +
        들고 있는 주식' 으로 다시 적는다.

        수수료가 0 이면 사고파는 것이 값을 안 바꾸므로 이 줄은 아무
        일도 안 한다 — 옛날 결과가 달라지지 않는다."""
        if equity_curve:
            """float() 로 한 번 더 벗긴다.

            capital 은 봉 가격(np.float64)이 섞이면서 numpy 스칼라가 돼
            있다. round() 는 numpy 를 넣으면 numpy 를 돌려주므로 그대로
            두면 곡선 끝 한 칸만 np.float64 가 된다 — 이 dict 는 DB 의
            JSON 칸에도 들어가는데 드라이버에 따라 거기서 직렬화가
            터진다. 값은 맞는데 저장만 실패하는, 찾기 어려운 자리다.
            (검사가 이것을 잡았다. 위 줄들이 전부 float() 로 벗기고
             있었는데 새로 넣은 이 줄만 빠져 있었다.)"""
            끝값 = float(df["close"].iloc[-1])
            equity_curve[-1]["value"] = round(float(capital) + position * 끝값, 0)

        return self._metrics(equity_curve, trades, 비용합 if 비용률 > 0 else None,
                             비용률, 무위험수익률)

    def _trade(self, type_, entry_date, exit_date, entry_price, exit_price, pnl,
               shares, 비용률=0.0):
        """numpy 스칼라를 여기서 벗긴다.

        가격이 pandas 에서 나오면 np.float64 다. 그대로 두면 이 dict 가
        응답으로도 나가고 **DB 의 JSON 칸에도** 들어가는데, 드라이버에
        따라 거기서 직렬화가 터진다. 값이 맞는데도 저장만 실패하는,
        원인을 찾기 어려운 자리다. 만드는 곳에서 한 번에 벗긴다.

        ── net_pnl_rate 를 같이 담는 이유 ──

        pnl_rate 는 **값이 얼마나 움직였나**다. 수수료는 안 들어 있다.
        그 수로 승률을 세면, 수수료를 내고 나면 손해인 거래가 '이긴
        거래' 로 잡힌다. 실측으로 수수료 0.25% 에서 **승률 100% 인데
        실제 수익률은 -6.74%** 인 상황이 나왔다 — 화면의 두 숫자가
        정반대를 말한 셈이다.

        net_pnl_rate 는 **낸 돈 대비 받은 돈**이다. 살 때 (1+비용률)만큼
        더 내고 팔 때 (1-비용률)만큼 덜 받는다. 승률·평균손익·손익비는
        전부 이 수로 센다. pnl_rate 도 남겨 둔다 — 표에 적힌 매수가·
        매도가와 앞뒤가 맞는 수가 하나는 있어야 한다."""
        낸돈 = float(shares) * float(entry_price) * (1 + 비용률)
        받은돈 = float(shares) * float(exit_price) * (1 - 비용률)
        순 = ((받은돈 - 낸돈) / 낸돈 * 100) if 낸돈 > 0 else 0.0
        return {
            "type": type_,
            "entry_date": str(entry_date),
            "exit_date": str(exit_date),
            "entry_price": round(float(entry_price), 2),
            "exit_price": round(float(exit_price), 2),
            "pnl_rate": round(float(pnl), 2),
            #: 수수료까지 뺀 실제 손익. 승률·손익비는 이 수로 센다.
            "net_pnl_rate": round(순, 2),
            "shares": int(shares),
        }

    def _add_all_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        c = df["close"]
        h = df["high"]
        l = df["low"]
        v = df["volume"]

        # 이동평균 (MA / EMA)
        for p in [5, 10, 20, 60, 120, 200]:
            df[f"ma_{p}"] = c.rolling(p).mean()
            df[f"ema_{p}"] = c.ewm(span=p, adjust=False).mean()

        # MACD
        ema12 = c.ewm(span=12, adjust=False).mean()
        ema26 = c.ewm(span=26, adjust=False).mean()
        df["macd"] = ema12 - ema26
        df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()
        df["macd_hist"] = df["macd"] - df["macd_signal"]

        # RSI (Wilder's Smoothing Method)
        delta = c.diff()
        gain = delta.where(delta > 0, 0.0)
        loss = (-delta.where(delta < 0, 0.0))
        avg_gain = gain.ewm(com=13, adjust=False).mean()
        avg_loss = loss.ewm(com=13, adjust=False).mean()
        df["rsi"] = 100 - (100 / (1 + avg_gain / avg_loss.replace(0, np.nan)))

        # 볼린저 밴드
        ma20 = c.rolling(20).mean()
        std20 = c.rolling(20).std()
        df["bb_upper"] = ma20 + 2 * std20
        df["bb_lower"] = ma20 - 2 * std20
        df["bb_mid"] = ma20
        df["bb_pct"] = (c - df["bb_lower"]) / (df["bb_upper"] - df["bb_lower"]).replace(0, np.nan)

        # 스토캐스틱 (14,3)
        low14 = l.rolling(14).min()
        high14 = h.rolling(14).max()
        df["stoch_k"] = (c - low14) / (high14 - low14).replace(0, np.nan) * 100
        df["stoch_d"] = df["stoch_k"].rolling(3).mean()

        # ATR (Average True Range)
        tr = pd.concat([
            h - l,
            (h - c.shift()).abs(),
            (l - c.shift()).abs()
        ], axis=1).max(axis=1)
        df["atr"] = tr.rolling(14).mean()
        df["atr_pct"] = df["atr"] / c * 100

        # CCI (Commodity Channel Index)
        tp = (h + l + c) / 3
        df["cci"] = (tp - tp.rolling(20).mean()) / (0.015 * tp.rolling(20).std())

        # Williams %R
        df["willr"] = (high14 - c) / (high14 - low14).replace(0, np.nan) * -100

        # OBV (On-Balance Volume) — 부호화된 거래량의 누적합으로 벡터화
        obv_step = np.sign(c.diff().fillna(0)) * v
        obv = obv_step.cumsum()
        obv.iloc[0] = 0
        df["obv"] = obv
        df["obv_ma"] = obv.rolling(20).mean().values

        # 거래량 이동평균
        df["vol_ma20"] = v.rolling(20).mean()
        df["vol_ratio"] = v / df["vol_ma20"].replace(0, np.nan)

        # 가격 변화율
        df["roc_1"] = c.pct_change(1) * 100
        df["roc_5"] = c.pct_change(5) * 100
        df["roc_20"] = c.pct_change(20) * 100

        # 52주 고/저 대비
        df["high_52w"] = h.rolling(252, min_periods=1).max()
        df["low_52w"] = l.rolling(252, min_periods=1).min()
        df["pct_from_high"] = (c - df["high_52w"]) / df["high_52w"] * 100
        df["pct_from_low"] = (c - df["low_52w"]) / df["low_52w"] * 100

        return df

    def _check(self, row: dict, 줄들: list, idx: int, conditions: dict) -> bool:
        logic = conditions.get("logic", "AND")
        cond_list = conditions.get("conditions", [])
        if not cond_list:
            return False

        results = []
        for cond in cond_list:
            results.append(self._eval_condition(row, 줄들, idx, cond))

        return all(results) if logic == "AND" else any(results)

    def _eval_condition(self, row, 줄들, idx, cond) -> bool:
        indicator = cond.get("indicator", "")
        operator = cond.get("operator", ">")
        value = cond.get("value", 0)
        period = cond.get("period", 20)

        col_map = {
            "MA": f"ma_{period}", "EMA": f"ema_{period}",
            "MACD": "macd", "MACD_SIGNAL": "macd_signal", "MACD_HIST": "macd_hist",
            "RSI": "rsi", "STOCH_K": "stoch_k", "STOCH_D": "stoch_d",
            "BB_UPPER": "bb_upper", "BB_LOWER": "bb_lower", "BB_MID": "bb_mid", "BB_PCT": "bb_pct",
            "ATR": "atr", "ATR_PCT": "atr_pct",
            "CCI": "cci", "WILLR": "willr",
            "OBV": "obv", "OBV_MA": "obv_ma",
            "VOLUME": "volume", "VOL_MA": "vol_ma20", "VOL_RATIO": "vol_ratio",
            "PRICE": "close", "OPEN": "open", "HIGH": "high", "LOW": "low",
            "ROC_1": "roc_1", "ROC_5": "roc_5", "ROC_20": "roc_20",
            "PCT_FROM_HIGH": "pct_from_high", "PCT_FROM_LOW": "pct_from_low",
        }

        # 좌변 결정
        left_col = col_map.get(indicator)
        if left_col is None:
            return False
        left = row.get(left_col, np.nan)
        if pd.isna(left):
            return False

        # 우변: 다른 지표 또는 숫자
        right_col = col_map.get(str(value))
        if right_col:
            right = row.get(right_col, np.nan)
        else:
            try:
                right = float(value)
            except (ValueError, TypeError):
                return False
        if pd.isna(right):
            return False

        # 크로스 감지 (전봉 vs 현재)
        if operator in ("crosses_above", "crosses_below") and idx > 0:
            # df.iloc[idx-1] 은 봉마다 Series 를 또 만든다 — 목록에서 바로 꺼낸다
            prev = 줄들[idx - 1]
            prev_left = prev.get(left_col, np.nan)
            prev_right_col = col_map.get(str(value))
            prev_right = prev.get(prev_right_col, np.nan) if prev_right_col else right
            if pd.isna(prev_left) or pd.isna(prev_right):
                return False
            if operator == "crosses_above":
                return prev_left <= prev_right and left > right
            else:
                return prev_left >= prev_right and left < right

        ops = {
            ">": left > right, "<": left < right,
            ">=": left >= right, "<=": left <= right,
            "==": abs(left - right) < 0.001,
        }
        return ops.get(operator, False)

    def _metrics(self, equity_curve, trades, 비용합=None, 비용률=0.0, 무위험수익률=0.0):
        if not equity_curve:
            return {}
        vals = [e["value"] for e in equity_curve]
        initial, final = vals[0], vals[-1]
        total_return = (final - initial) / initial * 100
        """연환산은 **1년이 안 되는 기간에서는 내보내지 않는다.**

        수식 자체는 표준이다. 문제는 짧은 기간에서 나오는 수다 —
        6주에 +9.5% 를 연으로 늘리면 **'연 114%'** 가 찍힌다(실측).
        여섯 주 성적이 한 해 내내 그대로 이어진다고 가정한 값인데,
        화면에는 그 가정이 한 글자도 안 적힌다. 사람은 그냥 '이 전략은
        연 114%' 로 읽고, 그건 거짓이다.

        1년 미만이면 None 을 주고 화면이 '—' 를 그리게 한다. 총수익률은
        그대로 나가므로 볼 것이 없어지지는 않는다 — 부풀린 수 대신
        실제로 잰 수만 남는다.

        years 도 같이 내보낸다. 화면이 '몇 년치로 잰 값인가' 를 적어 줄
        수 있어야 한다 — 3개월 성적과 10년 성적을 같은 얼굴로 보여 주는
        것이 과최적화로 가는 가장 흔한 길이다."""
        """햇수는 **달력으로** 센다. 봉 수로 세면 안 된다.

        예전에는 `len(vals) / 252` 였다. 252는 '1년은 거래일 252일' 이라는
        어림인데, 실제 자료에는 휴장·누락이 있어서 봉이 그보다 적다.
        봉이 적으면 햇수가 짧게 나오고, **짧은 기간으로 나누면 연환산이
        부풀려진다** — 자료에 구멍이 많을수록 성적이 좋아 보이는 셈이다.

        자산배분 엔진은 처음부터 달력으로 세고 있었다. 같은 화면의 두
        백테스트가 '몇 년' 을 다르게 세면 나란히 놓고 볼 수가 없다."""
        첫날 = equity_curve[0]["date"]
        끝날 = equity_curve[-1]["date"]
        try:
            from datetime import date as _d
            years = ((_d.fromisoformat(끝날) - _d.fromisoformat(첫날)).days) / 365.25
        except (ValueError, TypeError):
            years = len(vals) / 252          # 날짜를 못 읽으면 예전 방식으로
        annual_return = (((final / initial) ** (1 / years) - 1) * 100
                         if years >= 1.0 and initial > 0 else None)

        peak = vals[0]
        mdd = 0.0
        for v in vals:
            if v > peak:
                peak = v
            dd = (peak - v) / peak * 100
            if dd > mdd:
                mdd = dd

        """값이 한 번도 안 움직였으면 샤프는 **못 잰다**(0 이 아니다).

        표준편차가 0 이라는 것은 조건이 한 번도 안 맞아 아무것도 안
        샀거나, 자료가 하루치뿐이라는 뜻이다. 거기에 0 을 적으면
        '위험 대비 수익이 없다' 로 읽힌다 — 못 잰 것과 나쁜 것은 다르다.

        이 파일은 승률·손익비에서 이미 그 구분을 지키고 있었는데
        샤프만 빠져 있었다."""
        """연으로 늘릴 때 곱하는 수는 자료에서 직접 센다 — 자산배분
        엔진과 같은 규칙이다. 늘 √252 로 박아 두면 자료에 구멍이
        많은 종목에서 위험이 부풀려진다."""
        daily_rets = pd.Series(vals).pct_change().dropna()
        표준 = daily_rets.std() if len(daily_rets) > 1 else 0
        연칸수 = (len(daily_rets) / years) if years > 0 else 252
        """무위험수익률을 빼고 잰다 — 자산배분 엔진과 같은 규칙이다.

        샤프는 원래 '그냥 무위험으로 뒀어도 얻었을 것' 을 뺀 초과수익을
        위험으로 나눈 값이다. 0 으로 두면 금리 5% 인 해에 연 5% 를 번
        전략이 초과수익 0 인데도 샤프 0.5 로 나온다. 기본은 0 이지만
        무엇을 가정했는지 응답에 적어 내보낸다."""
        칸무위험 = ((1 + 무위험수익률) ** (1 / 연칸수) - 1) if 연칸수 > 0 else 0.0
        sharpe = ((daily_rets.mean() - 칸무위험) / 표준 * np.sqrt(연칸수)
                  if 표준 and 표준 > 0 else None)

        """승률·평균손익·손익비는 **수수료까지 뺀** 손익으로 센다.

        가격 손익(pnl_rate)으로 세면 수수료를 내고 나면 손해인 거래가
        '이긴 거래' 가 된다. 실측으로 승률 100% 에 실제 수익률 -6.74%
        가 같이 찍혔다 — 화면의 두 숫자가 정반대를 말한 셈이다.
        수수료 0% 로 돌리면 두 수가 같으므로 달라지는 것도 없다."""
        순 = lambda t: t.get("net_pnl_rate", t["pnl_rate"])
        win_rate = sum(1 for t in trades if 순(t) > 0) / len(trades) * 100 if trades else 0
        avg_profit = np.mean([순(t) for t in trades if 순(t) > 0]) if any(순(t) > 0 for t in trades) else 0
        avg_loss = np.mean([순(t) for t in trades if 순(t) < 0]) if any(순(t) < 0 for t in trades) else 0
        total_profit = sum(순(t) for t in trades if 순(t) > 0)
        total_loss = sum(abs(순(t)) for t in trades if 순(t) < 0)
        """손실이 하나도 없으면 손익비는 **잴 수 없다**(0 이 아니다).

        예전에는 0 을 내려보냈다. 손익비 0 은 '번 돈이 하나도 없다' 는
        뜻이라, **한 번도 안 진 전략이 화면에서 최악으로 보였다**.
        거래가 아예 없을 때도 마찬가지로 0 이었다.

        None 으로 내보내고 화면이 '—' 를 그리게 한다. 없는 것과 나쁜 것은
        다른 말이다 — 이 앱은 그 구분을 다른 화면에서도 지킨다."""
        if not trades or total_loss == 0:
            profit_factor = None
        else:
            profit_factor = total_profit / total_loss

        """거래가 **한 건도 없으면** 거래에 관한 지표는 잴 수 없다.

        예전에는 전부 0 이었다. 그러면 화면에 '승률 0% · 평균수익 0%' 가
        찍히는데, 이건 '다 졌다' 로 읽힌다. 실제로는 **조건이 한 번도
        안 맞아서 아무것도 안 샀다** 는 뜻이다 — 정반대의 상황을 같은
        얼굴로 보여 준 셈이다.

        수익률·MDD·샤프는 그대로 둔다. 안 산 채로 현금을 들고 있었던
        기간의 성과는 실제로 0% 가 맞다.

        numpy 스칼라(np.float64)를 float() 로 벗긴다. 이 값들은 그대로
        DB 의 JSON 칸에 들어가는데, 드라이버에 따라 직렬화에서 터진다."""
        거래있음 = len(trades) > 0

        def _수(v):
            return None if v is None else round(float(v), 2)

        return {
            #: **실제로 잰 구간.** 요청한 기간과 다를 수 있다 — 종목이
            #  늦게 상장했거나 시세가 거기까지 없으면 짧아진다.
            #  안 적어 보내면 화면은 요청한 기간을 쟀다고 믿는다.
            "start_date": 첫날,
            "end_date": 끝날,
            "total_return": _수(total_return),
            "annual_return": _수(annual_return),
            "mdd": _수(mdd),
            "sharpe_ratio": None if sharpe is None else round(float(sharpe), 3),
            "win_rate": _수(win_rate) if 거래있음 else None,
            "total_trades": len(trades),
            #: 몇 년치로 잰 값인가. 화면이 '3개월 성적' 과 '10년 성적' 을
            #  같은 얼굴로 보여 주지 않도록 쓴다.
            "years": round(years, 2),
            "avg_profit": _수(avg_profit) if 거래있음 else None,
            "avg_loss": _수(avg_loss) if 거래있음 else None,
            "profit_factor": _수(profit_factor),
            #: 낸 수수료 합. 0%로 돌렸으면 0 이 아니라 None 이다 —
            #  '안 넣었다' 와 '넣었는데 0원' 은 다른 말이다.
            "costs": _수(비용합),
            "cost_rate": 비용률 if 비용률 > 0 else None,
            #: 샤프를 잴 때 무엇을 무위험으로 봤나(연 %). 가정은 숨기지 않는다.
            "risk_free_rate": round(float(무위험수익률) * 100, 2),
            "equity_curve": equity_curve,
            "trades": trades,
        }


backtest_engine = BacktestEngine()
