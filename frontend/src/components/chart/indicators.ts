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
