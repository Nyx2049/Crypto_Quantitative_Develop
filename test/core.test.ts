import { describe, expect, it, vi } from "vitest";
import {
  angleDegree,
  calculateEma,
  classifyMomentum,
  classifyTrend,
  confirmPreviousCurve,
  filterClosedCandles,
  isEligibleContract,
  reversalWithCurve,
  sortTopByQuoteVolume,
} from "../src/core";
import { BinanceApiError, BinanceClient, scanMarket } from "../src/binance";
import { PAGE } from "../src/page";

describe("EMA99", () => {
  it("uses SMA seed then standard EMA recurrence", () => {
    const input = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = calculateEma(input, 99);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(50);
    expect(result[1]).toBeCloseTo(51, 12);
  });
});

describe("EMA99 curve confirmation", () => {
  function buildCurve(priorSteps: number[], currentStep: number): number[] {
    const values = Array.from({ length: 26 }, () => 100);
    for (const step of priorSteps)
      values.push(values.at(-1)! * (1 + step / 100));
    for (let i = 0; i < 10; i += 1)
      values.push(values.at(-1)! * (1 + currentStep / 100));
    return values;
  }

  it("confirms a persistent smooth prior curve before recommending a reversal", () => {
    const values = buildCurve(
      Array.from({ length: 24 }, () => 0.0025),
      -0.004,
    );
    const result = reversalWithCurve(values);
    expect(result.curve.confirmed).toBe(true);
    expect(result.curve.direction).toBe("up");
    expect(result.curve.directionalRatio).toBe(1);
    expect(result.side).toBe("做空");
  });

  it("rejects a short countertrend bump inside the larger trend", () => {
    const values = buildCurve(
      [
        ...Array.from({ length: 16 }, () => -0.0005),
        ...Array.from({ length: 8 }, () => 0.008),
      ],
      -0.004,
    );
    const curve = confirmPreviousCurve(values);
    expect(curve.averageAngle).toBeGreaterThan(0.1);
    expect(curve.directionalRatio).toBeLessThan(0.75);
    expect(curve.confirmed).toBe(false);
    expect(reversalWithCurve(values).side).toBe("观望");
  });
});

it("ships the browser-direct official API scanner", () => {
  expect(PAGE).toContain("scanDirect()");
  expect(PAGE).toContain("https://fapi4.binance.com");
  expect(PAGE).toContain("mode:'cors'");
  expect(PAGE).not.toContain("fetch('/api/scan'");
});

