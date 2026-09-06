import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { createChart, ColorType, CrosshairMode, LineStyle, PriceScaleMode } from "lightweight-charts";
import { Settings, Plus, X } from "lucide-react";
import {
  calcMA, calcEMA, calcBB, calcRSI, calcMACD, calcStochastic, calcVolume,
  calcCCI, calcATR, calcOBV, calcWilliams, calcVWAP, calcSAR, calcADX, calcROC, calcMFI,
  calcIchimoku, calcFibonacci, OHLCV,
} from "./indicators";
import { 구름시리즈 } from "./CloudSeries";
import { useSettingsStore, type ColorScheme } from "@/store/settingsStore";

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
  vwap:    boolean;
  sar:     boolean; sarStep: number; sarMax: number;
  adx:     boolean; adxPeriod: number;
  roc:     boolean; rocPeriod: number;
  mfi:     boolean; mfiPeriod: number;
  /** 일목균형표 — 다섯 선이 한꺼번에 지지·저항·추세·시점을 말한다.
   *  국내에서 제일 많이 쓰이는 추세 도구인데 없었다 */
  ichimoku: boolean;
  /** 피보나치 되돌림 — **보고 있는 구간**의 고·저로 긋는다.
   *  전체 기간으로 잡으면 3년 전 고점이 이번 달 그래프를 지배해서,
   *  그은 선이 지금 움직임과 아무 상관이 없어진다 */
  fib: boolean;
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
  vwap: false,
  sar: false, sarStep: 0.02, sarMax: 0.2,
  ichimoku: false, fib: false,
  adx: false, adxPeriod: 14,
  roc: false, rocPeriod: 12,
  mfi: false, mfiPeriod: 14,
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
function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getThemeColors(colorScheme: ColorScheme) {
  const isLight = typeof document !== "undefined" && document.documentElement.classList.contains("light");
  // 상승/하락 색상 — 설정의 색상 테마(빨강/파랑 vs 초록/빨강)를 차트에도 동일하게 적용
  const up   = colorScheme === "red-blue" ? "#ef4444" : "#10b981";
  const down = colorScheme === "red-blue" ? "#3b82f6" : "#ef4444";
  return {
    card:   isLight ? "#ffffff" : "#1a1f2e",
    border: isLight ? "#cbd5e1" : "#232840",
    up, down,
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

/* ── NumInput — SettingsPanel 외부에 정의해 리렌더시 재마운트 방지 ── */
function NumInput({ label, value, onChange: oc, min = 1, max = 500 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number; max?: number;
}) {
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
        <button aria-label="닫기" onClick={onClose} className="text-text-muted hover:text-text-primary"><X size={14}/></button>
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
                <button onClick={addMA} className="flex items-center gap-1 text-2xs text-accent-blue hover:text-accent-blue">
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
                  <button aria-label="이동평균선 빼기" onClick={() => removeMA(i)} className="ml-auto text-text-dim hover:text-accent-red"><X size={13}/></button>
                </div>
              ))}
            </div>

            {/* EMA */}
            <div className="flex flex-col gap-1.5">
              <span className="text-2xs font-semibold text-text-muted uppercase tracking-wide border-b border-border pb-1">지수이동평균 (EMA)</span>
              <div className="flex items-center justify-end">
                <button onClick={addEMA} className="flex items-center gap-1 text-2xs text-accent-blue hover:text-accent-blue">
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
                  <button aria-label="지수이동평균선 빼기" onClick={() => removeEMA(i)} className="ml-auto text-text-dim hover:text-accent-red"><X size={13}/></button>
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

            {/* ── 추세 도구 ──
                일목균형표는 국내에서 제일 많이 쓰이는 추세 도구인데
                없었다. 다섯 선이 한꺼번에 지지·저항·추세·시점을 말한다.
                피보나치는 '어디까지 밀릴까' 를 보는 가장 흔한 자다. */}
            <div className="flex flex-col gap-1.5">
              <span className="text-2xs font-semibold text-text-muted uppercase tracking-wide border-b border-border pb-1">추세 도구</span>
              <Toggle label="일목균형표" checked={settings.ichimoku} onToggle={() => set({ ichimoku: !settings.ichimoku })} color="#8b5cf6"/>
              <Toggle label="피보나치 되돌림" checked={settings.fib} onToggle={() => set({ fib: !settings.fib })} color="#f59e0b"/>
            </div>

            {/* VWAP */}
            <div className="flex flex-col gap-1.5">
              <span className="text-2xs font-semibold text-text-muted uppercase tracking-wide border-b border-border pb-1">VWAP</span>
              <Toggle label="VWAP" checked={settings.vwap} onToggle={() => set({ vwap: !settings.vwap })} color="#a78bfa"/>
            </div>

            {/* Parabolic SAR */}
            <div className="flex flex-col gap-1.5">
              <span className="text-2xs font-semibold text-text-muted uppercase tracking-wide border-b border-border pb-1">Parabolic SAR</span>
              <Toggle label="SAR" checked={settings.sar} onToggle={() => set({ sar: !settings.sar })} color="#f43f5e"/>
              {settings.sar && (
                <div className="pl-2 flex flex-col gap-1">
                  <NumInput label="가속계수" value={Math.round(settings.sarStep * 100)} onChange={v => set({ sarStep: v / 100 })} min={1} max={20}/>
                  <NumInput label="최대값" value={Math.round(settings.sarMax * 10)} onChange={v => set({ sarMax: v / 10 })} min={1} max={10}/>
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

            {/* ADX */}
            <div className="flex flex-col gap-1.5">
              <Toggle label="ADX" checked={settings.adx} onToggle={() => set({ adx: !settings.adx })} color="#fb923c"/>
              {settings.adx && <div className="pl-2"><NumInput label="기간" value={settings.adxPeriod} onChange={v => set({ adxPeriod: v })}/></div>}
            </div>

            {/* ROC */}
            <div className="flex flex-col gap-1.5">
              <Toggle label="ROC" checked={settings.roc} onToggle={() => set({ roc: !settings.roc })} color="#34d399"/>
              {settings.roc && <div className="pl-2"><NumInput label="기간" value={settings.rocPeriod} onChange={v => set({ rocPeriod: v })}/></div>}
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
          <div className="flex flex-col gap-3">
            <Toggle label="OBV (누적거래량)" checked={settings.obv} onToggle={() => set({ obv: !settings.obv })} color="#6366f1"/>
            <div className="flex flex-col gap-1.5">
              <Toggle label="MFI (자금흐름지수)" checked={settings.mfi} onToggle={() => set({ mfi: !settings.mfi })} color="#22d3ee"/>
              {settings.mfi && <div className="pl-2"><NumInput label="기간" value={settings.mfiPeriod} onChange={v => set({ mfiPeriod: v })}/></div>}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

/** 십자선이 가리키는 봉 하나. 화면 맨 위 '읽는 줄' 에 그대로 쓴다 */
export interface 읽은봉 {
  날짜: string;
  시가: number; 고가: number; 저가: number; 종가: number;
  거래량: number;
  /** 전날 종가 대비. 첫 봉은 비교할 것이 없어 null */
  등락률: number | null;
  /** 켜 둔 지표들의 그날 값 — 이름 → 값 */
  지표: Record<string, number>;
}

/** 봉 하나를 읽는 줄에 쓸 모양으로. 화면과 떼어 놔야 검사할 수 있다 */
export function 봉읽기(
  봉들: { time?: unknown; date?: unknown; open: number; high: number; low: number; close: number; volume?: number }[],
  칸: number,
  지표: Record<string, number> = {},
): 읽은봉 | null {
  const b = 봉들[칸];
  if (!b) return null;
  const 앞 = 칸 > 0 ? 봉들[칸 - 1] : null;
  const 날 = String(b.time ?? b.date ?? "");
  return {
    날짜: 날.length >= 10 ? 날.slice(0, 10) : 날,
    시가: b.open, 고가: b.high, 저가: b.low, 종가: b.close,
    거래량: b.volume ?? 0,
    /* 첫 봉은 전날이 없다. 0 으로 두면 '안 움직였다' 는 거짓말이 된다 */
    등락률: 앞 && 앞.close ? ((b.close - 앞.close) / 앞.close) * 100 : null,
    지표,
  };
}

/* ── 메인 컴포넌트 ──────────────────────────────────────── */
export default function StockChart({ data, height = 400, isKR = false, chartType = "candle", logScale = false }: Props) {
  const { colorScheme } = useSettingsStore();
  const mainRef = useRef<HTMLDivElement>(null);
  const rsiRef  = useRef<HTMLDivElement>(null);
  const macdRef = useRef<HTMLDivElement>(null);
  const stRef   = useRef<HTMLDivElement>(null);
  const cciRef  = useRef<HTMLDivElement>(null);
  const atrRef  = useRef<HTMLDivElement>(null);
  const obvRef  = useRef<HTMLDivElement>(null);
  const wrRef   = useRef<HTMLDivElement>(null);
  const adxRef  = useRef<HTMLDivElement>(null);
  const rocRef  = useRef<HTMLDivElement>(null);
  const mfiRef  = useRef<HTMLDivElement>(null);

  /** 값 축 너비를 다시 맞추는 함수 — 만들어질 때 채워진다.
   *  크기가 바뀌면(전체보기·회전) 축 너비도 달라지므로 다시 불러야 한다 */
  const 축너비맞추기Ref = useRef<(() => void) | null>(null);
  const chartRef     = useRef<ReturnType<typeof createChart> | null>(null);
  const subRefs      = useRef<Map<string, ReturnType<typeof createChart>>>(new Map());
  const overlayRef   = useRef<Map<string, any>>(new Map());
  const ohlcvRef     = useRef<ReturnType<typeof preprocessData>>([]);
  const logScaleRef  = useRef(logScale);
  logScaleRef.current = logScale;
  /* 높이는 ref 로 읽는다.
     예전에는 height 가 아래 useEffect 의 의존성에 들어 있어서, 1px 만
     바뀌어도 chart.remove() → innerHTML="" → 재생성 이 돌았다. 캔버스가
     비었다 다시 그려지고 fitContent()·보이는 구간까지 초기화돼, 전체화면을
     열 때 화면이 크게 흔들렸다. 높이만 바뀔 때는 아래에서 크기만 바꾼다. */
  const heightRef    = useRef(height);
  heightRef.current  = height;

  const [settings, setSettingsState] = useState<ChartSettings>(() => loadSettings());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const [showSettings, setShowSettings] = useState(false);


  /** 십자선이 가리키는 봉의 값들.
   *
   *  ── 왜 필요한가 ──
   *
   *  지금까지는 값을 **눈으로 어림**해야 했다. 축 눈금 사이에 있는 봉의
   *  종가가 얼마인지, 그날 RSI 가 정확히 몇이었는지 알 방법이 없었다.
   *  전문적인 분석은 거기서 시작한다 — '이 봉에서 RSI 가 30을 깼나' 는
   *  어림으로 답할 수 있는 물음이 아니다.
   *
   *  null 이면 십자선이 차트 밖에 있다는 뜻이다. 그때는 마지막 봉을
   *  보여 준다 — 빈 줄을 두면 그 줄만큼 화면이 들썩인다. */
  const [읽은값, set읽은값] = useState<읽은봉 | null>(null);
  /** 지금 읽고 있는 봉의 시각. 같은 봉이면 다시 그리지 않는다 —
   *  마우스가 1px 움직일 때마다 React 를 다시 돌릴 이유가 없다 */
  const 읽은때Ref = useRef<unknown>(null);
  /** 시각 → 지표값. 칸을 만들 때 같이 채운다 */
  const 지표값Ref = useRef<Map<unknown, Record<string, number>>>(new Map());

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

  // 구조 변경(지표 토글, 서브차트 파라미터, MA/EMA 개수)만 추적 — 전체 재생성 트리거
  const indicatorToggles = useMemo(() => JSON.stringify({
    volume: settings.volume,
    bb: settings.bb, bbPeriod: settings.bbPeriod, bbMult: settings.bbMult,
    vwap: settings.vwap, sar: settings.sar,
    rsi: settings.rsi, rsiPeriod: settings.rsiPeriod,
    macd: settings.macd, macdFast: settings.macdFast, macdSlow: settings.macdSlow, macdSignal: settings.macdSignal,
    stoch: settings.stoch, stochK: settings.stochK, stochD: settings.stochD,
    cci: settings.cci, cciPeriod: settings.cciPeriod,
    atr: settings.atr, atrPeriod: settings.atrPeriod,
    obv: settings.obv,
    williams: settings.williams, williamsPeriod: settings.williamsPeriod,
    adx: settings.adx, adxPeriod: settings.adxPeriod,
    roc: settings.roc, rocPeriod: settings.rocPeriod,
    mfi: settings.mfi, mfiPeriod: settings.mfiPeriod,
    ichimoku: settings.ichimoku, fib: settings.fib,
    masLen: settings.mas.length,
    emasLen: settings.emas.length,
  }), [settings]);

  // MA/EMA 기간·색상만 추적 — 기존 시리즈 데이터만 갱신 (전체 재생성 없음)
  const overlayPeriods = useMemo(() => JSON.stringify({
    mas: settings.mas,
    emas: settings.emas,
  }), [settings.mas, settings.emas]);

  /* ── 차트 전체 재생성 ─────────────────────────────────── */
  useEffect(() => {
    if (!mainRef.current || !data.length) return;
    const C = getThemeColors(colorScheme);
    const ohlcv = preprocessData(data);
    ohlcvRef.current = ohlcv;
    const s = settingsRef.current;

    /** 값 축의 너비를 모든 칸에서 **같게** 맞춘다.
     *
     * 이게 '줄이 안 맞는다' 의 원인이었다. 칸마다 따로 만든 차트라
     * 값 축 너비가 그 칸의 글자 길이대로 정해진다 —
     *
     *   본 차트  "₩2,400,000"  →  넓다
     *   RSI      "70"          →  좁다
     *   MACD     "250,000"     →  중간
     *
     * 축이 넓으면 그림 그리는 자리가 좁아진다. 그래서 세 칸의 시간축이
     * 서로 어긋나고, 같은 날짜가 세로로 안 맞는다. 지표를 보는 이유가
     * '이 봉일 때 RSI 가 얼마였나' 인데 그 세로줄이 안 맞으면 볼 수가 없다.
     *
     * 제일 넓은 축에 나머지를 맞춘다. minimumWidth 는 바닥값이라,
     * 제일 넓은 것을 바닥으로 주면 전부 그 너비가 된다. */
    const 축너비_맞추기 = () => {
      const 칸들 = [chartRef.current, ...subRefs.current.values()].filter(Boolean);
      if (칸들.length < 2) return;
      let 제일넓은 = 0;
      for (const c of 칸들) {
        try { 제일넓은 = Math.max(제일넓은, c!.priceScale("right").width()); } catch { /* 무시 */ }
      }
      if (!(제일넓은 > 0)) return;
      for (const c of 칸들) {
        try { c!.priceScale("right").applyOptions({ minimumWidth: 제일넓은 }); } catch { /* 무시 */ }
      }
    };
    축너비맞추기Ref.current = 축너비_맞추기;

    /** 값 축에 무엇을 적을까.
     *
     * 통화 표기(₩·$)는 **본 차트에만** 붙인다. 예전에는 이 형식이 모든
     * 칸에 걸려서 RSI 가 'W42.734', MACD 가 'W250,000' 으로 나왔다.
     * RSI 는 0~100 짜리 지수지 돈이 아니다 — 단위가 틀리면 그 숫자는
     * 읽는 사람을 속인다.
     *
     * 지표 칸은 그냥 숫자로 적되 자릿수만 다듬는다. OBV 처럼 수천만이
     * 넘는 것도 있고 RSI 처럼 소수점이 필요한 것도 있어서, 크기를 보고
     * 정한다. */
    const 지표숫자 = (v: number) => {
      const 크기 = Math.abs(v);
      if (크기 >= 10_000) return Math.round(v).toLocaleString();
      if (크기 >= 100) return v.toFixed(1);
      return v.toFixed(2);
    };

    const mkChart = (el: HTMLDivElement, h: number, 돈인가 = false) => createChart(el, {
      layout: { background: { type: ColorType.Solid, color: C.card }, textColor: C.text },
      grid: { vertLines: { color: C.border }, horzLines: { color: C.border } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: C.border, textColor: C.text, minimumWidth: 72 },
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
        priceFormatter: (p: number) =>
          돈인가 ? (isKR ? `₩${p.toLocaleString("ko-KR")}` : `$${p.toFixed(2)}`)
                 : 지표숫자(p),
      },
    });

    // 기존 차트 제거
    try { chartRef.current?.remove(); } catch {}
    subRefs.current.forEach(c => { try { c.remove(); } catch {} });
    subRefs.current.clear();
    overlayRef.current.clear();

    mainRef.current.innerHTML = "";
    const main = mkChart(mainRef.current, heightRef.current, true);   // 여기만 돈이다
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
      main.addCandlestickSeries({ upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down })
        .setData(ohlcv.map(d => ({ time: ct(d), open: d.open, high: d.high, low: d.low, close: d.close })));
    }

    // 거래량
    if (s.volume) {
      /** 거래량은 **주식 수**지 돈이 아니다.
       *
       *  차트의 값 형식(localization.priceFormatter)은 그 차트의 모든
       *  시리즈에 걸린다. 본 차트에 얹은 거래량도 그래서 '₩402,164' 로
       *  나왔다 — 402,164주를 40만원으로 읽게 만든다. 지표 칸의 RSI 가
       *  '₩42.734' 로 나오던 것과 같은 뿌리다.
       *
       *  시리즈마다 따로 줄 수 있는 priceFormat 으로 덮는다. 소수점은
       *  없앤다 — 주식은 쪼개서 못 산다(그렇게 세는 시장도 있지만,
       *  화면에 '402,164.00주' 라고 적을 이유는 없다). */
      const vol = main.addHistogramSeries({
        priceScaleId: "volume",
        color: "#3b82f620",
        priceFormat: {
          type: "custom",
          minMove: 1,
          formatter: (v: number) => `${Math.round(v).toLocaleString()}주`,
        },
        /* 값 축에 거래량 뱃지를 안 띄운다.
         *
         * priceFormat 을 줬는데도 '₩402,164' 가 남아 있었다. 거래량은
         * 제 축(overlay)을 쓰는데 그 축이 안 보이는 상태라, 마지막 값
         * 뱃지가 **본 차트의 값 축**에 그 축의 형식(통화)으로 그려진다.
         * 시리즈에 형식을 줘도 그 자리는 안 바뀐다.
         *
         * 애초에 거래량 뱃지를 가격 축에 띄울 이유가 없다 — 증권사
         * 차트도 안 그런다. 거래량은 읽는 줄에 '량 402,164' 로 이미
         * 나온다. 뱃지를 끄면 단위가 틀릴 자리 자체가 없어진다. */
        lastValueVisible: false,
        priceLineVisible: false,
      });
      main.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });
      vol.setData(calcVolume(ohlcv, hexToRgba(C.up, 0.5), hexToRgba(C.down, 0.5)).map(d => ({ time: d.time as any, value: d.value, color: d.color })));
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

    /* ── 일목균형표 ──
       선행스팬은 26봉 **앞으로**, 후행스팬은 26봉 **뒤로** 민다. 그
       옮김이 이 지표의 핵심이라, 그냥 그날 자리에 두면 구름이 미래를
       안 가리키게 되어 뜻이 없어진다(indicators.ts 주석 참조).

       구름(선행A와 B 사이)은 색을 못 채운다 — lightweight-charts 에
       두 선 사이를 메우는 기능이 없다. 두 선을 굵기 다르게 긋고
       범례에 적는 편이, 캔버스를 하나 더 얹어 좌표를 손으로 맞추는
       것보다 안 어긋난다. */
    if (s.ichimoku) {
      const { 전환선, 기준선, 선행A, 선행B, 후행 } = calcIchimoku(ohlcv);

      /* ── 구름을 **먼저** 그린다 ──
         시리즈는 얹은 순서대로 그려진다. 구름을 나중에 얹으면 반투명
         이라도 캔들 위에 덮여 색이 탁해진다. 바탕부터 깔고 선을 위에
         올리는 것이 순서다. */
      const 구름칸 = new Map<unknown, { a?: number; b?: number }>();
      for (const d of 선행A) 구름칸.set(d.time, { ...(구름칸.get(d.time) ?? {}), a: d.value });
      for (const d of 선행B) 구름칸.set(d.time, { ...(구름칸.get(d.time) ?? {}), b: d.value });
      const 구름자료 = ohlcv
        .map((d: any) => {
          const 칸 = 구름칸.get(ct(d));
          return 칸?.a != null && 칸?.b != null
            ? { time: ct(d), a: 칸.a, b: 칸.b }
            : { time: ct(d) };          // 값이 없는 날은 빈칸으로 — 0 으로 채우면 바닥까지 늘어진다
        });
      main.addCustomSeries(new 구름시리즈(), {
        위색: hexToRgba(C.up, 0.14),
        아래색: hexToRgba(C.down, 0.14),
        priceLineVisible: false, lastValueVisible: false,
      } as never).setData(구름자료 as never);

      const 옵 = { lineWidth: 1 as 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
      const 긋기 = (색: string, 값: typeof 전환선, 점선 = false) =>
        main.addLineSeries({ ...옵, color: 색, ...(점선 ? { lineStyle: LineStyle.Dashed } : {}) })
            .setData(값.map(d => ({ time: d.time as any, value: d.value })));
      긋기("#3b82f6", 전환선);                 // 전환선 — 단기 균형
      긋기("#ef4444", 기준선);                 // 기준선 — 중기 균형
      긋기("#10b981", 선행A, true);            // 구름 위쪽
      긋기("#f97316", 선행B, true);            // 구름 아래쪽
      긋기("#94a3b8", 후행);                   // 후행스팬
    }

    /* ── 피보나치 되돌림 ──
       구간을 **보고 있는 화면**에서 잡는다. 전체 기간의 고·저로 잡으면
       3년 전 고점이 이번 달 그래프를 지배해서, 그은 선이 지금 움직임과
       아무 상관이 없어진다. 그래서 화면을 옮기면 다시 긋는다.

       가로줄은 시리즈가 아니라 createPriceLine 으로 긋는다. 시리즈로
       그으면 세로 범위 계산에 끼어들어 캔들이 눌린다 — 자산 흐름에서
       손익 선이 그래프를 찌그러뜨렸던 것과 같은 일이다. */
    if (s.fib) {
      const 기준시리즈 = main.addLineSeries({
        color: "transparent", lastValueVisible: false, priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
      기준시리즈.setData(ohlcv.map((d: any) => ({ time: ct(d), value: d.close })));
      let 그은것: ReturnType<typeof 기준시리즈.createPriceLine>[] = [];
      const 피보긋기 = () => {
        for (const l of 그은것) { try { 기준시리즈.removePriceLine(l); } catch { /* 이미 지워짐 */ } }
        그은것 = [];
        const r = main.timeScale().getVisibleLogicalRange();
        const 처음 = Math.max(0, Math.floor(r?.from ?? 0));
        const 끝 = Math.min(ohlcv.length, Math.ceil(r?.to ?? ohlcv.length) + 1);
        for (const { 비율, value } of calcFibonacci(ohlcv.slice(처음, 끝) as never)) {
          그은것.push(기준시리즈.createPriceLine({
            price: value,
            /* 0%·100% 는 구간의 끝이라 진하게, 사이는 흐리게 —
               다 같은 굵기로 그으면 어디가 기준인지 안 보인다 */
            color: 비율 === 0 || 비율 === 1 ? "#f59e0b" : "#f59e0b70",
            lineWidth: 1,
            lineStyle: 비율 === 0 || 비율 === 1 ? LineStyle.Solid : LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${(비율 * 100).toFixed(1)}%`,
          }));
        }
      };
      피보긋기();
      main.timeScale().subscribeVisibleLogicalRangeChange(() => 피보긋기());
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

    /** 십자선이 읽을 값을 미리 담아 둔다.
     *
     *  마우스가 움직일 때 지표를 다시 계산하면 봉 수천 개짜리 차트에서
     *  손이 미끄러진다. 그릴 때 한 번 계산한 것을 시각으로 찾을 수 있게
     *  넣어 두고, 읽을 때는 찾기만 한다. */
    지표값Ref.current = new Map();
    const 담기 = (이름: string, 값들: { time: unknown; value: number }[]) => {
      for (const d of 값들) {
        const 칸 = 지표값Ref.current.get(d.time) ?? {};
        칸[이름] = d.value;
        지표값Ref.current.set(d.time, 칸);
      }
    };
    s.mas.forEach((m) => 담기(`MA${m.period}`, calcMA(ohlcv, m.period) as never));
    s.emas.forEach((e) => 담기(`EMA${e.period}`, calcEMA(ohlcv, e.period) as never));
    if (s.bb) {
      const { upper, middle, lower } = calcBB(ohlcv, s.bbPeriod, s.bbMult);
      담기("BB상", upper as never); 담기("BB중", middle as never); 담기("BB하", lower as never);
    }
    if (s.vwap) 담기("VWAP", calcVWAP(ohlcv) as never);
    if (s.rsi)  담기(`RSI(${s.rsiPeriod})`, calcRSI(ohlcv, s.rsiPeriod) as never);
    if (s.macd) {
      const { macdLine, signalLine } = calcMACD(ohlcv, s.macdFast, s.macdSlow, s.macdSignal);
      담기("MACD", macdLine as never); 담기("시그널", signalLine as never);
    }
    if (s.stoch) {
      const { kLine, dLine } = calcStochastic(ohlcv, s.stochK, s.stochD);
      담기("%K", kLine as never); 담기("%D", dLine as never);
    }
    if (s.cci)      담기(`CCI(${s.cciPeriod})`, calcCCI(ohlcv, s.cciPeriod) as never);
    if (s.atr)      담기(`ATR(${s.atrPeriod})`, calcATR(ohlcv, s.atrPeriod) as never);
    if (s.williams) 담기(`W%R(${s.williamsPeriod})`, calcWilliams(ohlcv, s.williamsPeriod) as never);
    if (s.mfi)      담기(`MFI(${s.mfiPeriod})`, calcMFI(ohlcv, s.mfiPeriod) as never);
    if (s.roc)      담기(`ROC(${s.rocPeriod})`, calcROC(ohlcv, s.rocPeriod) as never);

    /** 십자선을 따라 읽는다.
     *
     *  같은 봉 위에서 마우스가 움직이는 동안에는 아무것도 안 한다 —
     *  1px 마다 React 를 다시 돌리면 손이 미끄러진다. 봉이 바뀔 때만
     *  한 번 갱신한다. */
    const 시각칸 = new Map<unknown, number>();
    ohlcv.forEach((d: any, i: number) => 시각칸.set(ct(d), i));
    main.subscribeCrosshairMove((param) => {
      const 칸 = param.time === undefined ? -1 : (시각칸.get(param.time) ?? -1);
      if (칸 < 0) {
        /* 차트 밖으로 나갔다. 마지막 봉으로 되돌린다 — 줄을 비우면
           그 줄만큼 화면이 들썩인다 */
        if (읽은때Ref.current !== "끝") {
          읽은때Ref.current = "끝";
          set읽은값(봉읽기(ohlcv as never, ohlcv.length - 1,
                          지표값Ref.current.get(ct(ohlcv[ohlcv.length - 1])) ?? {}));
        }
        return;
      }
      if (읽은때Ref.current === param.time) return;
      읽은때Ref.current = param.time;
      set읽은값(봉읽기(ohlcv as never, 칸, 지표값Ref.current.get(param.time) ?? {}));
    });
    /* 처음에는 마지막 봉을 보여 준다. 마우스를 올리기 전에도 지금 값이
       보여야 한다 — 휴대폰에는 아예 마우스가 없다 */
    읽은때Ref.current = "끝";
    set읽은값(봉읽기(ohlcv as never, ohlcv.length - 1,
                    지표값Ref.current.get(ct(ohlcv[ohlcv.length - 1])) ?? {}));

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

    // VWAP — 메인 차트 오버레이
    if (s.vwap) {
      const line = main.addLineSeries({ color: "#a78bfa", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      line.setData(calcVWAP(ohlcv).map(d => ({ time: d.time as any, value: d.value })));
      overlayRef.current.set("vwap", line);
    }

    // Parabolic SAR — 메인 차트 오버레이 (점선 시리즈)
    if (s.sar) {
      const sarData = calcSAR(ohlcv, s.sarStep, s.sarMax);
      const sarSeries = main.addLineSeries({ color: "#f43f5e", lineWidth: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true, pointMarkersVisible: true } as any);
      sarSeries.setData(sarData.map(d => ({ time: d.time as any, value: d.value })));
      overlayRef.current.set("sar", sarSeries);
    }

    if (s.adx) addSub(adxRef, "adx", 100, c => {
      const { adx, plusDI, minusDI } = calcADX(ohlcv, s.adxPeriod);
      c.addLineSeries({ color: "#fb923c", lineWidth: 2, priceLineVisible: false }).setData(adx.map(d => ({ time: d.time as any, value: d.value })));
      c.addLineSeries({ color: "#22c55e", lineWidth: 1, priceLineVisible: false }).setData(plusDI.map(d => ({ time: d.time as any, value: d.value })));
      c.addLineSeries({ color: "#ef4444", lineWidth: 1, priceLineVisible: false }).setData(minusDI.map(d => ({ time: d.time as any, value: d.value })));
      if (adx.length > 0) {
        c.addLineSeries({ color: "#fb923c40", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false }).setData(adx.map(d => ({ time: d.time as any, value: 25 })));
      }
    });

    if (s.roc) addSub(rocRef, "roc", 90, c => {
      const data_ = calcROC(ohlcv, s.rocPeriod);
      c.addLineSeries({ color: "#34d399", lineWidth: 1, priceLineVisible: false }).setData(data_.map(d => ({ time: d.time as any, value: d.value })));
      if (data_.length > 0) {
        c.addLineSeries({ color: "#94a3b840", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false }).setData(data_.map(d => ({ time: d.time as any, value: 0 })));
      }
    });

    if (s.mfi) addSub(mfiRef, "mfi", 90, c => {
      const data_ = calcMFI(ohlcv, s.mfiPeriod);
      c.addLineSeries({ color: "#22d3ee", lineWidth: 1, priceLineVisible: false }).setData(data_.map(d => ({ time: d.time as any, value: d.value })));
      if (data_.length > 0) {
        c.addLineSeries({ color: "#ef444450", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false }).setData(data_.map(d => ({ time: d.time as any, value: 80 })));
        c.addLineSeries({ color: "#10b98150", lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false }).setData(data_.map(d => ({ time: d.time as any, value: 20 })));
      }
    });

    /* 칸을 다 만든 뒤에 한 번 맞춘다. 축 너비는 글자가 그려져 봐야
       정해지므로, 만드는 도중에 재면 아직 0 이거나 기본값이다.
       다음 프레임에 재는 이유가 그것이다. */
    const 맞추기예약 = requestAnimationFrame(() => 축너비맞추기Ref.current?.());

    const resize = () => {
      main.applyOptions({ width: mainRef.current?.clientWidth ?? 800 });
      subRefs.current.forEach(c => {
        try { c.applyOptions({ width: mainRef.current?.clientWidth ?? 800 }); } catch { /* 무시 */ }
      });
      /* 폭이 바뀌면 축 글자 수도 바뀐다(자릿수가 준다). 다시 맞춘다 —
         안 그러면 전체보기로 열었다 닫을 때마다 줄이 어긋난다 */
      requestAnimationFrame(() => 축너비맞추기Ref.current?.());
    };
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(맞추기예약);
      window.removeEventListener("resize", resize);
      try { main.remove(); } catch {}
      subRefs.current.forEach(c => { try { c.remove(); } catch {} });
      subRefs.current.clear();
    };
  }, [data, chartType, isKR, colorScheme, indicatorToggles]); // eslint-disable-line react-hooks/exhaustive-deps

  /* 높이만 바뀌면 기존 차트를 그대로 두고 크기만 바꾼다.
     부수고 다시 만들면 보고 있던 확대·스크롤 위치까지 초기화된다. */
  useEffect(() => {
    try { chartRef.current?.applyOptions({ height }); } catch { /* 이미 정리됨 */ }
  }, [height]);

  /* ── MA/EMA 기간·색상 증분 업데이트 (전체 재생성 없음) ── */
  useEffect(() => {
    const ohlcv = ohlcvRef.current;
    if (!ohlcv.length) return;
    const s = settingsRef.current;
    s.mas.forEach((m, i) => {
      const series = overlayRef.current.get(`ma_${i}`);
      if (!series) return;
      series.applyOptions({ color: m.color });
      series.setData(calcMA(ohlcv, m.period).map((d: any) => ({ time: d.time as any, value: d.value })));
    });
    s.emas.forEach((e, i) => {
      const series = overlayRef.current.get(`ema_${i}`);
      if (!series) return;
      series.applyOptions({ color: e.color });
      series.setData(calcEMA(ohlcv, e.period).map((d: any) => ({ time: d.time as any, value: d.value })));
    });
  }, [overlayPeriods]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 로그스케일 즉시 적용 ─────────────────────────────── */
  useEffect(() => {
    chartRef.current?.priceScale("right").applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [logScale]);

  const s = settings;

  /** 읽는 줄에 쓸 값 표기 — 축과 같은 규칙이어야 한다.
   *  축은 ₩1,234,000 인데 읽는 줄만 1234000 이면 같은 값이 두 모양이 된다 */
  const 값글 = (v: number) =>
    isKR ? `₩${Math.round(v).toLocaleString("ko-KR")}` : `$${v.toFixed(2)}`;
  /* 오름·내림 색은 설정을 따른다(초록/빨강 · 빨강/파랑). 이 줄만
     못 박아 두면 같은 화면 안에서 빨강이 두 뜻을 갖는다 */
  const 오름클래스 = colorScheme === "red-blue" ? "text-accent-red" : "text-accent-green";
  const 내림클래스 = colorScheme === "red-blue" ? "text-accent-blue" : "text-accent-red";

  // 활성 지표 요약 텍스트 (버튼 표시용)
  const activeOverlay = [
    s.volume && "거래량",
    ...s.mas.map(m => `MA${m.period}`),
    ...s.emas.map(e => `EMA${e.period}`),
    s.bb && `BB(${s.bbPeriod})`,
    s.vwap && "VWAP",
    s.sar && "SAR",
    s.ichimoku && "일목균형표",
    s.fib && "피보나치",
  ].filter(Boolean) as string[];
  const activeSub = [
    s.rsi && `RSI(${s.rsiPeriod})`,
    s.macd && `MACD(${s.macdFast},${s.macdSlow},${s.macdSignal})`,
    s.stoch && `Stoch(${s.stochK},${s.stochD})`,
    s.cci && `CCI(${s.cciPeriod})`,
    s.atr && `ATR(${s.atrPeriod})`,
    s.obv && "OBV",
    s.williams && `W%R(${s.williamsPeriod})`,
    s.adx && `ADX(${s.adxPeriod})`,
    s.roc && `ROC(${s.rocPeriod})`,
    s.mfi && `MFI(${s.mfiPeriod})`,
  ].filter(Boolean) as string[];

  return (
    <div className="flex flex-col">
      {/* 설정 패널 */}
      {showSettings && (
        <SettingsPanel settings={settings} onChange={updateSettings} onClose={() => setShowSettings(false)}/>
      )}

      {/* 메인 차트.
          지표 이름표와 설정 버튼은 차트 위에 겹쳐 얹는다. 예전에는 차트
          위에 줄을 하나 더 뒀는데, 종목상세에는 이미 기간 줄·차트설정 줄이
          있어서 정작 차트가 보이기 전에 컨트롤이 세 줄이었다.
          겹쳐 놓아도 캔들은 아래쪽에 그려지므로 가리지 않는다. */}
      {/* ── 읽는 줄 ──
          십자선이 가리키는 봉의 값을 그대로 적는다.

          지금까지는 값을 **눈으로 어림**해야 했다. 축 눈금 사이에 있는
          봉의 종가가 얼마인지, 그날 RSI 가 정확히 몇이었는지 알 방법이
          없었다. 전문적인 분석은 거기서 시작한다 — '이 봉에서 RSI 가
          30을 깼나' 는 어림으로 답할 수 있는 물음이 아니다.

          차트 위에 겹치지 않고 한 줄을 따로 둔다. 겹쳐 놓으면 왼쪽 위
          봉들을 가리는데, 그 자리가 보통 제일 오래된 구간이라 추세의
          시작점이 안 보인다. */}
      {읽은값 && (
        <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap px-2 py-1.5 text-2xs
                        border-b border-border bg-bg-elevated/40 font-mono tabular-nums"
             data-testid="읽는줄">
          <span className="text-text-muted font-sans">{읽은값.날짜}</span>
          <span className="text-text-dim">시 <b className="text-text-secondary font-semibold">{값글(읽은값.시가)}</b></span>
          <span className="text-text-dim">고 <b className={`font-semibold ${오름클래스}`}>{값글(읽은값.고가)}</b></span>
          <span className="text-text-dim">저 <b className={`font-semibold ${내림클래스}`}>{값글(읽은값.저가)}</b></span>
          <span className="text-text-dim">종 <b className="text-text-primary font-bold">{값글(읽은값.종가)}</b></span>
          {읽은값.등락률 != null && (
            <span className={`font-semibold ${읽은값.등락률 >= 0 ? 오름클래스 : 내림클래스}`}>
              {읽은값.등락률 >= 0 ? "+" : ""}{읽은값.등락률.toFixed(2)}%
            </span>
          )}
          {읽은값.거래량 > 0 && (
            <span className="text-text-dim">량 <b className="text-text-secondary font-semibold">
              {읽은값.거래량.toLocaleString()}</b></span>
          )}
          {/* 켜 둔 지표의 그날 값. 지표를 켜는 이유가 이 숫자다 */}
          {Object.entries(읽은값.지표).map(([이름, v]) => (
            <span key={이름} className="text-text-dim">
              {이름} <b className="text-text-secondary font-semibold">
                {Math.abs(v) >= 10_000 ? Math.round(v).toLocaleString() : v.toFixed(2)}</b>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <div className="absolute top-1.5 left-2 right-2 z-10 flex items-start gap-2 pointer-events-none">
          <div className="flex flex-wrap gap-1 flex-1 overflow-hidden">
            {[...activeOverlay, ...activeSub].map(label => (
              <span key={label} className="px-1.5 py-0.5 rounded text-2xs font-semibold
                                           bg-accent-blue/15 text-accent-blue backdrop-blur-sm">
                {label}
              </span>
            ))}
          </div>
          <button onClick={() => setShowSettings(v => !v)}
            className={`pointer-events-auto p-1.5 rounded-lg backdrop-blur-sm transition-all flex-shrink-0 ${
              showSettings ? "bg-accent-blue/20 text-accent-blue"
                           : "bg-bg-card/70 text-text-muted hover:text-text-primary"}`}
            aria-label="지표 설정" title="지표 설정"
          >
            <Settings size={13}/>
          </button>
        </div>
        <div ref={mainRef} className="w-full"/>
      </div>

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
      {s.adx && (
        <div className="relative border-t border-border">
          <span className="absolute top-1 left-2 z-10 text-2xs text-text-muted font-semibold bg-bg-card px-1 rounded">ADX({s.adxPeriod}) <span className="text-accent-green">+DI</span> <span className="text-accent-red">−DI</span></span>
          <div ref={adxRef} className="w-full"/>
        </div>
      )}
      {s.roc && (
        <div className="relative border-t border-border">
          <span className="absolute top-1 left-2 z-10 text-2xs text-text-muted font-semibold bg-bg-card px-1 rounded">ROC({s.rocPeriod})</span>
          <div ref={rocRef} className="w-full"/>
        </div>
      )}
      {s.mfi && (
        <div className="relative border-t border-border">
          <span className="absolute top-1 left-2 z-10 text-2xs text-text-muted font-semibold bg-bg-card px-1 rounded">MFI({s.mfiPeriod})</span>
          <div ref={mfiRef} className="w-full"/>
        </div>
      )}
    </div>
  );
}
