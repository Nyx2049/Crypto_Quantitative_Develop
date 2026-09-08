import { describe, expect, it } from "vitest";
import {
  CANDIDATE_BROWSER_SOURCE,
  evaluateRetest,
  findTurnEvent,
  type HourCandle,
  type TrendPoint,
  type TurnEvent,
} from "../src/candidate-strategy";

const H = 3600000;
const T = 1000 * 4 * H - 1;
function history(short = false): TrendPoint[] {
  return Array.from({ length: 80 }, (_, i) => ({
    time: T - (79 - i) * 4 * H,
    ema: 100,
    angle10: (i === 79 ? 0.02 : -0.1) * (short ? -1 : 1),
    priorConfirmed: true,
    priorDirection: short ? "up" : "down",
    close: short ? 99 : 101,
    high: 105,
    low: 95,
  }));
}
function event(short = false): TurnEvent {
  return {
    time: T,
    side: short ? "short" : "long",
    stop: short ? 106 : 94,
    expiresAt: T + 72 * H,
  };
}
function hour(i: number, low: number, high: number, close: number): HourCandle {
  return { closeTime: T + i * H, low, high, close };
}

describe("zero crossing event, not a persistent sign check", () => {
  it("finds a dated long event and freezes the 60-bar structure stop", () => {
    const points = history();
    const found = findTurnEvent(points, T + H)!;
    expect(found).toMatchObject({
      time: T,
      side: "long",
      expiresAt: T + 72 * H,
    });
    expect(found.stop).toBeCloseTo(95 * 0.997);
    points.push({ ...points.at(-1)!, time: T + 4 * H, low: 90 });
    expect(findTurnEvent(points, T + 5 * H)?.stop).toBe(found.stop);
  });
  it("is symmetric for short signals", () => {
    expect(findTurnEvent(history(true), T + H)).toMatchObject({
      side: "short",
      stop: 105 * 1.003,
    });
  });
  it("requires a confirmed prior opposite curve and an actual crossing", () => {
    const p = history();
    p.at(-1)!.priorConfirmed = false;
    expect(findTurnEvent(p, T + H)).toBeNull();
    expect(
      findTurnEvent(
        history().map((p) => ({ ...p, angle10: 0.01 })),
        T + H,
      ),
    ).toBeNull();
  });
  it("expires at 72h and ignores future points", () => {
    expect(findTurnEvent(history(), T + 72 * H)).toBeNull();
    expect(findTurnEvent(history(), T)).toBeNull();
  });
});

describe("1H retest lifecycle", () => {
  it("keeps non-signals in the broad watch list", () => {
    expect(evaluateRetest(history(), null, null, 100, T + H).status).toBe(
      "watch",
    );
  });
  it("marks freshly closed 4H before the first 1H close", () => {
    expect(evaluateRetest(history(), [], event(), 101, T + 10).status).toBe(
      "fresh",
    );
  });
  it("finds a fast same-hour touch and reclaim without requiring a second 4H", () => {
    const r = evaluateRetest(
      history(),
      [hour(1, 99.9, 101.3, 100.8)],
      event(),
      100.9,
      T + H + 100,
    );
    expect(r).toMatchObject({
      status: "reclaimed",
      touchTime: T + H,
      reclaimTime: T + H,
    });
  });
  it("requires a favorable close, not just a wick", () => {
    expect(
      evaluateRetest(
        history(),
        [hour(1, 99, 101, 99.5)],
        event(),
        99.5,
        T + H + 100,
      ).status,
    ).toBe("waiting");
  });
  it("reconstructs a touch and later reclaim while the page was closed", () => {
    const r = evaluateRetest(
      history(),
      [hour(1, 99, 101, 99.5), hour(2, 99.2, 101.5, 101)],
      event(),
      101,
      T + 2 * H + 100,
    );
    expect(r.status).toBe("reclaimed");
    expect(r.reclaimTime).toBe(T + 2 * H);
  });
  it("handles short retests symmetrically", () => {
    expect(
      evaluateRetest(
        history(true),
        [hour(1, 98.8, 100.1, 99.3)],
        event(true),
        99.3,
        T + H + 100,
      ).status,
    ).toBe("reclaimed");
  });
  it("does not substitute later 4H EMA into an earlier 1H retest", () => {
    const p = [
      ...history(),
      { ...history().at(-1)!, time: T + 4 * H, ema: 110 },
    ];
    const hs = [
      hour(1, 101, 102, 101.5),
      hour(2, 101, 102, 101.5),
      hour(3, 101, 102, 101.5),
      hour(4, 109, 111, 110.5),
    ];
    const r = evaluateRetest(p, hs, event(), 111, T + 4 * H + 100);
    expect(r.touchTime).toBeNull();
  });
  it("fails a historical structure breach even after the price recovers", () => {
    expect(
      evaluateRetest(
        history(),
        [hour(1, 93, 102, 101)],
        event(),
        101,
        T + H + 100,
      ).status,
    ).toBe("failed");
  });
  it("does not revive an old event after an intervening opposite 4H angle", () => {
    const p = [
      ...history(),
      { ...history().at(-1)!, time: T + 4 * H, angle10: -0.1 },
      { ...history().at(-1)!, time: T + 8 * H, angle10: 0.1 },
    ];
    expect(evaluateRetest(p, null, event(), 101, T + 8 * H + 100).status).toBe(
      "failed",
    );
  });
  it("identifies directional extension, not any absolute distance", () => {
    expect(
      evaluateRetest(
        history(),
        [hour(1, 101, 102, 101.5)],
        event(),
        104,
        T + H + 100,
      ).status,
    ).toBe("extended");
    expect(
      evaluateRetest(history(), [hour(1, 96, 98, 97)], event(), 96, T + H + 100)
        .status,
    ).toBe("waiting");
  });
  it("does not label failed requests, missing bars, or malformed bars as waiting", () => {
    expect(
      evaluateRetest(history(), null, event(), 101, T + H + 100).status,
    ).toBe("unavailable");
    expect(
      evaluateRetest(
        history(),
        [hour(2, 99, 101, 100.5)],
        event(),
        101,
        T + 2 * H + 100,
      ).status,
    ).toBe("unavailable");
    expect(
      evaluateRetest(
        history(),
        [hour(1, NaN, 101, 100.5)],
        event(),
        101,
        T + H + 100,
      ).status,
    ).toBe("unavailable");
  });
  it("excludes unclosed hours and expired events", () => {
    expect(
      evaluateRetest(history(), [hour(1, 93, 102, 101)], event(), 101, T + 100)
        .status,
    ).toBe("fresh");
    expect(
      evaluateRetest(history(), null, event(), 101, T + 72 * H).event,
    ).toBeNull();
  });
  it("ships the identical tested implementation to the browser", () => {
    const browser = Function(
      CANDIDATE_BROWSER_SOURCE + ";return {findTurnEvent,evaluateRetest}",
    )();
    expect(browser.findTurnEvent(history(), T + H)).toEqual(
      findTurnEvent(history(), T + H),
    );
    const input: Parameters<typeof evaluateRetest> = [
      history(),
      [hour(1, 99, 101, 100.5)],
      event(),
      101,
      T + H + 100,
    ];
    expect(browser.evaluateRetest(...input)).toEqual(evaluateRetest(...input));
  });
});
