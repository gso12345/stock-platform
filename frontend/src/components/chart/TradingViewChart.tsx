import { useEffect, useRef, memo } from "react";

declare global {
  interface Window { TradingView: any; }
}

/* ── 심볼 변환 ──────────────────────────────────────── */
export function toTVSymbol(symbol: string, market: string): string {
  const s = symbol.toUpperCase().replace(".KS","").replace(".KQ","");
  if (market === "KR") {
    return `KRX:${s}`;
  }
  if (market === "ETF") {
    const etfExch: Record<string,string> = {
      SPY:"AMEX", QQQ:"NASDAQ", IWM:"AMEX", DIA:"AMEX", VTI:"AMEX",
      VOO:"AMEX", GLD:"AMEX", SLV:"AMEX", TLT:"NASDAQ", HYG:"AMEX",
      XLK:"AMEX", XLF:"AMEX", XLE:"AMEX", XLV:"AMEX", ARKK:"AMEX",
      SOXX:"NASDAQ", EEM:"AMEX", TQQQ:"NASDAQ", SQQQ:"NASDAQ",
    };
    const exch = etfExch[s] ?? "AMEX";
    return `${exch}:${s}`;
  }
  // US 주식 — 거래소 추정
  const nasdaqStocks = new Set([
    "AAPL","MSFT","GOOGL","GOOG","AMZN","NVDA","META","TSLA","AVGO",
    "AMD","INTC","QCOM","TXN","NFLX","COST","ADBE","ORCL","CMCSA",
    "PYPL","UBER","ABNB","CRWD","PANW","DDOG","SNOW","PLTR","ARM",
    "BIDU","PDD","JD","SMCI","MSTR","CDNS","SNPS","KLAC","LRCX","AMAT",
  ]);
  const exch = nasdaqStocks.has(s) ? "NASDAQ" : "NYSE";
  return `${exch}:${s}`;
}

/* ── 지수 TradingView 심볼 ─────────────────────────── */
const INDEX_TV: Record<string, string> = {
  KOSPI:    "KOSPI:KOSPI",
  KOSDAQ:   "KOSDAQ:KOSDAQ",
  KOSPI200: "KRX:KS200",
  KOSDAQ150:"KRX:KQ150",
  SP500:    "SP:SPX",
  NASDAQ:   "NASDAQ:COMP",
  DOW:      "DJ:DJI",
  SOX:      "PHLX:SOX",
  RUSSELL:  "RUSSELLUS:RUT",
};

export function toTVIndexSymbol(name: string): string {
  return INDEX_TV[name.toUpperCase()] ?? name;
}

/* ── 봉 종류 → TV interval ────────────────────────── */
const TV_INTERVAL: Record<string, string> = {
  "1m":"1","5m":"5","15m":"15","30m":"30","60m":"60",
  "1d":"D","1wk":"W","1mo":"M","1y":"12M",
};

/* ── 메인 컴포넌트 ─────────────────────────────────── */
interface Props {
  symbol: string;
  market: string;
  isIndex?: boolean;
  candleType?: string;
  height?: number;
  hideTopToolbar?: boolean;
  hideBottomBar?: boolean;
}

let widgetCounter = 0;

const TradingViewChart = memo(function TradingViewChart({
  symbol, market, isIndex = false,
  candleType = "1d",
  height = 500,
  hideTopToolbar = false,
  hideBottomBar = false,
}: Props) {
  const containerId = useRef(`tv_${++widgetCounter}`);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = containerId.current;
    if (!containerRef.current) return;

    const tvSymbol = isIndex
      ? toTVIndexSymbol(symbol)
      : toTVSymbol(symbol, market);

    const interval = TV_INTERVAL[candleType] ?? "D";

    // TradingView 스크립트 로드 함수
    const initWidget = () => {
      if (!window.TradingView || !containerRef.current) return;
      containerRef.current.innerHTML = "";
      const div = document.createElement("div");
      div.id = id;
      containerRef.current.appendChild(div);

      new window.TradingView.widget({
        autosize:             true,
        symbol:               tvSymbol,
        interval,
        timezone:             "Asia/Seoul",
        theme:                "dark",
        style:                "1",         // 캔들스틱
        locale:               "kr",
        toolbar_bg:           "#141824",
        enable_publishing:    false,
        allow_symbol_change:  true,
        save_image:           false,
        container_id:         id,
        hide_top_toolbar:     hideTopToolbar,
        hide_legend:          false,
        hide_side_toolbar:    false,
        withdateranges:       true,
        studies:              ["Volume@tv-basicstudies"],
        overrides: {
          "paneProperties.background":     "#141824",
          "paneProperties.backgroundType": "solid",
          "scalesProperties.textColor":    "#94a3b8",
          "mainSeriesProperties.candleStyle.upColor":       "#10b981",
          "mainSeriesProperties.candleStyle.downColor":     "#ef4444",
          "mainSeriesProperties.candleStyle.borderUpColor": "#10b981",
          "mainSeriesProperties.candleStyle.borderDownColor":"#ef4444",
          "mainSeriesProperties.candleStyle.wickUpColor":   "#10b981",
          "mainSeriesProperties.candleStyle.wickDownColor": "#ef4444",
        },
        loading_screen: {
          backgroundColor: "#141824",
          foregroundColor:  "#3b82f6",
        },
      });
    };

    if (window.TradingView) {
      initWidget();
    } else {
      const existing = document.getElementById("tv-widget-script");
      if (!existing) {
        const script = document.createElement("script");
        script.id  = "tv-widget-script";
        script.src = "https://s3.tradingview.com/tv.js";
        script.async = true;
        script.onload = initWidget;
        document.head.appendChild(script);
      } else {
        existing.addEventListener("load", initWidget);
      }
    }

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [symbol, market, isIndex, candleType, height]);

  return (
    <div
      ref={containerRef}
      style={{ height, width: "100%" }}
      className="tradingview-container"
    />
  );
});

export default TradingViewChart;
