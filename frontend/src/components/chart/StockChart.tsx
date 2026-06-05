import { useEffect, useRef, useState, useCallback } from "react";
import { createChart, ColorType, CrosshairMode, LineStyle, PriceScaleMode } from "lightweight-charts";
import { Settings, Plus, X } from "lucide-react";
import {
  calcMA, calcEMA, calcBB, calcRSI, calcMACD, calcStochastic, calcVolume,
  calcCCI, calcATR, calcOBV, calcWilliams, OHLCV,
} from "./indicators";

/* ── 내보내기 (StockDetail에서 사용) ────────────────────── */
export const CANDLE_TYPES = [
  { label: "1분",   value: "1m"  }, { label: "2분",   value: "2m"  },
  { label: "5분",   value: "5m"  }, { label: "15분",  value: "15m" },
  { label: "30분",  value: "30m" }, { label: "60분",  value: "60m" },
  { label: "90분",  value: "90m" }, { label: "일봉",  value: "1d"  },
  { label: "5일봉", value: "5d"  }, { label: "주봉",  value: "1wk" },
  { label: "월봉",  value: "1mo" }, { label: "3월봉", value: "3mo" },
  { label: "연봉",  value: "1y"  },
] as const;

export const CANDLE_GROUPS = [
  { label: "분", key: "min", options: [
    { label: "1분",  value: "1m"  }, { label: "2분",  value: "2m"  },
    { label: "5분",  value: "5m"  }, { label: "15분", value: "15m" },
    { label: "30분", value: "30m" }, { label: "60분", value: "60m" },
    { label: "90분", value: "90m" },
  ]},
  { label: "일", key: "day", options: [
    { label: "1일봉",  value: "1d"  }, { label: "3일봉",  value: "3d"  },
    { label: "5일봉",  value: "5d"  }, { label: "10일봉", value: "10d" },
    { label: "30일봉", value: "30d" }, { label: "60일봉", value: "60d" },
  ]},
  { label: "주",  key: "week",  options: [{ label: "1주봉", value: "1wk" }] },
  { label: "월",  key: "month", options: [{ label: "1월봉", value: "1mo" }, { label: "3월봉", value: "3mo" }] },
  { label: "년",  key: "year",  options: [{ label: "1년봉", value: "1y"  }] },
] as const;

export const PERIOD_BY_CANDLE: Record<string, { label: string; value: string }[]> = {
  "1m":  [{ label:"1일",value:"1d" },{ label:"5일",value:"5d" }],
  "2m":  [{ label:"1일",value:"1d" },{ label:"5일",value:"5d" }],
  "5m":  [{ label:"5일",value:"5d" },{ label:"1달",value:"1mo" }],
  "15m": [{ label:"5일",value:"5d" },{ label:"1달",value:"1mo" },{ label:"3달",value:"3mo" }],
  "30m": [{ label:"1달",value:"1mo" },{ label:"3달",value:"3mo" },{ label:"6달",value:"6mo" }],
  "60m": [{ label:"1달",value:"1mo" },{ label:"3달",value:"3mo" },{ label:"6달",value:"6mo" },{ label:"1년",value:"1y" }],
  "90m": [{ label:"1달",value:"1mo" },{ label:"3달",value:"3mo" },{ label:"6달",value:"6mo" }],
  "1d":  [{ label:"1달",value:"1mo" },{ label:"3달",value:"3mo" },{ label:"6달",value:"6mo" },{ label:"1년",value:"1y" },{ label:"2년",value:"2y" },{ label:"3년",value:"3y" },{ label:"5년",value:"5y" },{ label:"10년",value:"10y" },{ label:"최대",value:"max" }],
  "5d":  [{ label:"1년",value:"1y" },{ label:"2년",value:"2y" },{ label:"5년",value:"5y" },{ label:"10년",value:"10y" },{ label:"최대",value:"max" }],
  "1wk": [{ label:"1년",value:"1y" },{ label:"2년",value:"2y" },{ label:"3년",value:"3y" },{ label:"5년",value:"5y" },{ label:"10년",value:"10y" },{ label:"최대",value:"max" }],
  "1mo": [{ label:"2년",value:"2y" },{ label:"5년",value:"5y" },{ label:"10년",value:"10y" },{ label:"최대",value:"max" }],
  "3mo": [{ label:"5년",value:"5y" },{ label:"10년",value:"10y" },{ label:"최대",value:"max" }],
  "1y":  [{ label:"10년",value:"10y" },{ label:"최대",value:"max" }],
};

