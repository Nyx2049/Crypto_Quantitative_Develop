import { describe, expect, it, vi } from "vitest";
import {
  angleDegree,
  calculateEma,
  classifyMomentum,
  classifyTrend,
  filterClosedCandles,
  isEligibleContract,
  sortTopByQuoteVolume,
} from "../src/core";
import { BinanceApiError, BinanceClient, scanMarket } from "../src/binance";

describe("EMA99", () => {
  it("uses SMA seed then standard EMA recurrence", () => {
    const input = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = calculateEma(input, 99);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(50);
    expect(result[1]).toBeCloseTo(51, 12);
  });
});

it("calculates standardized percent slope angle", () => {
  const expected = (Math.atan(((110 / 100 - 1) * 100) / 10) * 180) / Math.PI;
  expect(angleDegree(110, 100, 10)).toBeCloseTo(expected, 12);
});

it("filters currently open and invalid candles", () => {
  expect(
    filterClosedCandles(
      [
        { close: 1, closeTime: 99 },
        { close: 2, closeTime: 100 },
        { close: 0, closeTime: 50 },
      ],
      100,
    ),
  ).toEqual([{ close: 1, closeTime: 99 }]);
});

it("sorts Top N by quote volume without mutating input", () => {
  const input = [{ quoteVolume: 2 }, { quoteVolume: 8 }, { quoteVolume: 4 }];
  expect(sortTopByQuoteVolume(input, 2).map((x) => x.quoteVolume)).toEqual([
    8, 4,
  ]);
  expect(input[0].quoteVolume).toBe(2);
});

it("excludes stablecoins, leveraged tokens, delivery and non-trading contracts", () => {
  const base = {
    symbol: "BTCUSDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    contractType: "PERPETUAL",
    status: "TRADING",
  };
  expect(isEligibleContract(base)).toBe(true);
  expect(isEligibleContract({ ...base, baseAsset: "USDC" })).toBe(false);
  expect(isEligibleContract({ ...base, baseAsset: "BTCUP" })).toBe(false);
  expect(isEligibleContract({ ...base, contractType: "CURRENT_QUARTER" })).toBe(
    false,
  );
  expect(isEligibleContract({ ...base, status: "SETTLING" })).toBe(false);
});

it("honors trend threshold boundaries", () => {
  expect(classifyTrend(0.3)).toBe("强势上涨");
  expect(classifyTrend(0.1)).toBe("温和上涨");
  expect(classifyTrend(-0.0999)).toBe("基本走平");
  expect(classifyTrend(-0.1)).toBe("温和下降");
  expect(classifyTrend(-0.3)).toBe("强势下降");
});

it("classifies acceleration in both directions", () => {
  expect(classifyMomentum(0.4, 0.3, 0.2)).toBe("加速上涨");
  expect(classifyMomentum(-0.4, -0.3, -0.2)).toBe("加速下降");
  expect(classifyMomentum(0.1, 0.2, 0.3)).toBe("上涨减速");
  expect(classifyMomentum(-0.1, -0.2, -0.3)).toBe("下降减速");
});

it("preserves official endpoint failure details", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response('{"code":-1003,"msg":"rate limited"}', { status: 429 }),
  );
  const client = new BinanceClient(fetcher as typeof fetch);
  await client.get("/fapi/v1/exchangeInfo").catch((error: BinanceApiError) => {
    expect(error).toBeInstanceOf(BinanceApiError);
    expect(error.attempts).toHaveLength(5);
    expect(error.attempts[0]).toMatchObject({ status: 429 });
    expect(error.message).toContain("rate limited");
  });
});

it("does not require a receiver-bound fetch implementation", async () => {
  const receiverSensitiveFetch = function (
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    void input;
    void init;
    if (this !== undefined) throw new TypeError("Illegal invocation");
    return Promise.resolve(new Response('{"ok":true}'));
  };
  const client = new BinanceClient((input, init) =>
    receiverSensitiveFetch.call(undefined, input, init),
  );
  await expect(client.get<{ ok: boolean }>("/test")).resolves.toEqual({
    ok: true,
  });
});

it("continues when one symbol has malformed data", async () => {
  const symbols = ["GOODUSDT", "BADUSDT"].map((symbol) => ({
    symbol,
    baseAsset: symbol.replace("USDT", ""),
    quoteAsset: "USDT",
    contractType: "PERPETUAL",
    status: "TRADING",
  }));
  const klines = Array.from({ length: 320 }, (_, index) => {
    const row: unknown[] = [];
    row[4] = String(100 + index * 0.1);
    row[6] = index + 1;
    return row;
  });
  const client = {
    get: async (endpoint: string) => {
      if (endpoint === "/fapi/v1/exchangeInfo") return { symbols };
      if (endpoint === "/fapi/v1/ticker/24hr")
        return [
          { symbol: "GOODUSDT", quoteVolume: "200" },
          { symbol: "BADUSDT", quoteVolume: "100" },
        ];
      if (endpoint === "/fapi/v1/premiumIndex")
        return [
          { symbol: "GOODUSDT", markPrice: "132" },
          { symbol: "BADUSDT", markPrice: "10" },
        ];
      if (endpoint.includes("GOODUSDT") && endpoint.includes("/klines"))
        return klines;
      if (endpoint.includes("GOODUSDT") && endpoint.includes("/openInterest"))
        return { openInterest: "12" };
      throw new Error("malformed symbol data");
    },
  } as BinanceClient;
  const result = await scanMarket(client, {
    topN: 2,
    emaPeriod: 99,
    interval: "4h",
    klineLimit: 320,
    concurrency: 2,
  });
  expect(result.rows.map((row) => row.symbol)).toEqual(["GOODUSDT"]);
  expect(result.errors).toEqual([
    { symbol: "BADUSDT", error: "malformed symbol data" },
  ]);
});
