import {
  angleDegree,
  calculateEma,
  classifyMomentum,
  classifyTrend,
  filterClosedCandles,
  isEligibleContract,
  marketRegime,
  sortTopByQuoteVolume,
  type Candle,
  type Contract,
} from "./core";

const BASE_URLS = [
  "https://fapi.binance.com",
  "https://fapi1.binance.com",
  "https://fapi2.binance.com",
  "https://fapi3.binance.com",
  "https://fapi4.binance.com",
];

export interface Config {
  topN: number;
  emaPeriod: number;
  interval: string;
  klineLimit: number;
  concurrency: number;
}

export interface ScanRow {
  rank: number;
  symbol: string;
  quoteVolume: number;
  openInterest: number;
  openInterestNotional: number;
  markPrice: number;
  ema99: number;
  distancePct: number;
  angle5: number;
  angle10: number;
  angle20: number;
  emaChange10Pct: number;
  trend: string;
  momentum: string;
  possibleTurn: "可能由负转正" | "可能由正转负" | null;
  lastClosedTime: number;
}

export class BinanceApiError extends Error {
  constructor(
    public endpoint: string,
    public attempts: Array<{
      baseUrl: string;
      status?: number;
      detail: string;
    }>,
  ) {
    super(
      `币安官方 API 请求失败: ${endpoint}; ${attempts
        .map((a) => `${a.baseUrl} [${a.status ?? "网络错误"}] ${a.detail}`)
        .join(" | ")}`,
    );
    this.name = "BinanceApiError";
  }
}

export class BinanceClient {
  constructor(
    private fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async get<T>(endpoint: string): Promise<T> {
    const attempts: BinanceApiError["attempts"] = [];
    for (const baseUrl of BASE_URLS) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await this.fetcher(`${baseUrl}${endpoint}`, {
          signal: controller.signal,
        });
        const text = await response.text();
        if (response.ok) return JSON.parse(text) as T;
        attempts.push({
          baseUrl,
          status: response.status,
          detail: text.slice(0, 240) || response.statusText,
        });
        if (
          response.status >= 400 &&
          response.status < 500 &&
          response.status !== 418 &&
          response.status !== 429
        )
          break;
      } catch (error) {
        attempts.push({
          baseUrl,
          detail: error instanceof Error ? error.message : String(error),
        });
      } finally {
        clearTimeout(timer);
      }
    }
    throw new BinanceApiError(endpoint, attempts);
  }
}

