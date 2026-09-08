import { expect, test, type Page } from "@playwright/test";

const NOW = Date.parse("2026-09-08T08:30:00Z");
const H = 3600000;
const LAST = Math.floor(NOW / (4 * H)) * 4 * H - 1;
const SYMBOLS = [
  "BTCUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "ETHUSDT",
  "QQQUSDT",
  "XAUUSDT",
  "CLUSDT",
  "EWYUSDT",
  "NVDAUSDT",
];

// Deterministic synthetic candles, only used in intercepted test responses.
function fixture(symbol: string) {
  const scale = symbol === "BTCUSDT" ? 900 : symbol === "XAUUSDT" ? 50 : 1;
  let ema = 100;
  const emas: number[] = [];
  const four = Array.from({ length: 320 }, (_, i) => {
    const target = i < 99 ? 100 : ema + (i < 300 ? -0.12 : 0.2);
    const close = i < 99 ? 100 : (target - ema * 0.98) / 0.02;
    ema = target;
    emas.push(ema);
    const end = LAST - (319 - i) * 4 * H;
    return [
      end - 4 * H + 1,
      close * scale,
      (close + 0.6) * scale,
      (close - 0.6) * scale,
      close * scale,
      1,
      end,
    ];
  });
  const hourly = Array.from({ length: 220 }, (_, i) => {
    const end = Math.floor(NOW / H) * H - 1 - (219 - i) * H;
    const index = Math.max(
      0,
      Math.min(319, Math.floor((end - H - LAST) / (4 * H)) + 319),
    );
    const reference = emas[index] * scale;
    return [
      end - H + 1,
      reference,
      reference * 1.012,
      reference * 0.999,
      reference * 1.007,
      1,
      end,
    ];
  });
  const daily = Array.from({ length: 150 }, (_, i) => [
    i,
    0,
    0,
    0,
    (100 + i * 0.1) * scale,
    1,
    NOW - (150 - i) * 24 * H,
  ]);
  return { four, hourly, daily, mark: emas.at(-1)! * scale * 1.007 };
}

async function mockMarket(page: Page, failAll = false) {
  await page.clock.install({ time: NOW });
  const calls: string[] = [];
  await page.route(
    /https:\/\/(?:fapi\d?|api\d?)\.binance\.com\//,
    async (route) => {
      const url = new URL(route.request().url());
      calls.push(url.pathname + url.search);
      const reply = (body: unknown, status = 200) =>
        route.fulfill({
          status,
          contentType: "application/json",
          body: JSON.stringify(body),
        });
      if (failAll)
        return reply({ code: -1003, msg: "fixture rate limit" }, 429);
      if (url.pathname.startsWith("/api/")) return reply([]);
      const symbol = url.searchParams.get("symbol");
      if (url.pathname.endsWith("exchangeInfo"))
        return reply({
          symbols: SYMBOLS.slice(0, 4).map((s) => ({
            symbol: s,
            baseAsset: s.replace("USDT", ""),
            quoteAsset: "USDT",
            status: "TRADING",
            contractType: "PERPETUAL",
          })),
        });
      if (symbol && !SYMBOLS.includes(symbol))
        return reply({ code: -1121, msg: "Invalid symbol" }, 400);
      if (url.pathname.endsWith("24hr")) {
        const ticker = (s: string) => ({
          symbol: s,
          quoteVolume: "100000000",
          priceChangePercent: s === "QQQUSDT" ? "-1.25" : "2.35",
        });
        return reply(symbol ? ticker(symbol) : SYMBOLS.slice(0, 4).map(ticker));
      }
      if (url.pathname.endsWith("premiumIndex")) {
        const premium = (s: string) => ({
          symbol: s,
          markPrice: String(fixture(s).mark),
        });
        return reply(
          symbol ? premium(symbol) : SYMBOLS.slice(0, 4).map(premium),
        );
      }
      if (symbol === "ETHUSDT")
        return reply({ code: -1000, msg: "fixture malformed symbol" }, 500);
      if (url.pathname.endsWith("openInterest"))
        return reply({ openInterest: "1500" });
      if (url.pathname.endsWith("klines") && symbol) {
        const f = fixture(symbol),
          interval = url.searchParams.get("interval");
        return reply(
          interval === "4h" ? f.four : interval === "1h" ? f.hourly : f.daily,
        );
      }
      return reply({ error: "unhandled fixture" }, 500);
    },
  );
  return calls;
}

for (const width of [320, 390, 1440]) {
  test(`dashboard scan and positions at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const calls = await mockMarket(page);
    await page.goto("/");
    await expect(page.locator("#strategy-list .candidate")).not.toHaveCount(0);
    await expect(page.locator("#scan")).toBeEnabled();
    await expect(page.locator("#status")).toContainText("扫描时间");
    await expect(page.locator("#strategy")).toContainText(
      "EMA99 零度筛选器 2.0",
    );
    await expect(page.locator(".is-reclaimed").first()).toBeVisible();
    await expect(page.locator("#pinned")).toContainText("24h +2.35%");
    await expect(page.locator("#issue-list")).toContainText(
      "fixture malformed symbol",
    );
    await expect(page.locator("#full")).not.toHaveAttribute("open", "");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const btcHourCalls = calls.filter(
      (p) => p.includes("symbol=BTCUSDT") && p.includes("interval=1h"),
    ).length;
    expect(btcHourCalls).toBe(1);
    await page.locator("#candidate-search").fill("BTC");
    await expect(page.locator(".candidate")).toHaveCount(1);
    await page.getByRole("button", { name: "＋ 持仓", exact: true }).click();
    await expect(page.locator("#position-dialog")).toBeVisible();
    await expect(page.locator("#pos-side")).toHaveValue("long");
    await page.locator("#pos-entry").fill("70000");
    await page.getByRole("button", { name: "保存仓位" }).click();
    await expect(page.locator("#scan")).toBeEnabled();
    await expect(page.locator("#position-list")).toContainText("BTC");
    await page.reload();
    await expect(page.locator("#scan")).toBeEnabled();
    await expect(page.locator("#position-list")).toContainText("BTC");
    await page.getByRole("button", { name: "展开全部详情" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "已平仓", exact: true }).click();
    await expect(page.locator("#position-list")).toContainText("暂无持仓");
    await page.locator("#scan").click();
    await expect(page.locator("#scan")).toBeEnabled();
    await expect(page.locator(".candidate")).not.toHaveCount(0);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("dashboard.png"),
      fullPage: true,
    });
    await page.locator("#strategy").scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("candidates.png") });
  });
}

test("clear API error, no blocked scan button, and no request storm on 429", async ({
  page,
}) => {
  const calls = await mockMarket(page, true);
  await page.goto("/");
  await expect(page.locator("#scan")).toBeEnabled();
  await expect(page.locator("#status")).toContainText("[429]");
  await expect(page.locator("#status")).toContainText("/fapi/v1/");
  expect(calls.length).toBe(4);
  await page.locator("#scan").click();
  await expect(page.locator("#scan")).toBeEnabled();
  await expect(page.locator("#status")).toContainText("fixture rate limit");
});
