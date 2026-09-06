export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  time?: string | number; // 분봉: Unix 타임스탬프(number), 일봉: "YYYY-MM-DD"(string)
}

type ChartTime = string | number;
type TimedValue = { time: ChartTime; value: number };

function t(d: OHLCV): ChartTime {
  return d.time !== undefined ? d.time : d.date;
}

/* ── SMA ──────────────────────────────────────────────── */
export function calcMA(data: OHLCV[], period: number): TimedValue[] {
  const result = [];
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b.close, 0);
    result.push({ time: t(data[i]), value: sum / period });
  }
  return result;
}

/* ── EMA ──────────────────────────────────────────────── */
export function calcEMA(data: OHLCV[], period: number): TimedValue[] {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result: TimedValue[] = [];
  let ema = data.slice(0, period).reduce((a, b) => a + b.close, 0) / period;
  result.push({ time: t(data[period - 1]), value: ema });
  for (let i = period; i < data.length; i++) {
    ema = data[i].close * k + ema * (1 - k);
    result.push({ time: t(data[i]), value: ema });
  }
  return result;
}

/* ── 볼린저 밴드 ─────────────────────────────────────── */
export function calcBB(data: OHLCV[], period = 20, mult = 2) {
  const upper: TimedValue[] = [], middle: TimedValue[] = [], lower: TimedValue[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1).map(d => d.close);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std  = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    const tm = t(data[i]);
    middle.push({ time: tm, value: mean });
    upper.push({ time: tm, value: mean + mult * std });
    lower.push({ time: tm, value: mean - mult * std });
  }
  return { upper, middle, lower };
}

/* ── RSI ─────────────────────────────────────────────── */
export function calcRSI(data: OHLCV[], period = 14): TimedValue[] {
  if (data.length < period + 1) return [];
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const d = data[i].close - data[i - 1].close;
    gains.push(d > 0 ? d : 0);
    losses.push(d < 0 ? -d : 0);
  }
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result: TimedValue[] = [];
  const rsi = (g: number, l: number) => l === 0 ? 100 : 100 - 100 / (1 + g / l);
  result.push({ time: t(data[period]), value: rsi(avgGain, avgLoss) });
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    result.push({ time: t(data[i + 1]), value: rsi(avgGain, avgLoss) });
  }
  return result;
}

/* ── MACD ────────────────────────────────────────────── */
export function calcMACD(data: OHLCV[], fast = 12, slow = 26, signal = 9) {
  const emaFast = calcEMA(data, fast);
  const emaSlow = calcEMA(data, slow);
  const macdLine: TimedValue[] = [];
  const minLen = Math.min(emaFast.length, emaSlow.length);
  for (let i = 0; i < minLen; i++) {
    const fi = emaFast.length - minLen + i;
    macdLine.push({ time: emaSlow[i].time, value: emaFast[fi].value - emaSlow[i].value });
  }
  const k = 2 / (signal + 1);
  let sig = macdLine.slice(0, signal).reduce((a, b) => a + b.value, 0) / signal;
  const signalLine: TimedValue[] = [{ time: macdLine[signal - 1].time, value: sig }];
  for (let i = signal; i < macdLine.length; i++) {
    sig = macdLine[i].value * k + sig * (1 - k);
    signalLine.push({ time: macdLine[i].time, value: sig });
  }
  const histogram = signalLine.map((s, i) => {
    const m = macdLine[macdLine.length - signalLine.length + i];
    return { time: s.time, value: m.value - s.value };
  });
  return { macdLine: macdLine.slice(-signalLine.length), signalLine, histogram };
}

/* ── 스토캐스틱 ──────────────────────────────────────── */
export function calcStochastic(data: OHLCV[], kPeriod = 14, dPeriod = 3) {
  const kLine: TimedValue[] = [];
  for (let i = kPeriod - 1; i < data.length; i++) {
    const slice = data.slice(i - kPeriod + 1, i + 1);
    const highest = Math.max(...slice.map(d => d.high));
    const lowest  = Math.min(...slice.map(d => d.low));
    const k = (highest === lowest) ? 50 : (data[i].close - lowest) / (highest - lowest) * 100;
    kLine.push({ time: t(data[i]), value: k });
  }
  const dLine = calcSMAFromLine(kLine, dPeriod);
  return { kLine, dLine };
}

