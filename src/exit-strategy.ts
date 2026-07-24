export type PositionSide = "long" | "short";
export type ClosePercentage = 0 | 25 | 50 | 100;

export interface PositionTracking {
  trackedAt: number;
  updatedAt: number;
  lastScanAt: number;
  bestPrice: number;
  protectiveStop: number;
}

export interface ExitPosition {
  side: PositionSide;
  entry: number;
  stop: number;
  tracking?: Partial<PositionTracking>;
}

export interface ExitMarket {
  markPrice: number;
  ema99: number;
  angle5: number;
  angle10: number;
  atr14: number;
  volatilityRatio: number;
  twoClosesBelowEma: boolean;
  twoClosesAboveEma: boolean;
  twoBarsNoNewHigh: boolean;
  twoBarsNoNewLow: boolean;
  recommendedSide: string;
  lastClosedTime: number;
  hourly?: {
    ema99: number;
    angle5: number;
    angle10: number;
    twoClosesBelowEma: boolean;
    twoClosesAboveEma: boolean;
    lastClosedTime: number;
  } | null;
}

export interface ExitRecommendation {
  closePercentage: ClosePercentage;
  action: string;
  pnlPercentage: number | null;
  profitR: number | null;
  atrPercentage: number;
  volatilityRatio: number;
  protectiveStop: number;
  reasons: string[];
  tracking: PositionTracking;
}

interface AtrCandle {
  high: number;
  low: number;
  close: number;
}

export function calculateAtr(candles: AtrCandle[], period = 14): number {
  if (period < 1 || candles.length <= period) return 0;
  const ranges = candles.slice(1).map((candle, index) => {
    const previousClose = candles[index].close;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    );
  });
  if (ranges.length < period) return 0;
  let atr =
    ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const range of ranges.slice(period))
    atr = (atr * (period - 1) + range) / period;
  return atr;
}

