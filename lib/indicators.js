/**
 * Pure technical-indicator math for Agent One's entry/exit framework. Everything here
 * is computed from the daily OHLCV bars lib/yahoo.js#fetchDailyBars returns — no extra
 * data source. All functions return null on insufficient data so the data-gate layer
 * (lib/data-gates.js) can turn that into a NO_TRADE rather than acting on a guess.
 *
 * Conventions: `closes` is a number[] of daily closing prices, oldest first.
 * `bars` is an array of { high, low, close, volume } daily bars, oldest first.
 */

/** Exponential moving average series for an array of values. Returns number[] aligned to input. */
export function ema(values, period) {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

/** Simple mean, or null if empty. */
function mean(xs) {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation, or null if fewer than 2 points. */
export function stdev(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

/**
 * Wilder's RSI over `period` closes. Returns the latest RSI value (0-100), or null if
 * there isn't at least `period + 1` closes.
 */
export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  // Seed with the first `period` changes.
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  // Wilder-smooth across the remainder.
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * MACD line, signal line, and histogram (latest values) plus whether a bearish crossover
 * (MACD below signal) has held for the last `confirmSessions` sessions. Returns null if
 * there isn't enough data for the slow EMA + signal.
 */
export function macd(closes, { fast = 12, slow = 26, signal = 9, confirmSessions = 2 } = {}) {
  if (closes.length < slow + signal) return null;
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = ema(macdLine, signal);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  const n = closes.length;
  // Bearish crossover confirmed: histogram < 0 for the last `confirmSessions` sessions.
  let bearishConfirmed = true;
  for (let i = n - confirmSessions; i < n; i++) {
    if (i < 0 || histogram[i] >= 0) {
      bearishConfirmed = false;
      break;
    }
  }
  return {
    macd: macdLine[n - 1],
    signal: signalLine[n - 1],
    histogram: histogram[n - 1],
    bearishCrossoverConfirmed: bearishConfirmed,
  };
}

/**
 * Average True Range over `period` daily bars (Wilder). Returns latest ATR in price units,
 * or null if fewer than `period + 1` bars.
 */
export function atr(bars, period = 14) {
  if (bars.length < period + 1) return null;
  const trs = [];
  for (let i = 1; i < bars.length; i++) {
    const { high, low } = bars[i];
    const prevClose = bars[i - 1].close;
    if (high == null || low == null || prevClose == null) continue;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trs.length < period) return null;
  let atrVal = mean(trs.slice(0, period));
  for (let i = period; i < trs.length; i++) {
    atrVal = (atrVal * (period - 1) + trs[i]) / period;
  }
  return atrVal;
}

/** Resample daily closes into weekly returns (every `daysPerWeek` trading days). */
export function weeklyReturns(closes, daysPerWeek = 5) {
  const weekly = [];
  for (let i = daysPerWeek; i < closes.length; i += daysPerWeek) {
    const prev = closes[i - daysPerWeek];
    if (prev) weekly.push((closes[i] - prev) / prev);
  }
  return weekly;
}

/**
 * That stock's own normal weekly volatility = stdev of its weekly returns. Used as the
 * per-name baseline for Trigger 1 (vol-adjusted weekly decline), so a high-beta semi is
 * held to a wider band than a stable SaaS compounder. Returns null on insufficient data.
 */
export function weeklyVolatility(closes, { weeks = 12, daysPerWeek = 5 } = {}) {
  const all = weeklyReturns(closes, daysPerWeek);
  if (all.length < 3) return null;
  return stdev(all.slice(-weeks));
}

/** This week's return (last `daysPerWeek` closes), or null. Negative = a decline. */
export function lastWeekReturn(closes, daysPerWeek = 5) {
  if (closes.length < daysPerWeek + 1) return null;
  const prev = closes[closes.length - 1 - daysPerWeek];
  const last = closes[closes.length - 1];
  if (!prev) return null;
  return (last - prev) / prev;
}

/**
 * Trigger 1 helper: is this week's decline larger than `multiple`× the stock's own normal
 * weekly volatility? Returns { triggered, weekReturn, volBaseline, thresholdReturn } or
 * null if data is insufficient (caller should HOLD + flag in that case).
 */
export function volAdjustedDeclineTriggered(closes, { multiple = 1.75, weeks = 12, daysPerWeek = 5 } = {}) {
  const vol = weeklyVolatility(closes, { weeks, daysPerWeek });
  const weekReturn = lastWeekReturn(closes, daysPerWeek);
  if (vol == null || weekReturn == null) return null;
  const thresholdReturn = -multiple * vol;
  return {
    triggered: weekReturn < thresholdReturn,
    weekReturn,
    volBaseline: vol,
    thresholdReturn,
  };
}

/** Average daily dollar volume over the last `days` bars (close × volume). Null if missing. */
export function avgDailyDollarVolume(bars, days = 30) {
  const recent = bars.slice(-days).filter((b) => b.close != null && b.volume != null);
  if (!recent.length) return null;
  return mean(recent.map((b) => b.close * b.volume));
}

/**
 * Relative strength of a name vs its sub-vertical benchmark (IGV for software, SOXX for
 * semis). Compares the ratio (nameClose / benchClose) week over week and reports how many
 * of the last `weeks` weeks the ratio fell — Trigger 2 fires on 3+ consecutive declining
 * weeks. Returns null if the two series can't be aligned with enough history.
 */
export function relativeStrength(nameCloses, benchCloses, { weeks = 4, daysPerWeek = 5 } = {}) {
  const n = Math.min(nameCloses.length, benchCloses.length);
  if (n < (weeks + 1) * daysPerWeek) return null;
  const name = nameCloses.slice(-n);
  const bench = benchCloses.slice(-n);
  const ratios = [];
  for (let i = name.length - 1; i >= 0; i -= daysPerWeek) {
    if (bench[i]) ratios.unshift(name[i] / bench[i]);
    if (ratios.length > weeks + 1) break;
  }
  if (ratios.length < weeks + 1) return null;
  let consecutiveDeclines = 0;
  for (let i = ratios.length - 1; i > 0; i--) {
    if (ratios[i] < ratios[i - 1]) consecutiveDeclines++;
    else break;
  }
  return {
    consecutiveDecliningWeeks: consecutiveDeclines,
    weakening: consecutiveDeclines >= 3,
    latestRatio: ratios[ratios.length - 1],
  };
}

/** Map a Yahoo sector/industry to Agent One's sub-vertical, or null if out of universe. */
export function classifySubVertical({ sector, industry } = {}) {
  const s = (sector || "").toLowerCase();
  const ind = (industry || "").toLowerCase();
  if (ind.includes("semiconductor")) return "Semiconductors";
  if (s === "technology" && (ind.includes("software") || ind.includes("information technology services"))) {
    return "Software/SaaS";
  }
  return null;
}