function calcSMAFromLine(line: TimedValue[], period: number): TimedValue[] {
  const result: TimedValue[] = [];
  for (let i = period - 1; i < line.length; i++) {
    const sum = line.slice(i - period + 1, i + 1).reduce((a, b) => a + b.value, 0);
    result.push({ time: line[i].time, value: sum / period });
  }
  return result;
}

/* ── CCI (Commodity Channel Index) ──────────────────── */
export function calcCCI(data: OHLCV[], period = 20): TimedValue[] {
  const result: TimedValue[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const tps = slice.map(d => (d.high + d.low + d.close) / 3);
    const mean = tps.reduce((a, b) => a + b, 0) / period;
    const meanDev = tps.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
    result.push({ time: t(data[i]), value: meanDev === 0 ? 0 : (tps[period - 1] - mean) / (0.015 * meanDev) });
  }
  return result;
}

/* ── ATR (Average True Range) ───────────────────────── */
export function calcATR(data: OHLCV[], period = 14): TimedValue[] {
  if (data.length < 2) return [];
  const trs = data.slice(1).map((d, i) => Math.max(
    d.high - d.low,
    Math.abs(d.high - data[i].close),
    Math.abs(d.low  - data[i].close),
  ));
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result: TimedValue[] = [{ time: t(data[period]), value: atr }];
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
    result.push({ time: t(data[i + 1]), value: atr });
  }
  return result;
}

/* ── OBV (On Balance Volume) ────────────────────────── */
export function calcOBV(data: OHLCV[]): TimedValue[] {
  let obv = 0;
  return data.map((d, i) => {
    if (i > 0) {
      if (d.close > data[i-1].close) obv += d.volume;
      else if (d.close < data[i-1].close) obv -= d.volume;
    }
    return { time: t(d), value: obv };
  });
}

/* ── Williams %R ────────────────────────────────────── */
export function calcWilliams(data: OHLCV[], period = 14): TimedValue[] {
  const result: TimedValue[] = [];
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const high = Math.max(...slice.map(d => d.high));
    const low  = Math.min(...slice.map(d => d.low));
    result.push({ time: t(data[i]), value: high === low ? -50 : ((high - data[i].close) / (high - low)) * -100 });
  }
  return result;
}

/* ── 거래량 ─────────────────────────────────────────── */
export function calcVolume(data: OHLCV[], upColor = "rgba(16,185,129,0.5)", downColor = "rgba(239,68,68,0.5)") {
  return data.map(d => ({
    time:  t(d),
    value: d.volume,
    color: d.close >= d.open ? upColor : downColor,
  }));
}

/* ── VWAP (Volume Weighted Average Price) ──────────── */
export function calcVWAP(data: OHLCV[]): TimedValue[] {
  let cumVol = 0, cumTPV = 0;
  return data.map(d => {
    const tp = (d.high + d.low + d.close) / 3;
    cumVol += d.volume;
    cumTPV += tp * d.volume;
    return { time: t(d), value: cumVol === 0 ? d.close : cumTPV / cumVol };
  });
}

/* ── Parabolic SAR ─────────────────────────────────── */
export function calcSAR(data: OHLCV[], step = 0.02, max = 0.2): TimedValue[] {
  if (data.length < 2) return [];
  const result: TimedValue[] = [];
  let bull = data.length > 1 && data[1].close >= data[0].close;
  let sar = bull ? data[0].low : data[0].high;
  let ep = bull ? data[0].high : data[0].low;
  let af = step;
  for (let i = 1; i < data.length; i++) {
    const curr = data[i];
    sar = sar + af * (ep - sar);
    if (bull) {
      if (i >= 2) sar = Math.min(sar, data[i-1].low, data[i-2].low);
      else sar = Math.min(sar, data[i-1].low);
      if (curr.low < sar) {
        bull = false; sar = ep; ep = curr.low; af = step;
      } else if (curr.high > ep) {
        ep = curr.high; af = Math.min(af + step, max);
      }
    } else {
      if (i >= 2) sar = Math.max(sar, data[i-1].high, data[i-2].high);
      else sar = Math.max(sar, data[i-1].high);
      if (curr.high > sar) {
        bull = true; sar = ep; ep = curr.high; af = step;
      } else if (curr.low < ep) {
        ep = curr.low; af = Math.min(af + step, max);
      }
    }
    result.push({ time: t(curr), value: sar });
  }
  return result;
}

