import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CrosshairMode, LineStyle, PriceScaleMode } from "lightweight-charts";
import { calcMA, calcEMA, calcBB, calcRSI, calcMACD, calcStochastic, calcVolume, OHLCV } from "./indicators";

export const CANDLE_TYPES = [
  { label: "1분",   value: "1m"  },
  { label: "5분",   value: "5m"  },
  { label: "15분",  value: "15m" },
  { label: "30분",  value: "30m" },
  { label: "1시간", value: "60m" },
  { label: "일봉",  value: "1d"  },
  { label: "주봉",  value: "1wk" },
  { label: "월봉",  value: "1mo" },
  { label: "연봉",  value: "1y"  },
] as const;

export const PERIOD_BY_CANDLE: Record<string, { label: string; value: string }[]> = {
  "1m":  [{ label:"1일",value:"1d" },{ label:"5일",value:"5d" }],
  "5m":  [{ label:"5일",value:"5d" },{ label:"1달",value:"1mo" }],
  "15m": [{ label:"5일",value:"5d" },{ label:"1달",value:"1mo" },{ label:"3달",value:"3mo" }],
  "30m": [{ label:"1달",value:"1mo" },{ label:"3달",value:"3mo" },{ label:"6달",value:"6mo" }],
  "60m": [{ label:"1달",value:"1mo" },{ label:"3달",value:"3mo" },{ label:"6달",value:"6mo" },{ label:"1년",value:"1y" }],
  "1d":  [{ label:"1달",value:"1mo" },{ label:"3달",value:"3mo" },{ label:"6달",value:"6mo" },{ label:"1년",value:"1y" },{ label:"2년",value:"2y" },{ label:"3년",value:"3y" },{ label:"5년",value:"5y" },{ label:"10년",value:"10y" },{ label:"최대",value:"max" }],
  "1wk": [{ label:"1년",value:"1y" },{ label:"2년",value:"2y" },{ label:"3년",value:"3y" },{ label:"5년",value:"5y" },{ label:"10년",value:"10y" },{ label:"최대",value:"max" }],
  "1mo": [{ label:"2년",value:"2y" },{ label:"5년",value:"5y" },{ label:"10년",value:"10y" },{ label:"최대",value:"max" }],
  "1y":  [{ label:"10년",value:"10y" },{ label:"최대",value:"max" }],
};

const INDICATORS_DEF = [
  { key:"volume",  label:"거래량",      color:"#3b82f6", group:"overlay" },
  { key:"ma5",     label:"MA 5",        color:"#f59e0b", group:"overlay" },
  { key:"ma20",    label:"MA 20",       color:"#3b82f6", group:"overlay" },
  { key:"ma60",    label:"MA 60",       color:"#8b5cf6", group:"overlay" },
  { key:"ma120",   label:"MA 120",      color:"#10b981", group:"overlay" },
  { key:"ma200",   label:"MA 200",      color:"#ef4444", group:"overlay" },
  { key:"ema20",   label:"EMA 20",      color:"#06b6d4", group:"overlay" },
  { key:"bb",      label:"볼린저밴드",  color:"#94a3b8", group:"overlay" },
  { key:"rsi",     label:"RSI 14",      color:"#f59e0b", group:"sub" },
  { key:"macd",    label:"MACD",        color:"#3b82f6", group:"sub" },
  { key:"stoch",   label:"스토캐스틱",  color:"#10b981", group:"sub" },
];

const MA_COLORS: Record<string, string> = {
  ma5:"#f59e0b", ma20:"#3b82f6", ma60:"#8b5cf6", ma120:"#10b981", ma200:"#ef4444",
};

function getThemeColors() {
  const isLight = typeof document !== "undefined" && document.documentElement.classList.contains("light");
  return {
    card:   isLight ? "#ffffff" : "#1a1f2e",
    border: isLight ? "#cbd5e1" : "#232840",
    green:  "#10b981",
    red:    "#ef4444",
    text:   isLight ? "#475569" : "#94a3b8",
    blue:   "#3b82f6",
  };
}

export type ChartType = "candle" | "line" | "area";

interface Props {
  data: OHLCV[];
  height?: number;
  isKR?: boolean;
  chartType?: ChartType;
  logScale?: boolean;
}

