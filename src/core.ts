export type Trend =
  "强势上涨" | "温和上涨" | "基本走平" | "温和下降" | "强势下降";
export type Momentum =
  "加速上涨" | "上涨减速" | "加速下降" | "下降减速" | "方向混乱";
export type ReversalSide = "做多" | "做空" | "观望";

export interface CurveConfirmation {
  confirmed: boolean;
  direction: "up" | "down" | "flat";
  averageAngle: number;
  peakAngle: number;
  directionalRatio: number;
  netChangePct: number;
  roughness: number;
  bars: number;
}

export interface Candle {
  close: number;
  closeTime: number;
}

export interface Contract {
  symbol: string;
  quoteAsset: string;
  baseAsset: string;
  contractType: string;
  status: string;
  deliveryDate?: number;
}

const STABLE_BASES = new Set([
  "USDT",
  "USDC",
  "FDUSD",
  "TUSD",
  "BUSD",
  "DAI",
  "USDP",
  "USDE",
  "PYUSD",
]);
const LEVERAGED_SUFFIX = /(UP|DOWN|BULL|BEAR)$/;

export function isEligibleContract(
  contract: Contract,
  now = Date.now(),
): boolean {
  return (
    contract.quoteAsset === "USDT" &&
    contract.contractType === "PERPETUAL" &&
    contract.status === "TRADING" &&
    !STABLE_BASES.has(contract.baseAsset) &&
    !LEVERAGED_SUFFIX.test(contract.baseAsset) &&
    (!contract.deliveryDate || contract.deliveryDate > now + 86_400_000)
  );
}

export function filterClosedCandles(
  candles: Candle[],
  now = Date.now(),
): Candle[] {
  return candles.filter(
    (c) => c.closeTime < now && Number.isFinite(c.close) && c.close > 0,
  );
}

export function calculateEma(values: number[], period = 99): number[] {
  if (values.length < period) return [];
  const seed =
    values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const alpha = 2 / (period + 1);
  const output = [seed];
  for (let i = period; i < values.length; i += 1) {
    output.push(values[i] * alpha + output[output.length - 1] * (1 - alpha));
  }
  return output;
}

export function angleDegree(
  current: number,
  previous: number,
  bars: number,
): number {
  const slopePctPerBar = ((current / previous - 1) * 100) / bars;
  return (Math.atan(slopePctPerBar) * 180) / Math.PI;
}

const CURVE_BARS = 24;
const CURVE_OFFSET = 10;
const MIN_AVERAGE_ANGLE = 0.1;
const MIN_PEAK_ANGLE = 0.12;
const MIN_DIRECTIONAL_RATIO = 0.75;
const MIN_NET_CHANGE_PCT = 0.04;
const MAX_ROUGHNESS = 5;

export function confirmPreviousCurve(values: number[]): CurveConfirmation {
  const end = values.length - CURVE_OFFSET;
  const start = end - CURVE_BARS - 1;
  if (start < 0)
    return {
      confirmed: false,
      direction: "flat",
      averageAngle: 0,
      peakAngle: 0,
      directionalRatio: 0,
      netChangePct: 0,
      roughness: Infinity,
      bars: 0,
    };
  const segment = values.slice(start, end);
  const averageAngle = angleDegree(segment.at(-1)!, segment[0], CURVE_BARS);
  const direction =
    averageAngle >= MIN_AVERAGE_ANGLE
      ? "up"
      : averageAngle <= -MIN_AVERAGE_ANGLE
        ? "down"
        : "flat";
  const slopes = segment
    .slice(1)
    .map((value, index) => angleDegree(value, segment[index], 1));
  const sign = direction === "up" ? 1 : direction === "down" ? -1 : 0;
  const directionalRatio = sign
    ? slopes.filter((slope) => slope * sign > 0).length / slopes.length
    : 0;
  const peakAngle = Math.max(0, ...slopes.map((slope) => slope * sign));
  const netChangePct = Math.abs((segment.at(-1)! / segment[0] - 1) * 100);
  const totalVariation = slopes
    .slice(1)
    .reduce((sum, slope, index) => sum + Math.abs(slope - slopes[index]), 0);
  const roughness = peakAngle > 0 ? totalVariation / peakAngle : Infinity;
  return {
    confirmed:
      sign !== 0 &&
      directionalRatio >= MIN_DIRECTIONAL_RATIO &&
      peakAngle >= MIN_PEAK_ANGLE &&
      netChangePct >= MIN_NET_CHANGE_PCT &&
      roughness <= MAX_ROUGHNESS,
    direction,
    averageAngle,
    peakAngle,
    directionalRatio,
    netChangePct,
    roughness,
    bars: CURVE_BARS,
  };
}

export function reversalWithCurve(values: number[]): {
  side: ReversalSide;
  curve: CurveConfirmation;
} {
  const curve = confirmPreviousCurve(values);
  if (values.length < CURVE_OFFSET + 1) return { side: "观望", curve };
  const currentAngle = angleDegree(
    values.at(-1)!,
    values.at(-CURVE_OFFSET - 1)!,
    CURVE_OFFSET,
  );
  if (curve.confirmed && curve.direction === "down" && currentAngle > 0)
    return { side: "做多", curve };
  if (curve.confirmed && curve.direction === "up" && currentAngle < 0)
    return { side: "做空", curve };
  return { side: "观望", curve };
}

export function classifyTrend(angle10: number): Trend {
  if (angle10 >= 0.3) return "强势上涨";
  if (angle10 >= 0.1) return "温和上涨";
  if (angle10 > -0.1) return "基本走平";
  if (angle10 > -0.3) return "温和下降";
  return "强势下降";
}

export function classifyMomentum(
  angle5: number,
  angle10: number,
  angle20: number,
): Momentum {
  if (angle5 > angle10 && angle10 > angle20 && angle20 > 0) return "加速上涨";
  if (angle20 > angle10 && angle10 > angle5 && angle10 > 0) return "上涨减速";
  if (angle5 < angle10 && angle10 < angle20 && angle20 < 0) return "加速下降";
  if (angle20 < angle10 && angle10 < angle5 && angle10 < 0) return "下降减速";
  return "方向混乱";
}

export function sortTopByQuoteVolume<T extends { quoteVolume: number }>(
  items: T[],
  limit: number,
): T[] {
  return [...items]
    .sort((a, b) => b.quoteVolume - a.quoteVolume)
    .slice(0, limit);
}

export function marketRegime(
  up: number,
  down: number,
  above: number,
  below: number,
  total: number,
): string {
  if (!total) return "震荡分化";
  if (up / total >= 0.7 && above / total >= 0.7) return "趋势扩散上涨";
  if (down / total >= 0.7 && below / total >= 0.7) return "趋势扩散下跌";
  if (up > down && above > below) return "局部上涨";
  if (down > up && below > above) return "局部下跌";
  return "震荡分化";
}
