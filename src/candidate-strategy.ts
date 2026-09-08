/** ZeroSlope 2.0: 4H chooses the context; completed 1H candles describe the retest.
 * Pure functions are shared with the inline browser, not reimplemented there.
 */
export interface TrendPoint {
  time: number;
  ema: number;
  angle10: number;
  priorConfirmed: boolean;
  priorDirection: string;
  close: number;
  high: number;
  low: number;
}
export interface HourCandle {
  closeTime: number;
  high: number;
  low: number;
  close: number;
}
export interface TurnEvent {
  time: number;
  side: "long" | "short";
  stop: number;
  expiresAt: number;
}
export interface CandidateState {
  status:
    | "watch"
    | "fresh"
    | "waiting"
    | "reclaimed"
    | "extended"
    | "failed"
    | "unavailable";
  label: string;
  detail: string;
  event: TurnEvent | null;
  touchTime: number | null;
  reclaimTime: number | null;
}

export function findTurnEvent(
  points: TrendPoint[],
  now: number,
  watchHours = 72,
): TurnEvent | null {
  for (let i = points.length - 1; i > 0; i--) {
    const p = points[i],
      prev = points[i - 1];
    if (
      p.time >= now ||
      now - p.time >= watchHours * 3600000 ||
      !p.priorConfirmed
    )
      continue;
    const long =
      p.angle10 > 0 && prev.angle10 <= 0 && p.priorDirection === "down";
    const short =
      p.angle10 < 0 && prev.angle10 >= 0 && p.priorDirection === "up";
    if (!long && !short) continue;
    const structure = points.slice(Math.max(0, i - 59), i + 1);
    if (structure.length < 60) continue;
    const stop = long
      ? Math.min(...structure.map((x) => x.low)) * 0.997
      : Math.max(...structure.map((x) => x.high)) * 1.003;
    if (
      !Number.isFinite(stop) ||
      stop <= 0 ||
      (long ? stop >= p.close : stop <= p.close)
    )
      continue;
    return {
      time: p.time,
      side: long ? "long" : "short",
      stop,
      expiresAt: p.time + watchHours * 3600000,
    };
  }
  return null;
}

export function evaluateRetest(
  points: TrendPoint[],
  hourly: HourCandle[] | null,
  event: TurnEvent | null,
  markPrice: number,
  now: number,
  settings = { touchPct: 0.35, extendedPct: 3 },
): CandidateState {
  const result: CandidateState = {
    status: "watch",
    label: "零度观察",
    detail: "近 72h 无有效反向穿零，保留观察，不强行给方向。",
    event,
    touchTime: null,
    reclaimTime: null,
  };
  if (!event || now >= event.expiresAt) return { ...result, event: null };
  const sign = event.side === "long" ? 1 : -1;
  const latest = points.at(-1);
  if (!latest || !Number.isFinite(markPrice) || markPrice <= 0)
    return {
      ...result,
      status: "unavailable",
      label: "数据待补齐",
      detail: "当前行情无效，暂不判断。",
    };
  // Once a post-signal 4H angle flips back, this event stays invalid even if price recovers.
  if (
    points.some(
      (p) => p.time > event.time && p.time < now && p.angle10 * sign <= 0,
    )
  )
    return {
      ...result,
      status: "failed",
      label: "转向失效",
      detail: "穿零后 4H Angle10 已回到原方向，旧信号不复活。",
    };
  if ((markPrice - event.stop) * sign <= 0)
    return {
      ...result,
      status: "failed",
      label: "结构失效",
      detail: "现价已触及本次穿零时固定的结构参考价。",
    };
  if (hourly === null)
    return {
      ...result,
      status: "unavailable",
      label: "1H 待补齐",
      detail: "4H 候选仍保留；1H 请求失败，不能判断回踩。",
    };
  const hours = hourly
    .filter(
      (h) =>
        h.closeTime > event.time &&
        h.closeTime < now &&
        [h.high, h.low, h.close].every((v) => Number.isFinite(v) && v > 0) &&
        h.high >= h.close &&
        h.low <= h.close &&
        h.high >= h.low,
    )
    .sort((a, b) => a.closeTime - b.closeTime);
  const expectedLast = Math.floor(now / 3600000) * 3600000 - 1;
  if (
    expectedLast > event.time &&
    (!hours.length ||
      hours[0].closeTime !== event.time + 3600000 ||
      hours.at(-1)!.closeTime !== expectedLast ||
      hours.some(
        (h, i) => i > 0 && h.closeTime - hours[i - 1].closeTime !== 3600000,
      ))
  )
    return {
      ...result,
      status: "unavailable",
      label: "1H 数据不完整",
      detail: "已收盘小时线存在缺口，不推断回踩已经完成。",
    };
  const signal = points.find((p) => p.time === event.time);
  let wasOnSide = !!signal && (signal.close - signal.ema) * sign > 0;
  for (const h of hours) {
    if (event.side === "long" ? h.low <= event.stop : h.high >= event.stop)
      return {
        ...result,
        status: "failed",
        label: "结构失效",
        detail: "穿零后的 1H 高低价曾触及结构参考价，旧信号不复活。",
      };
    // Use the 4H EMA known at the OPEN of this hour, never a later 4H close.
    const reference = [...points]
      .reverse()
      .find((p) => p.time < h.closeTime - 3600000 + 1);
    if (!reference)
      return {
        ...result,
        status: "unavailable",
        label: "基准不足",
        detail: "缺少该小时开始前已收盘的 4H EMA99。",
      };
    const band = (reference.ema * settings.touchPct) / 100;
    const touched =
      h.low <= reference.ema + band && h.high >= reference.ema - band;
    const onSide = (h.close - reference.ema) * sign > 0;
    if (wasOnSide && touched) {
      result.touchTime = h.closeTime;
      result.reclaimTime = null;
    }
    if (result.touchTime !== null) {
      if (onSide && result.reclaimTime === null)
        result.reclaimTime = h.closeTime;
      if (!onSide) result.reclaimTime = null;
    }
    if (onSide) wasOnSide = true;
  }
  const directionalDistance = (markPrice / latest.ema - 1) * 100 * sign;
  if (directionalDistance > settings.extendedPct)
    return {
      ...result,
      status: "extended",
      label: "已走远 · 不追",
      detail:
        "现价沿候选方向距 4H EMA99 超过 " +
        settings.extendedPct +
        "%，回踩记录保留。",
    };
  if (result.reclaimTime !== null && directionalDistance > 0)
    return {
      ...result,
      status: "reclaimed",
      label: "回踩已收回",
      detail:
        "已收盘 1H 触及 4H EMA99 ±" +
        settings.touchPct +
        "% 后收回候选侧；不是确定入场，盘中路径无法还原。",
    };
  if (!hours.length)
    return {
      ...result,
      status: "fresh",
      label: "刚刚转向",
      detail: "4H 已确认反向穿零；尚无信号后的已收盘 1H。",
    };
  return {
    ...result,
    status: "waiting",
    label: result.touchTime ? "回踩中 · 待收回" : "等待回踩",
    detail: "候选继续保留至穿零后 72h，不要求再等一整根 4H 确认。",
  };
}

export const CANDIDATE_BROWSER_SOURCE = `const findTurnEvent = ${findTurnEvent.toString()};\nconst evaluateRetest = ${evaluateRetest.toString()};`;