function preprocessData(data: OHLCV[]) {
  return data
    .filter(d => d.close > 0)
    .map(d => {
      // 8자리 붙여쓰기 → YYYY-MM-DD 변환
      const raw = d.date.replace(/^(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
      const isIntraday = raw.length > 10; // "2024-01-01 09:30:00"
      const time = isIntraday
        ? Math.floor(new Date(raw.replace(" ", "T")).getTime() / 1000) // Unix 초
        : raw.slice(0, 10); // "YYYY-MM-DD"
      return { ...d, date: raw.slice(0, 10), time };
    });
}

export default function StockChart({ data, height = 400, isKR = false, chartType = "candle", logScale = false }: Props) {
  const mainRef = useRef<HTMLDivElement>(null);
  const rsiRef  = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const stRef   = useRef<HTMLDivElement>(null);

  // 차트 인스턴스 refs
  const chartRef      = useRef<ReturnType<typeof createChart> | null>(null);
  const rsiChartRef   = useRef<ReturnType<typeof createChart> | null>(null);
  const macdChartRef  = useRef<ReturnType<typeof createChart> | null>(null);
  const stChartRef    = useRef<ReturnType<typeof createChart> | null>(null);

  // 오버레이 시리즈 refs (MA/EMA/BB/Volume) — 재생성 없이 add/remove
  const overlayRef = useRef<Map<string, any>>(new Map());

  // 최신 처리된 OHLCV 데이터 ref (effect deps 없이 접근)
  const ohlcvRef   = useRef<ReturnType<typeof preprocessData>>([]);
  const logScaleRef = useRef(logScale);
  logScaleRef.current = logScale;

  const [activeIndicators, setActiveIndicators] = useState<Set<string>>(new Set(["volume","ma20","ma60"]));
  const activeRef = useRef(activeIndicators);
  activeRef.current = activeIndicators;

  const toggle = (key: string) => {
    setActiveIndicators(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  /* ── Effect 1: 메인 차트 생성 (data/chartType/height/isKR 변경 시만) ── */
  useEffect(() => {
    if (!mainRef.current || !data.length) return;

    const C = getThemeColors();
    const ohlcv = preprocessData(data);
    ohlcvRef.current = ohlcv;

    const mkChart = (el: HTMLDivElement, h: number) => createChart(el, {
      layout: { background: { type: ColorType.Solid, color: C.card }, textColor: C.text },
      grid: { vertLines: { color: C.border }, horzLines: { color: C.border } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.border, textColor: C.text },
      timeScale: { borderColor: C.border, timeVisible: true, secondsVisible: false },
      width: el.clientWidth,
      height: h,
      localization: {
        priceFormatter: (p: number) => isKR ? `₩${p.toLocaleString("ko-KR")}` : `$${p.toFixed(2)}`,
        timeFormatter: (t: number) => {
          const d = new Date(t * 1000);
          const date = `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}`;
          const hours = d.getHours(), mins = d.getMinutes();
          if (hours === 0 && mins === 0) return date;
          return `${date} ${String(hours).padStart(2,"0")}:${String(mins).padStart(2,"0")}`;
        },
      },
    });

    // 기존 차트 제거
    try { chartRef.current?.remove(); } catch {}
    overlayRef.current.clear();

    mainRef.current.innerHTML = "";
    const main = mkChart(mainRef.current, height);
    chartRef.current = main;

    main.priceScale("right").applyOptions({
      mode: logScaleRef.current ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });

    const ct = (d: { time?: string | number; date: string }) => (d.time !== undefined ? d.time : d.date) as any;

    // 메인 시리즈
    if (chartType === "line") {
      const s = main.addLineSeries({ color: C.blue, lineWidth: 2, priceLineVisible: true, lastValueVisible: true, crosshairMarkerVisible: true, crosshairMarkerRadius: 4 });
      s.setData(ohlcv.map(d => ({ time: ct(d), value: d.close })));
    } else if (chartType === "area") {
      const s = main.addAreaSeries({ lineColor: C.blue, topColor: C.blue+"40", bottomColor: C.blue+"00", lineWidth: 2, priceLineVisible: true, lastValueVisible: true });
      s.setData(ohlcv.map(d => ({ time: ct(d), value: d.close })));
    } else {
      const s = main.addCandlestickSeries({ upColor: C.green, downColor: C.red, borderUpColor: C.green, borderDownColor: C.red, wickUpColor: C.green, wickDownColor: C.red });
      s.setData(ohlcv.map(d => ({ time: ct(d), open: d.open, high: d.high, low: d.low, close: d.close })));
    }

    // 현재 활성화된 오버레이 지표 초기화
    _addOverlayIndicators(main, ohlcv, activeRef.current, overlayRef.current);

    main.timeScale().fitContent();

    // 서브 패널 재생성
    _rebuildSubPanels(ohlcv, main, activeRef.current, rsiRef, macdRef, stRef, rsiChartRef, macdChartRef, stChartRef, mkChart);

    const resize = () => {
      main.applyOptions({ width: mainRef.current?.clientWidth ?? 800 });
    };
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      try { main.remove(); } catch {}
      try { rsiChartRef.current?.remove(); }  catch {}
      try { macdChartRef.current?.remove(); } catch {}
      try { stChartRef.current?.remove(); }   catch {}
    };
  }, [data, chartType, height, isKR]); // logScale은 Effect 3에서

  /* ── Effect 2: 오버레이 지표 즉시 add/remove (차트 재생성 없음) ── */
  useEffect(() => {
    const main = chartRef.current;
    const ohlcv = ohlcvRef.current;
    if (!main || !ohlcv.length) return;

    const overlayKeys = ["volume","ma5","ma20","ma60","ma120","ma200","ema20","bb"] as const;

    // 제거: 비활성화된 오버레이 시리즈 삭제
    for (const key of overlayKeys) {
      if (!activeIndicators.has(key) && overlayRef.current.has(key)) {
        const series = overlayRef.current.get(key);
        if (Array.isArray(series)) {
          series.forEach(s => { try { main.removeSeries(s); } catch {} });
        } else {
          try { main.removeSeries(series); } catch {}
        }
        overlayRef.current.delete(key);
      }
    }

    // 추가: 신규 활성화된 오버레이 시리즈 생성
    _addOverlayIndicators(main, ohlcv, activeIndicators, overlayRef.current);

    // 서브 패널 (RSI/MACD/Stochastic) 재구성
    const C2 = getThemeColors();
    const mkChart = (el: HTMLDivElement, h: number) => createChart(el, {
      layout: { background: { type: ColorType.Solid, color: C2.card }, textColor: C2.text },
      grid: { vertLines: { color: C2.border }, horzLines: { color: C2.border } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C2.border, textColor: C2.text },
      timeScale: { borderColor: C2.border, timeVisible: true, secondsVisible: false },
      width: (rsiRef.current ?? macdRef.current ?? stRef.current ?? document.body).clientWidth,
      height: h,
    });
    _rebuildSubPanels(ohlcv, main, activeIndicators, rsiRef, macdRef, stRef, rsiChartRef, macdChartRef, stChartRef, mkChart);
  }, [activeIndicators]);

  /* ── Effect 3: 로그 스케일 즉시 적용 ── */
  useEffect(() => {
    chartRef.current?.priceScale("right").applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [logScale]);


  const showRSI  = activeIndicators.has("rsi");
  const showMACD = activeIndicators.has("macd");
  const showST   = activeIndicators.has("stoch");

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-secondary">
        <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide mr-1">지표</span>
        <div className="flex flex-wrap gap-1 flex-1">
          {INDICATORS_DEF.map(({ key, label, color }) => {
            const active = activeIndicators.has(key);
            return (
              <button key={key} onClick={() => toggle(key)}
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                  active ? "text-white border-transparent" : "border-border text-text-muted hover:text-text-primary"
                }`}
                style={active ? { background: color + "bb", borderColor: color } : {}}
              >
                {active && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />}
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={mainRef} className="w-full" />

      {showRSI && (
        <div className="relative">
          <span className="absolute top-1 left-2 z-10 text-2xs text-text-muted font-semibold bg-bg-card px-1 rounded">RSI(14)</span>
          <div ref={rsiRef} className="w-full" />
        </div>
      )}
      {showMACD && (
        <div className="relative">
          <span className="absolute top-1 left-2 z-10 text-2xs text-text-muted font-semibold bg-bg-card px-1 rounded">MACD(12,26,9)</span>
          <div ref={macdRef} className="w-full" />
        </div>
      )}
      {showST && (
        <div className="relative">
          <span className="absolute top-1 left-2 z-10 text-2xs text-text-muted font-semibold bg-bg-card px-1 rounded">Stochastic(14,3)</span>
          <div ref={stRef} className="w-full" />
        </div>
      )}
    </div>
  );
}

/* ── 오버레이 시리즈 추가 헬퍼 ── */
function _addOverlayIndicators(
  main: ReturnType<typeof createChart>,
  ohlcv: ReturnType<typeof preprocessData>,
  active: Set<string>,
  overlayMap: Map<string, any>,
) {
  for (const [key, color] of Object.entries(MA_COLORS)) {
    if (active.has(key) && !overlayMap.has(key)) {
      const period = parseInt(key.slice(2));
      const s = main.addLineSeries({ color, lineWidth: 1 as 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(calcMA(ohlcv, period).map(d => ({ time: d.time as any, value: d.value })));
      overlayMap.set(key, s);
    }
  }
  if (active.has("ema20") && !overlayMap.has("ema20")) {
    const s = main.addLineSeries({ color:"#06b6d4", lineWidth: 1 as 1, lineStyle: LineStyle.Dotted, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false });
    s.setData(calcEMA(ohlcv, 20).map(d => ({ time: d.time as any, value: d.value })));
    overlayMap.set("ema20", s);
  }
  if (active.has("bb") && !overlayMap.has("bb")) {
    const { upper, middle, lower } = calcBB(ohlcv);
    const opt = { color:"#94a3b8", lineWidth: 1 as 1, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false };
    const s1 = main.addLineSeries(opt);
    s1.setData(upper.map(d => ({ time: d.time as any, value: d.value })));
    const s2 = main.addLineSeries({ ...opt, lineStyle: LineStyle.Dashed });
    s2.setData(middle.map(d => ({ time: d.time as any, value: d.value })));
    const s3 = main.addLineSeries(opt);
    s3.setData(lower.map(d => ({ time: d.time as any, value: d.value })));
    overlayMap.set("bb", [s1, s2, s3]);
  }
  if (active.has("volume") && !overlayMap.has("volume")) {
    const vol = main.addHistogramSeries({ priceScaleId:"volume", color:"#3b82f620" });
    main.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(calcVolume(ohlcv).map(d => ({ time: d.time as any, value: d.value, color: d.color })));
    overlayMap.set("volume", vol);
  }
}

/* ── 서브 패널 재구성 헬퍼 ── */
function _rebuildSubPanels(
  ohlcv: any[],
  main: ReturnType<typeof createChart>,
  active: Set<string>,
  rsiRef: React.RefObject<HTMLDivElement>,
  macdRef: React.RefObject<HTMLDivElement>,
  stRef: React.RefObject<HTMLDivElement>,
  rsiChartRef: React.MutableRefObject<any>,
  macdChartRef: React.MutableRefObject<any>,
  stChartRef: React.MutableRefObject<any>,
  mkChart: (el: HTMLDivElement, h: number) => ReturnType<typeof createChart>,
) {
  // RSI
  try { rsiChartRef.current?.remove(); } catch {}
  rsiChartRef.current = null;
  if (active.has("rsi") && rsiRef.current) {
    rsiRef.current.innerHTML = "";
    const c = mkChart(rsiRef.current, 120);
    rsiChartRef.current = c;
    c.addLineSeries({ color:"#f59e0b", lineWidth:1, priceLineVisible:false })
      .setData(calcRSI(ohlcv).map(d => ({ time: d.time as any, value: d.value })));
    c.addLineSeries({ color:"#ef444460", lineWidth:1, lineStyle: LineStyle.Dashed, priceLineVisible:false })
      .setData(ohlcv.slice(14).map((d:any) => ({ time: d.date, value: 70 })));
    c.addLineSeries({ color:"#10b98160", lineWidth:1, lineStyle: LineStyle.Dashed, priceLineVisible:false })
      .setData(ohlcv.slice(14).map((d:any) => ({ time: d.date, value: 30 })));
    c.timeScale().fitContent();
    main.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) c.timeScale().setVisibleLogicalRange(r); });
    c.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) main.timeScale().setVisibleLogicalRange(r); });
  }

  // MACD
  try { macdChartRef.current?.remove(); } catch {}
  macdChartRef.current = null;
  if (active.has("macd") && macdRef.current) {
    macdRef.current.innerHTML = "";
    const c = mkChart(macdRef.current, 100);
    macdChartRef.current = c;
    const { macdLine, signalLine, histogram } = calcMACD(ohlcv);
    c.addHistogramSeries({ color:"#3b82f640", priceLineVisible:false })
      .setData(histogram.map(d => ({ time: d.time as any, value: d.value, color: d.value >= 0 ? "#10b98160" : "#ef444460" })));
    c.addLineSeries({ color:"#3b82f6", lineWidth:1, priceLineVisible:false })
      .setData(macdLine.map(d => ({ time: d.time as any, value: d.value })));
    c.addLineSeries({ color:"#f59e0b", lineWidth:1, priceLineVisible:false })
      .setData(signalLine.map(d => ({ time: d.time as any, value: d.value })));
    c.timeScale().fitContent();
    main.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) c.timeScale().setVisibleLogicalRange(r); });
    c.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) main.timeScale().setVisibleLogicalRange(r); });
  }

  // Stochastic
  try { stChartRef.current?.remove(); } catch {}
  stChartRef.current = null;
  if (active.has("stoch") && stRef.current) {
    stRef.current.innerHTML = "";
    const c = mkChart(stRef.current, 100);
    stChartRef.current = c;
    const { kLine, dLine } = calcStochastic(ohlcv);
    c.addLineSeries({ color:"#10b981", lineWidth:1, priceLineVisible:false })
      .setData(kLine.map(d => ({ time: d.time as any, value: d.value })));
    c.addLineSeries({ color:"#f59e0b", lineWidth:1, priceLineVisible:false })
      .setData(dLine.map(d => ({ time: d.time as any, value: d.value })));
    c.timeScale().fitContent();
    main.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) c.timeScale().setVisibleLogicalRange(r); });
    c.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) main.timeScale().setVisibleLogicalRange(r); });
  }
}
