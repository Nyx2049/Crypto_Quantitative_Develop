import { describe, expect, it } from "vitest";
import {
  calculateAtr,
  evaluateExitStrategy,
  type ExitMarket,
  type ExitPosition,
} from "../src/exit-strategy";
import { buildPage } from "../src/page";

const market = (overrides: Partial<ExitMarket> = {}): ExitMarket => ({
  markPrice: 120,
  ema99: 110,
  angle5: 0.2,
  angle10: 0.15,
  atr14: 4,
  volatilityRatio: 1,
  twoClosesBelowEma: false,
  twoClosesAboveEma: true,
  twoBarsNoNewHigh: false,
  twoBarsNoNewLow: false,
  recommendedSide: "观望",
  lastClosedTime: 1_000,
  ...overrides,
});

const long: ExitPosition = { side: "long", entry: 100, stop: 90 };

describe("持仓退出策略 1.0", () => {
  it("calculates Wilder ATR from true ranges", () => {
    const candles = [
      { high: 10, low: 8, close: 9 },
      { high: 13, low: 9, close: 12 },
      { high: 14, low: 11, close: 13 },
      { high: 18, low: 12, close: 17 },
    ];
    expect(calculateAtr(candles, 2)).toBeCloseTo(4.75);
  });

  it("closes 100% when a long structural stop is hit", () => {
    const result = evaluateExitStrategy(long, market({ markPrice: 89 }));
    expect(result.closePercentage).toBe(100);
    expect(result.reasons).toContain("已触及结构止损");
  });

  it("takes partial profit when volatility expands and momentum weakens", () => {
    const result = evaluateExitStrategy(
      long,
      market({
        markPrice: 125,
        angle5: -0.05,
        angle10: 0.1,
        volatilityRatio: 1.5,
      }),
    );
    expect(result.profitR).toBe(2.5);
    expect(result.closePercentage).toBe(50);
    expect(result.reasons.join(" ")).toContain("ATR 波动升高");
  });

  it("uses ATR only as protection and not as an independent exit signal", () => {
    const result = evaluateExitStrategy(
      long,
      market({ markPrice: 105, volatilityRatio: 1.8 }),
    );
    expect(result.closePercentage).toBe(0);
  });

  it("uses 1H EMA99 only for an early 25% profit-protection exit", () => {
    const result = evaluateExitStrategy(
      long,
      market({
        markPrice: 105,
        hourly: {
          ema99: 106,
          angle5: -0.12,
          angle10: -0.04,
          twoClosesBelowEma: true,
          twoClosesAboveEma: false,
          lastClosedTime: 900,
        },
      }),
    );
    expect(result.closePercentage).toBe(25);
    expect(result.reasons.join(" ")).toContain("1H");
  });

  it("does not let a 1H warning force a losing position out", () => {
    const result = evaluateExitStrategy(
      long,
      market({
        markPrice: 95,
        hourly: {
          ema99: 96,
          angle5: -0.12,
          angle10: -0.04,
          twoClosesBelowEma: true,
          twoClosesAboveEma: false,
          lastClosedTime: 900,
        },
      }),
    );
    expect(result.closePercentage).toBe(0);
  });

  it("handles short positions symmetrically", () => {
    const result = evaluateExitStrategy(
      { side: "short", entry: 100, stop: 110 },
      market({
        markPrice: 90,
        angle5: 0.1,
        angle10: 0.2,
        recommendedSide: "做多",
      }),
    );
    expect(result.closePercentage).toBe(100);
  });

  it("never loosens a previously recorded protective stop", () => {
    const position: ExitPosition = {
      ...long,
      tracking: {
        trackedAt: 100,
        updatedAt: 100,
        lastScanAt: 100,
        bestPrice: 130,
        protectiveStop: 122,
      },
    };
    const result = evaluateExitStrategy(
      position,
      market({ markPrice: 125, atr14: 10 }),
    );
    expect(result.protectiveStop).toBe(122);
  });

  it("can omit the exit module for a separate deployment", () => {
    expect(buildPage()).toContain("持仓退出策略 1.0");
    expect(buildPage(false)).not.toContain("持仓退出策略 1.0");
    expect(buildPage(false)).toContain("EXIT_STRATEGY_ENABLED=false");
  });
});