export const CANDLE_MAX_PERIOD: Record<string, string> = {
  "1m":"5d","2m":"60d","5m":"60d","15m":"60d","30m":"60d","60m":"2y","90m":"60d",
  "1d":"max","3d":"max","5d":"max","10d":"max","30d":"max","60d":"max",
  "1wk":"max","1mo":"max","3mo":"max","1y":"max",
};

export const MAX_PERIOD_BY_CANDLE = CANDLE_MAX_PERIOD;

export const CANDLE_DEFAULT_PERIOD: Record<string, string> = {
  "1m":"1d","2m":"1d","5m":"5d","15m":"1mo","30m":"1mo","60m":"3mo","90m":"1mo",
  "1d":"max","3d":"max","5d":"max","10d":"max","30d":"max","60d":"max",
  "1wk":"max","1mo":"max","3mo":"max","1y":"max",
};

/* ── 지표 설정 타입 ─────────────────────────────────────── */
export interface ChartSettings {
  volume:  boolean;
  mas:     { period: number; color: string }[];
  emas:    { period: number; color: string }[];
  bb:      boolean; bbPeriod: number; bbMult: number;
  rsi:     boolean; rsiPeriod: number;
  macd:    boolean; macdFast: number; macdSlow: number; macdSignal: number;
  stoch:   boolean; stochK: number; stochD: number;
  cci:     boolean; cciPeriod: number;
  atr:     boolean; atrPeriod: number;
  obv:     boolean;
  williams:boolean; williamsPeriod: number;
}

const MA_PALETTE = ["#f59e0b","#3b82f6","#8b5cf6","#10b981","#ef4444","#06b6d4","#ec4899","#14b8a6","#f97316","#6366f1"];

const DEFAULT_SETTINGS: ChartSettings = {
  volume: true,
  mas: [{ period: 20, color: MA_PALETTE[1] }, { period: 60, color: MA_PALETTE[2] }],
  emas: [],
  bb: false, bbPeriod: 20, bbMult: 2,
  rsi: false,  rsiPeriod: 14,
  macd: false, macdFast: 12, macdSlow: 26, macdSignal: 9,
  stoch: false, stochK: 14, stochD: 3,
  cci: false,  cciPeriod: 20,
  atr: false,  atrPeriod: 14,
  obv: false,
  williams: false, williamsPeriod: 14,
};

const STORAGE_KEY = "stkplt_chart_v2";