/* ── ADX (Average Directional Index) ──────────────── */
export function calcADX(data: OHLCV[], period = 14): { adx: TimedValue[]; plusDI: TimedValue[]; minusDI: TimedValue[] } {
  if (data.length < period + 2) return { adx: [], plusDI: [], minusDI: [] };
  const trs: number[] = [], pDMs: number[] = [], mDMs: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const h = data[i].high - data[i-1].high;
    const l = data[i-1].low - data[i].low;
    pDMs.push(h > 0 && h > l ? h : 0);
    mDMs.push(l > 0 && l > h ? l : 0);
    trs.push(Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i-1].close), Math.abs(data[i].low - data[i-1].close)));
  }
  let avgTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
  let avgPDM = pDMs.slice(0, period).reduce((a, b) => a + b, 0);
  let avgMDM = mDMs.slice(0, period).reduce((a, b) => a + b, 0);
  const adxArr: TimedValue[] = [], pDIArr: TimedValue[] = [], mDIArr: TimedValue[] = [];
  const dxBuf: number[] = [];
  for (let i = period; i < trs.length; i++) {
    avgTR  = avgTR  - avgTR / period + trs[i];
    avgPDM = avgPDM - avgPDM / period + pDMs[i];
    avgMDM = avgMDM - avgMDM / period + mDMs[i];
    const pdi = avgTR === 0 ? 0 : 100 * avgPDM / avgTR;
    const mdi = avgTR === 0 ? 0 : 100 * avgMDM / avgTR;
    const dx  = (pdi + mdi) === 0 ? 0 : 100 * Math.abs(pdi - mdi) / (pdi + mdi);
    dxBuf.push(dx);
    pDIArr.push({ time: t(data[i + 1]), value: pdi });
    mDIArr.push({ time: t(data[i + 1]), value: mdi });
    if (dxBuf.length === period) {
      adxArr.push({ time: t(data[i + 1]), value: dxBuf.reduce((a, b) => a + b, 0) / period });
    } else if (dxBuf.length > period) {
      adxArr.push({ time: t(data[i + 1]), value: (adxArr[adxArr.length - 1].value * (period - 1) + dx) / period });
    }
  }
  return { adx: adxArr, plusDI: pDIArr, minusDI: mDIArr };
}

/* ── ROC (Rate of Change) ───────────────────────────── */
export function calcROC(data: OHLCV[], period = 12): TimedValue[] {
  const result: TimedValue[] = [];
  for (let i = period; i < data.length; i++) {
    const prev = data[i - period].close;
    result.push({ time: t(data[i]), value: prev === 0 ? 0 : (data[i].close - prev) / prev * 100 });
  }
  return result;
}

/* ── MFI (Money Flow Index) ─────────────────────────── */
export function calcMFI(data: OHLCV[], period = 14): TimedValue[] {
  if (data.length < period + 1) return [];
  const tps = data.map(d => (d.high + d.low + d.close) / 3);
  const result: TimedValue[] = [];
  for (let i = period; i < data.length; i++) {
    let posMF = 0, negMF = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const mf = tps[j] * data[j].volume;
      if (tps[j] >= tps[j - 1]) posMF += mf; else negMF += mf;
    }
    result.push({ time: t(data[i]), value: negMF === 0 ? 100 : 100 - 100 / (1 + posMF / negMF) });
  }
  return result;
}