it("ships syntactically valid inline browser JavaScript", () => {
  const script = PAGE.match(/<script>([\s\S]*)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  expect(() => Function(script!)).not.toThrow();
});

it("labels the candidate module and sorts both angle directions by distance from zero", () => {
  expect(PAGE).toContain("零度雷达 ZeroSlope");
  expect(PAGE).toContain("<h2>候选模块</h2>");
  expect(PAGE).toContain("EMA99 零度筛选器 1.1");
  expect(PAGE).toContain("Math.abs(a.angle10)-Math.abs(b.angle10)");
  expect(PAGE).toContain("前段有效曲线下跌后穿上 0°");
  expect(PAGE).toContain("前段有效曲线上涨后穿下 0°");
  expect(PAGE).toContain("recommendedSide");
  expect(PAGE).toContain("suggestedStop");
  expect(PAGE).toContain("candles.slice(-60)");
  expect(PAGE).toContain("signal-box");
  expect(PAGE).toContain("curveConfirmation");
  expect(PAGE).toContain("前段曲线未确认");
  expect(PAGE).toContain("推荐'+r.recommendedSide");
  expect(PAGE).toContain("loadDailyBackgrounds");
  expect(PAGE).toContain("interval=1d");
  expect(PAGE).toContain("初步牛市背景");
  expect(PAGE).toContain("初步熊市背景");
  expect(PAGE).toContain("日线转折/分化");
  expect(PAGE).not.toContain('class="strategy-explain"');
});

it("keeps the fixed watch pairs in one editable configuration", () => {
  expect(PAGE).toContain(
    "const PINNED_PAIRS=[{label:'比特币',symbol:'BTCUSDT'},{label:'纳指 QQQ',symbol:'QQQUSDT'},{label:'黄金',symbol:'XAUUSDT'},{label:'原油',symbol:'CLUSDT'},{label:'韩指 EWY',symbol:'EWYUSDT'}]",
  );
  expect(PAGE).toContain("grid-template-columns:repeat(5");
  expect(PAGE).toContain("当前不在 USDⓈ-M 永续交易池或数据不可用");
  expect(PAGE).toContain("/fapi/v1/ticker/24hr?symbol=");
  expect(PAGE).toContain("/fapi/v1/premiumIndex?symbol=");
  expect(PAGE).toContain("priceChangePercent");
  expect(PAGE).toContain("pinned-price");
  expect(PAGE).toContain("24h ");
  expect(PAGE).toContain(".up,.market-up{color:var(--green)}");
  expect(PAGE).toContain(".down,.market-down{color:var(--red)}");
  expect(PAGE).toContain("正在获取币圈合约、现货与 TradFi 成交额");
});

it("excludes held base assets and backfills the 20 candidate slots by volume", () => {
  expect(PAGE).toContain("const TRADFI_PAIRS=");
  expect(PAGE).toContain("cryptoEligible");
  expect(PAGE).toContain("function baseKey(symbol)");
  expect(PAGE).toContain("replace(/(USDT|USDC)$/");
  expect(PAGE).toContain("UNDERLYING_ALIASES");
  expect(PAGE).toContain("NVDAB:'NVDA'");
  expect(PAGE).toContain("TSLAB:'TSLA'");
  expect(PAGE).toContain("heldBases.has(baseKey(x.symbol))");
  expect(PAGE).toContain("cryptoRows=");
  expect(PAGE).toContain(".slice(0,10),stockRows=");
  expect(PAGE).toContain("fallbackRows=");
  expect(PAGE).toContain("20-cryptoRows.length-stockRows.length");
  expect(PAGE).toContain(
    "composition:{crypto:rows.filter(r=>r.marketType==='币圈').length",
  );
  expect(PAGE).toContain("SPOT_API_BASES");
  expect(PAGE).toContain("/api/v3/ticker/24hr");
  expect(PAGE).toContain("futuresQuoteVolume+spotQuoteVolume");
  expect(PAGE).toContain("liquiditySource");
  expect(PAGE).toContain("仅合约（现货暂不可用）");
});

it("excludes stablecoin underlyings from the candidate pool", () => {
  expect(PAGE).toContain(
    "stable=new Set(['USDT','USDC','FDUSD','TUSD','BUSD','DAI','USDP','USDE','PYUSD','USD1','USDS','GUSD','RLUSD','EURC','AEUR'])",
  );
  expect(PAGE).toContain("!stable.has(cleanSymbol(x.baseAsset))");
  expect(PAGE).toContain("!stable.has(baseKey(x.symbol))");
});

it("persists positions locally and evaluates long and short exit rules", () => {
  expect(PAGE).toContain("zeroslope_positions");
  expect(PAGE).toContain("evaluateExitStrategy(p,row)");
  expect(PAGE).toContain("twoClosesBelowEma");
  expect(PAGE).toContain("twoClosesAboveEma");
  expect(PAGE).toContain("建议平仓");
  expect(PAGE).toContain("ATR14");
  expect(PAGE).toContain("interval=1h");
  expect(PAGE).toContain("loadHourlyExitSignals");
  expect(PAGE).toContain("1H EMA99");
  expect(PAGE).toContain("结构止损价");
  expect(PAGE).toContain("已平仓");
  expect(PAGE).toContain("确认 '+baseKey(symbol)+' 已经平仓");
  expect(PAGE).toContain("baseKey(row?row.symbol:symbol)");
  expect(PAGE).toContain("展开全部详情");
  expect(PAGE).toContain("收起全部详情");
  expect(PAGE).toContain("positionsExpanded=false");
  expect(PAGE).toContain("function positionSummary");
  expect(PAGE).toContain("position-prices");
  expect(PAGE).toContain("entry+' / '+current");
  expect(PAGE).toContain("position-side");
  expect(PAGE).toContain("p.side==='short'?'空':'多'");
  expect(PAGE).toContain("positionsExpanded=!positionsExpanded");
});

it("shows canonical asset names while keeping full pairs internally", () => {
  expect(PAGE).toContain("计价基准：USDT");
  expect(PAGE).toContain("USDⓈ-M Mark Price");
  expect(PAGE).not.toContain("行情默认使用 Binance");
  expect(PAGE).not.toContain("浏览器直连币安");
  expect(PAGE).toContain("['symbol','资产']");
  expect(PAGE).toContain("if(k==='symbol')return baseKey(r[k])");
  expect(PAGE).toContain("baseKey(r.symbol)");
  expect(PAGE).toContain("baseKey(x.symbol)");
  expect(PAGE).toContain("openPosition(&quot;'+r.symbol");
  expect(PAGE).not.toContain("['symbol','交易对']");
  expect(PAGE).toContain("stripped||cleaned||'未知资产'");
});

it("shares a versioned position configuration through a self-importing link", () => {
  expect(PAGE).toContain("分享持仓");
  expect(PAGE).toContain("POSITION_CONFIG_VERSION=2");
  expect(PAGE).toContain("app:'ZeroSlope'");
  expect(PAGE).toContain("parsePositionConfig");
  expect(PAGE).toContain("url.hash='positions='");
  expect(PAGE).toContain("importSharedPositions()");
  expect(PAGE).toContain("已从分享链接自动导入");
  expect(PAGE).not.toContain("导出 JSON");
  expect(PAGE).not.toContain("导入 JSON");
  expect(PAGE).not.toContain('type="file"');
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

it("tries every official fallback after a 403 response", async () => {
  const fetcher = vi.fn(async () => new Response("Forbidden", { status: 403 }));
  const client = new BinanceClient(fetcher as typeof fetch);
  await client.get("/fapi/v1/ticker/24hr").catch((error: BinanceApiError) => {
    expect(error.attempts).toHaveLength(5);
    expect(error.attempts.every((attempt) => attempt.status === 403)).toBe(
      true,
    );
  });
  expect(fetcher).toHaveBeenCalledTimes(5);
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
