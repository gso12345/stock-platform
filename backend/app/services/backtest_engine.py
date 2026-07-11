import pandas as pd
import numpy as np
from typing import Optional


class BacktestEngine:
    def __init__(self, initial_capital: float = 10_000_000):
        self.initial_capital = initial_capital

    def run(self, ohlcv: list, entry_conditions: dict, exit_conditions: dict,
            stop_loss: Optional[float] = None, take_profit: Optional[float] = None,
            position_size: float = 0.95, initial_capital: Optional[float] = None) -> dict:
        if len(ohlcv) < 5:
            return {}
        df = pd.DataFrame(ohlcv)
        df["date"] = pd.to_datetime(df["date"])
        df = df.sort_values("date").reset_index(drop=True)
        df = self._add_all_indicators(df)

        capital = initial_capital if initial_capital is not None else self.initial_capital
        position = 0
        entry_price = 0.0
        entry_date = None
        trades = []
        equity_curve = []

        for i, row in df.iterrows():
            price = row["close"]
            portfolio_value = capital + position * price
            equity_curve.append({"date": str(row["date"].date()), "value": round(portfolio_value, 0)})

            if position > 0:
                pnl = (price - entry_price) / entry_price * 100
                if stop_loss and pnl <= -stop_loss:
                    capital += position * price
                    trades.append(self._trade("손절", entry_date, row["date"].date(), entry_price, price, pnl, position))
                    position = 0; continue
                if take_profit and pnl >= take_profit:
                    capital += position * price
                    trades.append(self._trade("익절", entry_date, row["date"].date(), entry_price, price, pnl, position))
                    position = 0; continue
                if self._check(row, df, i, exit_conditions):
                    capital += position * price
                    trades.append(self._trade("청산", entry_date, row["date"].date(), entry_price, price, pnl, position))
                    position = 0

            if position == 0 and self._check(row, df, i, entry_conditions):
                shares = int(capital * position_size / price)
                if shares > 0:
                    position = shares
                    entry_price = price
                    entry_date = row["date"].date()
                    capital -= shares * price

        if position > 0:
            p = df["close"].iloc[-1]
            pnl = (p - entry_price) / entry_price * 100
            capital += position * p
            trades.append(self._trade("만기청산", entry_date, df["date"].iloc[-1].date(), entry_price, p, pnl, position))

        return self._metrics(equity_curve, trades)

    def _trade(self, type_, entry_date, exit_date, entry_price, exit_price, pnl, shares):
        return {
            "type": type_,
            "entry_date": str(entry_date),
            "exit_date": str(exit_date),
            "entry_price": round(entry_price, 2),
            "exit_price": round(exit_price, 2),
            "pnl_rate": round(pnl, 2),
            "shares": shares,
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

    def _check(self, row: pd.Series, df: pd.DataFrame, idx: int, conditions: dict) -> bool:
        logic = conditions.get("logic", "AND")
        cond_list = conditions.get("conditions", [])
        if not cond_list:
            return False

        results = []
        for cond in cond_list:
            results.append(self._eval_condition(row, df, idx, cond))

        return all(results) if logic == "AND" else any(results)

    def _eval_condition(self, row, df, idx, cond) -> bool:
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
            prev = df.iloc[idx - 1]
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

    def _metrics(self, equity_curve, trades):
        if not equity_curve:
            return {}
        vals = [e["value"] for e in equity_curve]
        initial, final = vals[0], vals[-1]
        total_return = (final - initial) / initial * 100
        years = max(len(vals) / 252, 0.01)
        annual_return = ((final / initial) ** (1 / years) - 1) * 100

        peak = vals[0]
        mdd = 0.0
        for v in vals:
            if v > peak:
                peak = v
            dd = (peak - v) / peak * 100
            if dd > mdd:
                mdd = dd

        daily_rets = pd.Series(vals).pct_change().dropna()
        sharpe = (daily_rets.mean() / daily_rets.std() * np.sqrt(252)) if daily_rets.std() > 0 else 0

        win_rate = sum(1 for t in trades if t["pnl_rate"] > 0) / len(trades) * 100 if trades else 0
        avg_profit = np.mean([t["pnl_rate"] for t in trades if t["pnl_rate"] > 0]) if any(t["pnl_rate"] > 0 for t in trades) else 0
        avg_loss = np.mean([t["pnl_rate"] for t in trades if t["pnl_rate"] < 0]) if any(t["pnl_rate"] < 0 for t in trades) else 0
        total_profit = sum(t["pnl_rate"] for t in trades if t["pnl_rate"] > 0)
        total_loss = sum(abs(t["pnl_rate"]) for t in trades if t["pnl_rate"] < 0)
        profit_factor = total_profit / total_loss if total_loss != 0 else 0

        return {
            "total_return": round(total_return, 2),
            "annual_return": round(annual_return, 2),
            "mdd": round(mdd, 2),
            "sharpe_ratio": round(float(sharpe), 3),
            "win_rate": round(win_rate, 2),
            "total_trades": len(trades),
            "avg_profit": round(avg_profit, 2),
            "avg_loss": round(avg_loss, 2),
            "profit_factor": round(profit_factor, 2),
            "equity_curve": equity_curve,
            "trades": trades,
        }


backtest_engine = BacktestEngine()