function finitePositive(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function evaluateExitStrategy(
  position: ExitPosition,
  market: ExitMarket,
  now = Date.now(),
): ExitRecommendation {
  const isLong = position.side === "long";
  const price = market.markPrice;
  const prior = position.tracking;
  const trackedAt = finitePositive(prior?.trackedAt) || now;
  const previousBest = finitePositive(prior?.bestPrice);
  const bestPrice = previousBest
    ? isLong
      ? Math.max(previousBest, price)
      : Math.min(previousBest, price)
    : price;
  const risk =
    position.entry > 0 && position.stop > 0
      ? Math.abs(position.entry - position.stop)
      : 0;
  const pnlPercentage =
    position.entry > 0
      ? (isLong ? price / position.entry - 1 : position.entry / price - 1) * 100
      : null;
  const profitR =
    risk > 0
      ? (isLong ? price - position.entry : position.entry - price) / risk
      : null;
  const atrPercentage = price > 0 ? (market.atr14 / price) * 100 : 0;
  const volatilityRatio =
    Number.isFinite(market.volatilityRatio) && market.volatilityRatio > 0
      ? market.volatilityRatio
      : 1;
  const volatilitySpike = volatilityRatio >= 1.35;
  const shortTermAdverse = isLong ? market.angle5 < 0 : market.angle5 > 0;
  const mediumTermAdverse = isLong ? market.angle10 < 0 : market.angle10 > 0;
  const twoWrong = isLong ? market.twoClosesBelowEma : market.twoClosesAboveEma;
  const noProgress = isLong ? market.twoBarsNoNewHigh : market.twoBarsNoNewLow;
  const oppositeConfirmed = isLong
    ? market.recommendedSide === "做空"
    : market.recommendedSide === "做多";
  const hourly = market.hourly;
  const hourlyAngleAdverse = hourly
    ? isLong
      ? hourly.angle5 < 0 && hourly.angle10 < 0
      : hourly.angle5 > 0 && hourly.angle10 > 0
    : false;
  const hourlyTwoWrong = hourly
    ? isLong
      ? hourly.twoClosesBelowEma
      : hourly.twoClosesAboveEma
    : false;
  const hourlyProfitWarning =
    pnlPercentage !== null &&
    pnlPercentage > 0 &&
    (hourlyTwoWrong || hourlyAngleAdverse);

  let candidateStop = finitePositive(position.stop);
  if (profitR !== null && profitR >= 1 && position.entry > 0)
    candidateStop = isLong
      ? Math.max(candidateStop, position.entry)
      : candidateStop
        ? Math.min(candidateStop, position.entry)
        : position.entry;
  if (profitR !== null && profitR >= 1.5 && market.atr14 > 0) {
    const multiplier = volatilitySpike ? 1.5 : 2;
    const atrStop = isLong
      ? bestPrice - multiplier * market.atr14
      : bestPrice + multiplier * market.atr14;
    candidateStop = isLong
      ? Math.max(candidateStop, atrStop)
      : candidateStop
        ? Math.min(candidateStop, atrStop)
        : atrStop;
  }
  const previousProtective = finitePositive(prior?.protectiveStop);
  const protectiveStop = previousProtective
    ? isLong
      ? Math.max(previousProtective, candidateStop)
      : candidateStop
        ? Math.min(previousProtective, candidateStop)
        : previousProtective
    : candidateStop;
  const protectiveHit =
    protectiveStop > 0 &&
    (isLong ? price <= protectiveStop : price >= protectiveStop);
  const structuralHit =
    position.stop > 0 &&
    (isLong ? price <= position.stop : price >= position.stop);

  let closePercentage: ClosePercentage = 0;
  const reasons: string[] = [];
  if (structuralHit) reasons.push("已触及结构止损");
  if (protectiveHit) reasons.push("已触及只收紧不放宽的 ATR 利润保护价");
  if (oppositeConfirmed) reasons.push("EMA99 已确认形成持仓反方向候选");
  if (twoWrong) reasons.push("连续两根 4H 收盘站到 EMA99 错误一侧");

  if (
    structuralHit ||
    protectiveHit ||
    oppositeConfirmed ||
    (twoWrong && mediumTermAdverse)
  )
    closePercentage = 100;
  else if (
    twoWrong ||
    (shortTermAdverse && mediumTermAdverse) ||
    (profitR !== null &&
      profitR >= 2 &&
      volatilitySpike &&
      (shortTermAdverse || noProgress))
  )
    closePercentage = 50;
  else if (
    hourlyProfitWarning ||
    shortTermAdverse ||
    (profitR !== null && profitR >= 1 && volatilitySpike) ||
    (profitR !== null && profitR >= 1.5 && noProgress)
  )
    closePercentage = 25;

  if (volatilitySpike)
    reasons.push(
      `近期 ATR 波动升高至基准的 ${volatilityRatio.toFixed(2)} 倍，仅用于收紧保护`,
    );
  if (shortTermAdverse) reasons.push("Angle5 已向持仓反方向弯折");
  if (mediumTermAdverse) reasons.push("Angle10 已转到持仓反方向");
  if (noProgress) reasons.push(`连续两根 4H 未继续创新${isLong ? "高" : "低"}`);
  if (hourlyProfitWarning)
    reasons.push(
      hourlyTwoWrong
        ? "已有浮盈，1H 连续两根收盘处于 EMA99 错误一侧，提前保护 25%"
        : "已有浮盈，1H EMA99 的 Angle5 与 Angle10 同时反向，提前保护 25%",
    );
  if (!reasons.length) reasons.push("趋势尚未触发分批平仓条件");

  return {
    closePercentage,
    action: closePercentage ? `建议平仓 ${closePercentage}%` : "继续持有",
    pnlPercentage,
    profitR,
    atrPercentage,
    volatilityRatio,
    protectiveStop,
    reasons,
    tracking: {
      trackedAt,
      updatedAt: finitePositive(prior?.updatedAt) || trackedAt,
      lastScanAt: market.lastClosedTime || now,
      bestPrice,
      protectiveStop,
    },
  };
}

// The page is intentionally browser-direct. Keep its exit engine in this isolated
// module, then inject the same implementation into the static Worker-served page.
export const EXIT_STRATEGY_BROWSER_SOURCE = String.raw`
function exitAtr(candles,period=14){if(period<1||candles.length<=period)return 0;const ranges=candles.slice(1).map((c,i)=>Math.max(c.high-c.low,Math.abs(c.high-candles[i].close),Math.abs(c.low-candles[i].close)));if(ranges.length<period)return 0;let atr=ranges.slice(0,period).reduce((s,v)=>s+v,0)/period;for(const range of ranges.slice(period))atr=(atr*(period-1)+range)/period;return atr}
function evaluateExitStrategy(p,row,now=Date.now()){const isLong=p.side==='long',price=row.markPrice,prior=p.tracking||{},positive=v=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):0,trackedAt=positive(prior.trackedAt)||now,previousBest=positive(prior.bestPrice),bestPrice=previousBest?(isLong?Math.max(previousBest,price):Math.min(previousBest,price)):price,risk=p.entry>0&&p.stop>0?Math.abs(p.entry-p.stop):0,pnl=p.entry>0?(isLong?price/p.entry-1:p.entry/price-1)*100:null,profitR=risk>0?(isLong?price-p.entry:p.entry-price)/risk:null,atrPct=price>0?row.atr14/price*100:0,volatilityRatio=Number.isFinite(row.volatilityRatio)&&row.volatilityRatio>0?row.volatilityRatio:1,volatilitySpike=volatilityRatio>=1.35,shortAdverse=isLong?row.angle5<0:row.angle5>0,mediumAdverse=isLong?row.angle10<0:row.angle10>0,twoWrong=isLong?row.twoClosesBelowEma:row.twoClosesAboveEma,noProgress=isLong?row.twoBarsNoNewHigh:row.twoBarsNoNewLow,opposite=isLong?row.recommendedSide==='做空':row.recommendedSide==='做多',hourly=row.hourly,hourlyAngleAdverse=hourly?(isLong?hourly.angle5<0&&hourly.angle10<0:hourly.angle5>0&&hourly.angle10>0):false,hourlyTwoWrong=hourly?(isLong?hourly.twoClosesBelowEma:hourly.twoClosesAboveEma):false,hourlyProfitWarning=pnl!==null&&pnl>0&&(hourlyTwoWrong||hourlyAngleAdverse);let candidate=positive(p.stop);if(profitR!==null&&profitR>=1&&p.entry>0)candidate=isLong?Math.max(candidate,p.entry):(candidate?Math.min(candidate,p.entry):p.entry);if(profitR!==null&&profitR>=1.5&&row.atr14>0){const multiple=volatilitySpike?1.5:2,atrStop=isLong?bestPrice-multiple*row.atr14:bestPrice+multiple*row.atr14;candidate=isLong?Math.max(candidate,atrStop):(candidate?Math.min(candidate,atrStop):atrStop)}const oldProtective=positive(prior.protectiveStop),protectiveStop=oldProtective?(isLong?Math.max(oldProtective,candidate):(candidate?Math.min(oldProtective,candidate):oldProtective)):candidate,protectiveHit=protectiveStop>0&&(isLong?price<=protectiveStop:price>=protectiveStop),structuralHit=p.stop>0&&(isLong?price<=p.stop:price>=p.stop);let closePercentage=0;const reasons=[];if(structuralHit)reasons.push('已触及结构止损');if(protectiveHit)reasons.push('已触及只收紧不放宽的 ATR 利润保护价');if(opposite)reasons.push('EMA99 已确认形成持仓反方向候选');if(twoWrong)reasons.push('连续两根 4H 收盘站到 EMA99 错误一侧');if(structuralHit||protectiveHit||opposite||(twoWrong&&mediumAdverse))closePercentage=100;else if(twoWrong||(shortAdverse&&mediumAdverse)||(profitR!==null&&profitR>=2&&volatilitySpike&&(shortAdverse||noProgress)))closePercentage=50;else if(hourlyProfitWarning||shortAdverse||(profitR!==null&&profitR>=1&&volatilitySpike)||(profitR!==null&&profitR>=1.5&&noProgress))closePercentage=25;if(volatilitySpike)reasons.push('近期 ATR 波动升高至基准的 '+volatilityRatio.toFixed(2)+' 倍，仅用于收紧保护');if(shortAdverse)reasons.push('4H Angle5 已向持仓反方向弯折');if(mediumAdverse)reasons.push('4H Angle10 已转到持仓反方向');if(noProgress)reasons.push('连续两根 4H 未继续创新'+(isLong?'高':'低'));if(hourlyProfitWarning)reasons.push(hourlyTwoWrong?'已有浮盈，1H 连续两根收盘处于 EMA99 错误一侧，提前保护 25%':'已有浮盈，1H EMA99 的 Angle5 与 Angle10 同时反向，提前保护 25%');if(!reasons.length)reasons.push('趋势尚未触发分批平仓条件');return{closePercentage,action:closePercentage?'建议平仓 '+closePercentage+'%':'继续持有',pnl,profitR,atrPct,volatilityRatio,protectiveStop,reasons,tracking:{trackedAt,updatedAt:positive(prior.updatedAt)||trackedAt,lastScanAt:row.lastClosedTime||now,bestPrice,protectiveStop}}}
`;