/* ── 일목균형표 (Ichimoku) ─────────────────────────────
 *
 * 국내에서 제일 많이 쓰이는 추세 도구인데 없었다. 다섯 선이 한꺼번에
 * '지지·저항·추세·시점' 을 말해 준다 — 이동평균 여러 개를 겹쳐 놓는
 * 것과 보는 방식이 다르다.
 *
 *   전환선  (9)   최근 9봉의 (고+저)/2      단기 균형
 *   기준선  (26)  최근 26봉의 (고+저)/2     중기 균형
 *   선행스팬A     (전환+기준)/2 를 26봉 **앞으로**
 *   선행스팬B     최근 52봉의 (고+저)/2 를 26봉 앞으로
 *   후행스팬      종가를 26봉 **뒤로**
 *
 * 앞뒤로 옮기는 것이 이 지표의 핵심이다. 그냥 그날 자리에 두면
 * 구름(A와 B 사이)이 미래를 안 가리키게 되어 뜻이 없어진다.
 *
 * 옮긴 선은 데이터의 끝을 넘어간다. 그 자리에는 아직 봉이 없으므로
 * 날짜를 만들어야 하는데, 여기서는 **있는 봉의 날짜까지만** 그린다 —
 * 없는 날짜를 지어내면 시간축이 어긋나고, 그건 지지선 위치를 통째로
 * 틀리게 만든다. 앞으로 나가는 부분은 화면 밖이라고 보면 된다.
 */
function 중앙값(data: OHLCV[], 끝: number, 기간: number): number | null {
  const 시작 = 끝 - 기간 + 1;
  if (시작 < 0) return null;
  let hi = -Infinity, lo = Infinity;
  for (let i = 시작; i <= 끝; i++) {
    if (data[i].high > hi) hi = data[i].high;
    if (data[i].low  < lo) lo = data[i].low;
  }
  return (hi + lo) / 2;
}

export function calcIchimoku(
  data: OHLCV[], 전환기간 = 9, 기준기간 = 26, 선행B기간 = 52, 밀기 = 26,
): {
  전환선: TimedValue[]; 기준선: TimedValue[];
  선행A: TimedValue[]; 선행B: TimedValue[]; 후행: TimedValue[];
} {
  const 전환선: TimedValue[] = [], 기준선: TimedValue[] = [];
  const 선행A: TimedValue[] = [], 선행B: TimedValue[] = [], 후행: TimedValue[] = [];

  for (let i = 0; i < data.length; i++) {
    const 전 = 중앙값(data, i, 전환기간);
    const 기 = 중앙값(data, i, 기준기간);
    if (전 != null) 전환선.push({ time: t(data[i]), value: 전 });
    if (기 != null) 기준선.push({ time: t(data[i]), value: 기 });

    /* 선행스팬은 **앞으로** 민다. 지금 계산한 값이 26봉 뒤 자리에
       놓여야 구름이 미래를 가리킨다 */
    const 앞자리 = i + 밀기;
    if (앞자리 < data.length) {
      if (전 != null && 기 != null) 선행A.push({ time: t(data[앞자리]), value: (전 + 기) / 2 });
      const B = 중앙값(data, i, 선행B기간);
      if (B != null) 선행B.push({ time: t(data[앞자리]), value: B });
    }

    /* 후행스팬은 종가를 **뒤로** 민다. 지금 값이 26봉 전 자리에 놓여야
       '그때 가격을 지금 넘었나' 를 볼 수 있다 */
    const 뒷자리 = i - 밀기;
    if (뒷자리 >= 0) 후행.push({ time: t(data[뒷자리]), value: data[i].close });
  }
  return { 전환선, 기준선, 선행A, 선행B, 후행 };
}

/* ── 피보나치 되돌림 ───────────────────────────────────
 *
 * 오른 구간이 어디까지 밀릴지, 밀린 구간이 어디서 막힐지를 보는
 * 가장 흔한 자다. 고점과 저점만 있으면 나머지는 비율이다.
 *
 * 구간을 **보고 있는 화면**에서 잡는다. 전체 기간의 고·저로 잡으면
 * 3년 전 고점이 이번 달 그래프를 지배해서, 화면에 그은 선이 지금
 * 움직임과 아무 상관이 없어진다.
 */
export const 피보_비율 = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export function calcFibonacci(data: OHLCV[]): { 비율: number; value: number }[] {
  if (data.length < 2) return [];
  let hi = -Infinity, lo = Infinity;
  for (const d of data) {
    if (d.high > hi) hi = d.high;
    if (d.low  < lo) lo = d.low;
  }
  if (!(hi > lo)) return [];       // 한 줄로 붙어 있으면 그을 자가 없다
  /* 0% 를 고점에 둔다 — 오름 구간에서 '얼마나 되돌렸나' 로 읽는 것이
     이 도구의 본디 쓰임이다 */
  return 피보_비율.map((비율) => ({ 비율, value: hi - (hi - lo) * 비율 }));
}
