import yfinance as yf
import pandas as pd
from typing import Optional
from datetime import datetime


PERIOD_MAP = {
    "1m": "1mo",
    "3m": "3mo",
    "6m": "6mo",
    "1y": "1y",
    "2y": "2y",
    "5y": "5y",
    "10y": "10y",
    "max": "max",
}

INDEX_SYMBOLS = {
    "SP500": "^GSPC",
    "NASDAQ": "^IXIC",
    "DOW": "^DJI",
}


class USStockService:
    def get_stock_price(self, symbol: str) -> dict:
        """미국 주식 현재가 조회"""
        ticker = yf.Ticker(symbol)
        info = ticker.info
        hist = ticker.history(period="2d")

        if len(hist) >= 2:
            prev_close = hist["Close"].iloc[-2]
            curr_close = hist["Close"].iloc[-1]
            change = curr_close - prev_close
            change_rate = (change / prev_close) * 100
        else:
            curr_close = info.get("currentPrice", info.get("regularMarketPrice", 0))
            change = info.get("regularMarketChange", 0)
            change_rate = info.get("regularMarketChangePercent", 0)

        return {
            "symbol": symbol,
            "name": info.get("longName", symbol),
            "price": round(float(curr_close), 2),
            "change": round(float(change), 2),
            "change_rate": round(float(change_rate), 2),
            "volume": int(info.get("regularMarketVolume", 0)),
            "market_cap": int(info.get("marketCap", 0)),
            "currency": info.get("currency", "USD"),
        }

    def get_ohlcv(self, symbol: str, period: str = "1y", interval: str = "1d") -> list:
        """주가 OHLCV 데이터 조회"""
        yf_period = PERIOD_MAP.get(period, "1y")
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=yf_period, interval=interval)
        hist.index = hist.index.tz_localize(None)

        return [
            {
                "date": str(idx.date()),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]),
            }
            for idx, row in hist.iterrows()
        ]

    def get_fundamentals(self, symbol: str) -> dict:
        """재무 지표 조회"""
        ticker = yf.Ticker(symbol)
        info = ticker.info
        return {
            "per": info.get("trailingPE"),
            "forward_per": info.get("forwardPE"),
            "pbr": info.get("priceToBook"),
            "roe": round(info.get("returnOnEquity", 0) * 100, 2) if info.get("returnOnEquity") else None,
            "eps": info.get("trailingEps"),
            "debt_ratio": info.get("debtToEquity"),
            "week52_high": info.get("fiftyTwoWeekHigh"),
            "week52_low": info.get("fiftyTwoWeekLow"),
            "market_cap": info.get("marketCap"),
            "dividend_yield": round(info.get("dividendYield", 0) * 100, 2) if info.get("dividendYield") else None,
            "sector": info.get("sector"),
            "industry": info.get("industry"),
        }

    def get_market_index(self, index_name: str) -> dict:
        """미국 지수 조회"""
        symbol = INDEX_SYMBOLS.get(index_name, index_name)
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period="2d")

        if len(hist) >= 2:
            prev = hist["Close"].iloc[-2]
            curr = hist["Close"].iloc[-1]
            change = curr - prev
            change_rate = (change / prev) * 100
        else:
            curr = hist["Close"].iloc[-1] if len(hist) > 0 else 0
            change = 0
            change_rate = 0

        return {
            "index": index_name,
            "value": round(float(curr), 2),
            "change": round(float(change), 2),
            "change_rate": round(float(change_rate), 2),
        }

    def screen_stocks(self, symbols: list[str], filters: dict) -> list:
        """미국 주식 스크리닝"""
        results = []
        for symbol in symbols:
            try:
                ticker = yf.Ticker(symbol)
                info = ticker.info
                fundamentals = {
                    "symbol": symbol,
                    "name": info.get("longName", symbol),
                    "market": "US",
                    "price": info.get("currentPrice", info.get("regularMarketPrice", 0)),
                    "change_rate": info.get("regularMarketChangePercent", 0),
                    "per": info.get("trailingPE"),
                    "pbr": info.get("priceToBook"),
                    "roe": round(info.get("returnOnEquity", 0) * 100, 2) if info.get("returnOnEquity") else None,
                    "eps": info.get("trailingEps"),
                    "debt_ratio": info.get("debtToEquity"),
                    "market_cap": info.get("marketCap"),
                }

                if self._apply_filters(fundamentals, filters):
                    results.append(fundamentals)
            except Exception:
                continue

        return results

    def _apply_filters(self, stock: dict, filters: dict) -> bool:
        for key, condition in filters.items():
            value = stock.get(key)
            if value is None:
                return False
            if "min" in condition and value < condition["min"]:
                return False
            if "max" in condition and value > condition["max"]:
                return False
        return True


us_stock_service = USStockService()