function asNumber(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} 不是有效数值`);
  return parsed;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = {
          status: "fulfilled",
          value: await task(items[index]),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

export async function scanMarket(client: BinanceClient, config: Config) {
  const started = Date.now();
  const [exchangeInfo, tickers, premiums] = await Promise.all([
    client.get<{ symbols: Contract[] }>("/fapi/v1/exchangeInfo"),
    client.get<Array<{ symbol: string; quoteVolume: string }>>(
      "/fapi/v1/ticker/24hr",
    ),
    client.get<Array<{ symbol: string; markPrice: string }>>(
      "/fapi/v1/premiumIndex",
    ),
  ]);
  const tickerMap = new Map(
    tickers.map((t) => [
      t.symbol,
      asNumber(t.quoteVolume, `${t.symbol} quoteVolume`),
    ]),
  );
  const markMap = new Map(
    premiums.map((p) => [
      p.symbol,
      asNumber(p.markPrice, `${p.symbol} markPrice`),
    ]),
  );
  const eligible = exchangeInfo.symbols
    .filter((symbol) => isEligibleContract(symbol))
    .flatMap((symbol) => {
      const quoteVolume = tickerMap.get(symbol.symbol);
      const markPrice = markMap.get(symbol.symbol);
      return quoteVolume !== undefined && markPrice !== undefined
        ? [{ symbol: symbol.symbol, quoteVolume, markPrice }]
        : [];
    });
  const candidates = sortTopByQuoteVolume(
    eligible,
    Math.min(eligible.length, Math.max(config.topN * 2, config.topN + 10)),
  );
  const settled = await mapLimit(
    candidates,
    config.concurrency,
    async (candidate) => {
      const [rawKlines, oi] = await Promise.all([
        client.get<unknown[][]>(
          `/fapi/v1/klines?symbol=${encodeURIComponent(candidate.symbol)}&interval=${encodeURIComponent(config.interval)}&limit=${config.klineLimit}`,
        ),
        client.get<{ openInterest: string }>(
          `/fapi/v1/openInterest?symbol=${encodeURIComponent(candidate.symbol)}`,
        ),
      ]);
      const candles = filterClosedCandles(
        rawKlines.map(
          (k) =>
            ({
              close: asNumber(k[4], `${candidate.symbol} close`),
              closeTime: asNumber(k[6], `${candidate.symbol} closeTime`),
            }) satisfies Candle,
        ),
      );
      if (candles.length < 150)
        throw new Error(
          `已收盘 ${config.interval} K线不足 150 根（实际 ${candles.length}）`,
        );
      const ema = calculateEma(
        candles.map((c) => c.close),
        config.emaPeriod,
      );
      if (ema.length < 21)
        throw new Error(`EMA${config.emaPeriod} 历史不足 21 个点`);
      const current = ema.at(-1)!;
      const angle5 = angleDegree(current, ema.at(-6)!, 5);
      const angle10 = angleDegree(current, ema.at(-11)!, 10);
      const angle20 = angleDegree(current, ema.at(-21)!, 20);
      const openInterest = asNumber(
        oi.openInterest,
        `${candidate.symbol} openInterest`,
      );
      return {
        symbol: candidate.symbol,
        quoteVolume: candidate.quoteVolume,
        openInterest,
        openInterestNotional: openInterest * candidate.markPrice,
        markPrice: candidate.markPrice,
        ema99: current,
        distancePct: (candidate.markPrice / current - 1) * 100,
        angle5,
        angle10,
        angle20,
        emaChange10Pct: (current / ema.at(-11)! - 1) * 100,
        trend: classifyTrend(angle10),
        momentum: classifyMomentum(angle5, angle10, angle20),
        possibleTurn:
          angle5 > 0 && angle10 <= 0
            ? ("可能由负转正" as const)
            : angle5 < 0 && angle10 >= 0
              ? ("可能由正转负" as const)
              : null,
        lastClosedTime: candles.at(-1)!.closeTime,
      };
    },
  );
  const errors: Array<{ symbol: string; error: string }> = [];
  const successful = settled.flatMap((result, index) => {
    if (result.status === "fulfilled") return [result.value];
    errors.push({
      symbol: candidates[index].symbol,
      error:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
    });
    return [];
  });
  const rows: ScanRow[] = successful
    .slice(0, config.topN)
    .map((row, index) => ({ rank: index + 1, ...row }));
  if (!rows.length)
    throw new Error(
      `没有交易对成功完成扫描。${errors.map((e) => `${e.symbol}: ${e.error}`).join(" | ")}`,
    );
  const up = rows.filter((r) => r.angle10 >= 0.1).length;
  const down = rows.filter((r) => r.angle10 <= -0.1).length;
  const flat = rows.length - up - down;
  const above = rows.filter((r) => r.markPrice > r.ema99).length;
  const below = rows.filter((r) => r.markPrice < r.ema99).length;
  const ratio = (count: number) => (count / rows.length) * 100;
  return {
    source: "Binance USDⓈ-M Futures official public API",
    scannedAt: Date.now(),
    durationMs: Date.now() - started,
    interval: config.interval,
    emaPeriod: config.emaPeriod,
    rows,
    errors,
    highlights: {
      steepestUp: [...rows]
        .filter((r) => r.angle10 > 0)
        .sort((a, b) => b.angle10 - a.angle10)
        .slice(0, 5),
      steepestDown: [...rows]
        .filter((r) => r.angle10 < 0)
        .sort((a, b) => a.angle10 - b.angle10)
        .slice(0, 5),
      acceleratingUp: rows.filter((r) => r.momentum === "加速上涨"),
      acceleratingDown: rows.filter((r) => r.momentum === "加速下降"),
      turningPositive: rows.filter((r) => r.possibleTurn === "可能由负转正"),
      turningNegative: rows.filter((r) => r.possibleTurn === "可能由正转负"),
      farFromEma: rows.filter((r) => Math.abs(r.distancePct) > 5),
    },
    market: {
      total: rows.length,
      up: { count: up, pct: ratio(up) },
      down: { count: down, pct: ratio(down) },
      flat: { count: flat, pct: ratio(flat) },
      above: { count: above, pct: ratio(above) },
      below: { count: below, pct: ratio(below) },
      acceleratingUp: rows.filter((r) => r.momentum === "加速上涨").length,
      acceleratingDown: rows.filter((r) => r.momentum === "加速下降").length,
      regime: marketRegime(up, down, above, below, rows.length),
    },
    lastClosedTime: Math.max(...rows.map((r) => r.lastClosedTime)),
  };
}