function loadSettings(): ChartSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_SETTINGS };
}
function saveSettings(s: ChartSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

/* ── 차트 색상 ──────────────────────────────────────────── */
function getThemeColors() {
  const isLight = typeof document !== "undefined" && document.documentElement.classList.contains("light");
  return {
    card:   isLight ? "#ffffff" : "#1a1f2e",
    border: isLight ? "#cbd5e1" : "#232840",
    green:  "#10b981", red: "#ef4444",
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
  return data.filter(d => d.close > 0).map(d => {
    const raw = d.date.replace(/^(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
    const isIntraday = raw.length > 10;
    const time = isIntraday
      ? Math.floor(new Date(raw.replace(" ", "T")).getTime() / 1000)
      : raw.slice(0, 10);
    return { ...d, date: raw.slice(0, 10), time };
  });
}

/* ── 설정 패널 컴포넌트 ──────────────────────────────────── */
function SettingsPanel({ settings, onChange, onClose }: {
  settings: ChartSettings;
  onChange: (s: ChartSettings) => void;
  onClose: () => void;
}) {
  const set = (patch: Partial<ChartSettings>) => onChange({ ...settings, ...patch });
  const [activeTab, setActiveTab] = useState<"trend" | "momentum" | "volatility" | "volume">("trend");

  const addMA = () => {
    const usedColors = settings.mas.map(m => m.color);
    const color = MA_PALETTE.find(c => !usedColors.includes(c)) ?? MA_PALETTE[0];
    set({ mas: [...settings.mas, { period: 10, color }] });
  };
  const removeMA = (i: number) => set({ mas: settings.mas.filter((_, j) => j !== i) });
  const updateMA = (i: number, period: number) =>
    set({ mas: settings.mas.map((m, j) => j === i ? { ...m, period } : m) });

  const addEMA = () => {
    const usedColors = settings.emas.map(e => e.color);
    const color = MA_PALETTE.find(c => !usedColors.includes(c)) ?? MA_PALETTE[5];
    set({ emas: [...settings.emas, { period: 20, color }] });
  };
  const removeEMA = (i: number) => set({ emas: settings.emas.filter((_, j) => j !== i) });
  const updateEMA = (i: number, period: number) =>
    set({ emas: settings.emas.map((e, j) => j === i ? { ...e, period } : e) });

  const NumInput = ({ label, value, onChange: oc, min = 1, max = 500 }: {
    label: string; value: number; onChange: (v: number) => void; min?: number; max?: number;
  }) => {
    const [localVal, setLocalVal] = useState(String(value));
    useEffect(() => { setLocalVal(String(value)); }, [value]);
    const commit = useCallback(() => {
      const parsed = parseInt(localVal, 10);
      const clamped = isNaN(parsed) ? min : Math.max(min, Math.min(max, parsed));
      setLocalVal(String(clamped));
      oc(clamped);
    }, [localVal, min, max, oc]);
    return (
      <label className="flex items-center gap-2 text-xs">
        <span className="text-text-muted w-20 flex-shrink-0">{label}</span>
        <input
          type="number" min={min} max={max} value={localVal}
          onChange={e => setLocalVal(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); }}
          className="w-16 bg-bg-primary border border-border rounded px-2 py-0.5 text-text-primary font-mono text-center focus:outline-none focus:border-accent-blue"
        />
      </label>
    );
  };

  const Toggle = ({ label, checked, onToggle, color }: { label: string; checked: boolean; onToggle: () => void; color?: string }) => (
    <button onClick={onToggle}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all ${
        checked ? "text-white border-transparent" : "border-border text-text-muted hover:text-text-primary"
      }`}
      style={checked ? { background: (color ?? "#3b82f6") + "cc", borderColor: color ?? "#3b82f6" } : {}}
    >{label}</button>
  );

  return (
    <div className="border-t border-border bg-bg-secondary flex flex-col max-h-[70vh] overflow-y-auto">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
        <span className="text-xs font-bold text-text-primary uppercase tracking-widest">지표 설정</span>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={14}/></button>
      </div>

      {/* 탭 버튼 */}
      <div className="w-full grid grid-cols-4 border-b border-border flex-shrink-0">
        {([
          { key: "trend",      label: "추세" },
          { key: "momentum",   label: "모멘텀" },
          { key: "volatility", label: "변동성" },
          { key: "volume",     label: "거래량분석" },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`py-2 text-xs font-semibold transition-all border-b-2 -mb-px ${
              activeTab === tab.key
                ? "border-accent-blue text-accent-blue bg-accent-blue/5"
                : "border-transparent text-text-muted hover:text-text-primary"
            }`}
          >{tab.label}</button>
        ))}
      </div>

      {/* 탭 컨텐츠 */}
      <div className="px-4 py-3 flex flex-col gap-3">

        {/* ── 탭1: 추세 ── */}
        {activeTab === "trend" && (
          <>
            {/* 거래량 */}
            <div className="flex flex-col gap-2">
              <span className="text-2xs font-semibold text-text-muted uppercase tracking-wide border-b border-border pb-1">거래량</span>
              <Toggle label="거래량" checked={settings.volume} onToggle={() => set({ volume: !settings.volume })} color="#3b82f6"/>
            </div>

            {/* MA */}
            <div className="flex flex-col gap-1.5">
              <span className="text-2xs font-semibold text-text-muted uppercase tracking-wide border-b border-border pb-1">이동평균선 (MA)</span>
              <div className="flex items-center justify-end">
                <button onClick={addMA} className="flex items-center gap-1 text-2xs text-accent-blue hover:text-blue-400">
                  <Plus size={11}/>추가
                </button>
              </div>
              {settings.mas.map((m, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: m.color }}/>
                  <input type="number" min={2} max={500} value={m.period}
                    onChange={e => updateMA(i, parseInt(e.target.value) || 2)}
                    className="w-16 bg-bg-primary border border-border rounded px-2 py-0.5 text-text-primary font-mono text-center text-xs focus:outline-none focus:border-accent-blue"
                  />
                  <span className="text-2xs text-text-muted">기간</span>
                  <button onClick={() => removeMA(i)} className="ml-auto text-text-dim hover:text-accent-red"><X size={12}/></button>
                </div>
              ))}
            </div>

            {/* EMA */}
            <div className="flex flex-col gap-1.5">
              <span className="text-2xs font-semibold text-text-muted uppercase tracking-wide border-b border-border pb-1">지수이동평균 (EMA)</span>
              <div className="flex items-center justify-end">
                <button onClick={addEMA} className="flex items-center gap-1 text-2xs text-accent-blue hover:text-blue-400">
                  <Plus size={11}/>추가
                </button>
              </div>
              {settings.emas.map((e, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: e.color }}/>
                  <input type="number" min={2} max={500} value={e.period}
                    onChange={ev => updateEMA(i, parseInt(ev.target.value) || 2)}
                    className="w-16 bg-bg-primary border border-border rounded px-2 py-0.5 text-text-primary font-mono text-center text-xs focus:outline-none focus:border-accent-blue"
                  />
                  <span className="text-2xs text-text-muted">기간</span>
                  <button onClick={() => removeEMA(i)} className="ml-auto text-text-dim hover:text-accent-red"><X size={12}/></button>
                </div>
              ))}
            </div>

            {/* 볼린저밴드 */}
            <div className="flex flex-col gap-1.5">
              <span className="text-2xs font-semibold text-text-muted uppercase tracking-wide border-b border-border pb-1">볼린저밴드</span>
              <Toggle label="볼린저밴드" checked={settings.bb} onToggle={() => set({ bb: !settings.bb })} color="#94a3b8"/>
              {settings.bb && (
                <div className="pl-2 flex flex-col gap-1">
                  <NumInput label="기간" value={settings.bbPeriod} onChange={v => set({ bbPeriod: v })}/>
                  <NumInput label="표준편차" value={settings.bbMult} onChange={v => set({ bbMult: v })} min={1} max={5}/>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── 탭2: 모멘텀 ── */}
        {activeTab === "momentum" && (
          <>
            {/* RSI */}
            <div className="flex flex-col gap-1.5">
              <Toggle label="RSI" checked={settings.rsi} onToggle={() => set({ rsi: !settings.rsi })} color="#f59e0b"/>
              {settings.rsi && <div className="pl-2"><NumInput label="기간" value={settings.rsiPeriod} onChange={v => set({ rsiPeriod: v })}/></div>}
            </div>

            {/* MACD */}
            <div className="flex flex-col gap-1.5">
              <Toggle label="MACD" checked={settings.macd} onToggle={() => set({ macd: !settings.macd })} color="#3b82f6"/>
              {settings.macd && (
                <div className="pl-2 flex flex-col gap-1">
                  <NumInput label="단기(Fast)" value={settings.macdFast} onChange={v => set({ macdFast: v })}/>
                  <NumInput label="장기(Slow)" value={settings.macdSlow} onChange={v => set({ macdSlow: v })}/>
                  <NumInput label="시그널" value={settings.macdSignal} onChange={v => set({ macdSignal: v })}/>
                </div>
              )}
            </div>

            {/* 스토캐스틱 */}
            <div className="flex flex-col gap-1.5">
              <Toggle label="스토캐스틱" checked={settings.stoch} onToggle={() => set({ stoch: !settings.stoch })} color="#10b981"/>
              {settings.stoch && (
                <div className="pl-2 flex flex-col gap-1">
                  <NumInput label="%K 기간" value={settings.stochK} onChange={v => set({ stochK: v })}/>
                  <NumInput label="%D 기간" value={settings.stochD} onChange={v => set({ stochD: v })}/>
                </div>
              )}
            </div>

            {/* CCI */}
            <div className="flex flex-col gap-1.5">
              <Toggle label="CCI" checked={settings.cci} onToggle={() => set({ cci: !settings.cci })} color="#ec4899"/>
              {settings.cci && <div className="pl-2"><NumInput label="기간" value={settings.cciPeriod} onChange={v => set({ cciPeriod: v })}/></div>}
            </div>

            {/* Williams %R */}
            <div className="flex flex-col gap-1.5">
              <Toggle label="Williams %R" checked={settings.williams} onToggle={() => set({ williams: !settings.williams })} color="#14b8a6"/>
              {settings.williams && <div className="pl-2"><NumInput label="기간" value={settings.williamsPeriod} onChange={v => set({ williamsPeriod: v })}/></div>}
            </div>
          </>
        )}

        {/* ── 탭3: 변동성 ── */}
        {activeTab === "volatility" && (
          <div className="flex flex-col gap-1.5">
            <Toggle label="ATR" checked={settings.atr} onToggle={() => set({ atr: !settings.atr })} color="#f97316"/>
            {settings.atr && <div className="pl-2"><NumInput label="기간" value={settings.atrPeriod} onChange={v => set({ atrPeriod: v })}/></div>}
          </div>
        )}

        {/* ── 탭4: 거래량분석 ── */}
        {activeTab === "volume" && (
          <Toggle label="OBV (누적거래량)" checked={settings.obv} onToggle={() => set({ obv: !settings.obv })} color="#6366f1"/>
        )}

      </div>
    </div>
  );
}

/* ── 메인 컴포넌트 ──────────────────────────────────────── */
export default function StockChart({ data, height = 400, isKR = false, chartType = "candle", logScale = false }: Props) {
  const mainRef = useRef<HTMLDivElement>(null);
  const rsiRef  = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const stRef   = useRef<HTMLDivElement>(null);
  const cciRef  = useRef<HTMLDivElement>(null);
  const atrRef  = useRef<HTMLDivElement>(null);
  const obvRef  = useRef<HTMLDivElement>(null);
  const wrRef   = useRef<HTMLDivElement>(null);

  const chartRef     = useRef<ReturnType<typeof createChart> | null>(null);
  const subRefs      = useRef<Map<string, ReturnType<typeof createChart>>>(new Map());
  const overlayRef   = useRef<Map<string, any>>(new Map());
  const ohlcvRef     = useRef<ReturnType<typeof preprocessData>>([]);
  const logScaleRef  = useRef(logScale);
  logScaleRef.current = logScale;

  const [settings, setSettingsState] = useState<ChartSettings>(() => loadSettings());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [showSettings, setShowSettings] = useState(false);

  const updateSettings = (s: ChartSettings) => {
    setSettingsState(s);
    saveSettings(s);
  };

  /* ── 시간 범위 동기화 (논리 인덱스 아닌 시간 기반) ── */
  function syncByTime(main: ReturnType<typeof createChart>, sub: ReturnType<typeof createChart>) {
    const applyRange = () => {
      const r = main.timeScale().getVisibleRange();
      if (r) {
        try { sub.timeScale().setVisibleRange(r as any); } catch {}
      }
    };
    applyRange();
    main.timeScale().subscribeVisibleTimeRangeChange(() => applyRange());
    sub.timeScale().subscribeVisibleTimeRangeChange(() => {
      const r = sub.timeScale().getVisibleRange();
      if (r) try { main.timeScale().setVisibleRange(r as any); } catch {}
    });
  }

  /* ── 차트 전체 재생성 ─────────────────────────────────── */
  useEffect(() => {
    if (!mainRef.current || !data.length) return;
    const C = getThemeColors();
    const ohlcv = preprocessData(data);
    ohlcvRef.current = ohlcv;
    const s = settingsRef.current;

    const mkChart = (el: HTMLDivElement, h: number) => createChart(el, {
      layout: { background: { type: ColorType.Solid, color: C.card }, textColor: C.text },
      grid: { vertLines: { color: C.border }, horzLines: { color: C.border } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.border, textColor: C.text },
      timeScale: {
        borderColor: C.border,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: any) => {
          try {
            const d = typeof time === "number" ? new Date(time * 1000) : new Date(time as string);
            return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}`;
          } catch { return ""; }
        },
      },
      // 스크롤 중 의도치 않은 확대 방지
      handleScale: {
        mouseWheel: true,          // 마우스 휠로만 줌 허용
        pinch: true,               // 모바일 핀치 줌 활성화
        axisPressedMouseMove: {
          time: false,             // 시간축 드래그 줌 비활성화 (우→좌 드래그 확대 제거)
          price: true,             // 가격축 드래그 줌 활성화
        },
        axisDoubleClickReset: true,
      },
      handleScroll: {
        mouseWheel: false,         // 마우스 휠로 스크롤 대신 줌만 사용
        pressedMouseMove: true,    // 마우스 드래그 스크롤
        horzTouchDrag: true,       // 터치 수평 스크롤
        vertTouchDrag: false,      // 터치 수직 스크롤 비활성화 (페이지 스크롤 우선)
      },
      width: el.clientWidth,
      height: h,
      localization: {
        priceFormatter: (p: number) => isKR ? `₩${p.toLocaleString("ko-KR")}` : `$${p.toFixed(2)}`,
      },
    });

    // 기존 차트 제거
    try { chartRef.current?.remove(); } catch {}
    subRefs.current.forEach(c => { try { c.remove(); } catch {} });
    subRefs.current.clear();
    overlayRef.current.clear();

    mainRef.current.innerHTML = "";
    const main = mkChart(mainRef.current, height);
    chartRef.current = main;
    main.priceScale("right").applyOptions({
      mode: logScaleRef.current ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });

    const ct = (d: any) => (d.time !== undefined ? d.time : d.date) as any;

    // 메인 시리즈
    if (chartType === "line") {
      main.addLineSeries({ color: C.blue, lineWidth: 2 }).setData(ohlcv.map(d => ({ time: ct(d), value: d.close })));
    } else if (chartType === "area") {
      main.addAreaSeries({ lineColor: C.blue, topColor: C.blue+"40", bottomColor: C.blue+"00", lineWidth: 2 }).setData(ohlcv.map(d => ({ time: ct(d), value: d.close })));
    } else {
      main.addCandlestickSeries({ upColor: C.green, downColor: C.red, borderUpColor: C.green, borderDownColor: C.red, wickUpColor: C.green, wickDownColor: C.red })
        .setData(ohlcv.map(d => ({ time: ct(d), open: d.open, high: d.high, low: d.low, close: d.close })));
    }

    // 거래량
    if (s.volume) {
      const vol = main.addHistogramSeries({ priceScaleId: "volume", color: "#3b82f620" });
      main.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(calcVolume(ohlcv).map(d => ({ time: d.time as any, value: d.value, color: d.color })));
      overlayRef.current.set("volume", vol);
    }

    // MA 라인들
    s.mas.forEach((m, i) => {
      const line = main.addLineSeries({ color: m.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      line.setData(calcMA(ohlcv, m.period).map(d => ({ time: d.time as any, value: d.value })));
      overlayRef.current.set(`ma_${i}`, line);
    });

    // EMA 라인들
    s.emas.forEach((e, i) => {
      const line = main.addLineSeries({ color: e.color, lineWidth: 1, lineStyle: LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      line.setData(calcEMA(ohlcv, e.period).map(d => ({ time: d.time as any, value: d.value })));
      overlayRef.current.set(`ema_${i}`, line);
    });

    // 볼린저밴드
    if (s.bb) {
      const { upper, middle, lower } = calcBB(ohlcv, s.bbPeriod, s.bbMult);
      const bopt = { color: "#94a3b8", lineWidth: 1 as 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
      main.addLineSeries(bopt).setData(upper.map(d => ({ time: d.time as any, value: d.value })));
      main.addLineSeries({ ...bopt, lineStyle: LineStyle.Dashed }).setData(middle.map(d => ({ time: d.time as any, value: d.value })));
      main.addLineSeries(bopt).setData(lower.map(d => ({ time: d.time as any, value: d.value })));
    }

    main.timeScale().fitContent();
    // 기본 100봉 표시 (마우스 휠/드래그로 확대·축소 가능)
    if (ohlcv.length > 100) {
      main.timeScale().setVisibleLogicalRange({
        from: ohlcv.length - 100,
        to: ohlcv.length - 1,
      });
    }

    // ── 보조 지표 (하단 패널) — 시간 기반 동기화 ──────────
    const addSub = (ref: React.RefObject<HTMLDivElement>, key: string, h: number, build: (c: ReturnType<typeof createChart>) => void) => {
      if (!ref.current) return;
      ref.current.innerHTML = "";
      const c = mkChart(ref.current, h);
      subRefs.current.set(key, c);
      build(c);
      syncByTime(main, c);
    };

    if (s.rsi) addSub(rsiRef, "rsi", 110, c => {
      c.addLineSeries({ color: "#f59e0b", lineWidth: 1, priceLineVisible: false })
        .setData(calcRSI(ohlcv, s.rsiPeriod).map(d => ({ time: d.time as any, value: d.value })));
      const refData = calcRSI(ohlcv, s.rsiPeriod);
      if (refData.length > 0) {
        c.addLineSeries({ color: "#ef444460", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false })
          .setData(refData.map(d => ({ time: d.time as any, value: 70 })));
        c.addLineSeries({ color: "#10b98160", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false })
          .setData(refData.map(d => ({ time: d.time as any, value: 30 })));
      }
    });

    if (s.macd) addSub(macdRef, "macd", 90, c => {
      const { macdLine, signalLine, histogram } = calcMACD(ohlcv, s.macdFast, s.macdSlow, s.macdSignal);
      c.addHistogramSeries({ color: "#3b82f640", priceLineVisible: false })
        .setData(histogram.map(d => ({ time: d.time as any, value: d.value, color: d.value >= 0 ? "#10b98160" : "#ef444460" })));
      c.addLineSeries({ color: "#3b82f6", lineWidth: 1, priceLineVisible: false }).setData(macdLine.map(d => ({ time: d.time as any, value: d.value })));
      c.addLineSeries({ color: "#f59e0b", lineWidth: 1, priceLineVisible: false }).setData(signalLine.map(d => ({ time: d.time as any, value: d.value })));
    });

    if (s.stoch) addSub(stRef, "stoch", 90, c => {
      const { kLine, dLine } = calcStochastic(ohlcv, s.stochK, s.stochD);
      c.addLineSeries({ color: "#10b981", lineWidth: 1, priceLineVisible: false }).setData(kLine.map(d => ({ time: d.time as any, value: d.value })));
      c.addLineSeries({ color: "#f59e0b", lineWidth: 1, priceLineVisible: false }).setData(dLine.map(d => ({ time: d.time as any, value: d.value })));
    });

    if (s.cci) addSub(cciRef, "cci", 90, c => {
      const data_ = calcCCI(ohlcv, s.cciPeriod);
      c.addLineSeries({ color: "#ec4899", lineWidth: 1, priceLineVisible: false }).setData(data_.map(d => ({ time: d.time as any, value: d.value })));
      if (data_.length > 0) {
        const t100 = data_.map(d => ({ time: d.time as any, value: 100 }));
        const t_100 = data_.map(d => ({ time: d.time as any, value: -100 }));
        c.addLineSeries({ color: "#ef444450", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false }).setData(t100);
        c.addLineSeries({ color: "#10b98150", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false }).setData(t_100);
      }
    });

    if (s.atr) addSub(atrRef, "atr", 90, c => {
      c.addLineSeries({ color: "#f97316", lineWidth: 1, priceLineVisible: false })
        .setData(calcATR(ohlcv, s.atrPeriod).map(d => ({ time: d.time as any, value: d.value })));
    });

    if (s.obv) addSub(obvRef, "obv", 90, c => {
      c.addLineSeries({ color: "#6366f1", lineWidth: 1, priceLineVisible: false })
        .setData(calcOBV(ohlcv).map(d => ({ time: d.time as any, value: d.value })));
    });

    if (s.williams) addSub(wrRef, "williams", 90, c => {
      const data_ = calcWilliams(ohlcv, s.williamsPeriod);
      c.addLineSeries({ color: "#14b8a6", lineWidth: 1, priceLineVisible: false }).setData(data_.map(d => ({ time: d.time as any, value: d.value })));
      if (data_.length > 0) {
        c.addLineSeries({ color: "#ef444450", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false }).setData(data_.map(d => ({ time: d.time as any, value: -20 })));
        c.addLineSeries({ color: "#10b98150", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false }).setData(data_.map(d => ({ time: d.time as any, value: -80 })));
      }
    });

    const resize = () => { main.applyOptions({ width: mainRef.current?.clientWidth ?? 800 }); };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      try { main.remove(); } catch {}
      subRefs.current.forEach(c => { try { c.remove(); } catch {} });
      subRefs.current.clear();
    };
  }, [data, chartType, height, isKR, settings]); // settings 변경 시 전체 재생성

  /* ── 로그스케일 즉시 적용 ─────────────────────────────── */
  useEffect(() => {
    chartRef.current?.priceScale("right").applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [logScale]);

  const s = settings;

  // 활성 지표 요약 텍스트 (버튼 표시용)
  const activeOverlay = [
    s.volume && "거래량",
    ...s.mas.map(m => `MA${m.period}`),
    ...s.emas.map(e => `EMA${e.period}`),
    s.bb && `BB(${s.bbPeriod})`,
  ].filter(Boolean) as string[];
  const activeSub = [
    s.rsi && `RSI(${s.rsiPeriod})`,
    s.macd && `MACD(${s.macdFast},${s.macdSlow},${s.macdSignal})`,
    s.stoch && `Stoch(${s.stochK},${s.stochD})`,
    s.cci && `CCI(${s.cciPeriod})`,
    s.atr && `ATR(${s.atrPeriod})`,
    s.obv && "OBV",
    s.williams && `W%R(${s.williamsPeriod})`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col">
      {/* 지표 바 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-bg-secondary">
        <span className="text-2xs text-text-muted font-semibold uppercase tracking-wide flex-shrink-0">지표</span>
        <div className="flex flex-wrap gap-1 flex-1 overflow-hidden">
          {[...activeOverlay, ...activeSub].map(label => (
            <span key={label} className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-accent-blue/20 text-accent-blue border border-accent-blue/30">
              {label}
            </span>
          ))}
          {activeOverlay.length + activeSub.length === 0 && (
            <span className="text-2xs text-text-dim">지표 없음</span>
          )}
        </div>
        <button onClick={() => setShowSettings(v => !v)}
          className={`p-1.5 rounded-lg border transition-all flex-shrink-0 ${showSettings ? "bg-accent-blue/20 border-accent-blue/50 text-accent-blue" : "border-border text-text-muted hover:text-text-primary hover:bg-bg-elevated"}`}
          title="지표 설정"
        >
          <Settings size={13}/>
        </button>
      </div>

      {/* 설정 패널 */}
      {showSettings && (
        <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setShowSettings(false)}/>
      )}

      {/* 메인 차트 */}
      <div ref={mainRef} className="w-full"/>

      {/* 보조 지표 패널 */}
      {s.rsi && (
        <div className="relative border-t border-border">
          <span className="absolute top-1 left-2 z-10 text-2xs text-text-muted font-semibold bg-bg-card px-1 rounded">RSI({s.rsiPeriod})</span>
          <div ref={rsiRef} className="w-full"/>
        </div>
      )}
      {s.macd && (
        <div className="relative border-t border-border">
          <span className="absolute top-1 left-2 z-10 text-2xs text-text-muted font-semibold bg-bg-card px-1 rounded">MACD({s.macdFast},{s.macdSlow},{s.macdSignal})</span>
          <div ref={macdRef} className="w-full"/>
        </div>
      )}
      {s.stoch && (
        <div className="relative border-t border-border">
          <span className="absolute top-1 left-2 z-10 text-2xs text-text-muted font-semibold bg-bg-card px-1 rounded">Stoch(%K{s.stochK},%D{s.stochD})</span>
          <div ref={stRef} className="w-full"/>
        </div>
      )}
      {s.cci && (
        <div className="relative border-t border-border">
          <span className="absolute top-1 left-2 z-10 text-2xs text-text-muted font-semibold bg-bg-card px-1 rounded">CCI({s.cciPeriod})</span>
          <div ref={cciRef} className="w-full"/>
        </div>
      )}
      {s.atr && (
        <div className="relative border-t border-border">
          <span className="absolute top-1 left-2 z-10 text-2xs text-text-muted font-semibold bg-bg-card px-1 rounded">ATR({s.atrPeriod})</span>
          <div ref={atrRef} className="w-full"/>
        </div>
      )}
      {s.obv && (
        <div className="relative border-t border-border">
          <span className="absolute top-1 left-2 z-10 text-2xs text-text-muted font-semibold bg-bg-card px-1 rounded">OBV</span>
          <div ref={obvRef} className="w-full"/>
        </div>
      )}
      {s.williams && (
        <div className="relative border-t border-border">
          <span className="absolute top-1 left-2 z-10 text-2xs text-text-muted font-semibold bg-bg-card px-1 rounded">Williams%R({s.williamsPeriod})</span>
          <div ref={wrRef} className="w-full"/>
        </div>
      )}
    </div>
  );
}
