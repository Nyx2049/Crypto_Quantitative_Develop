export type Trend =
  "强势上涨" | "温和上涨" | "基本走平" | "温和下降" | "强势下降";
export type Momentum =
  "加速上涨" | "上涨减速" | "加速下降" | "下降减速" | "方向混乱";

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
