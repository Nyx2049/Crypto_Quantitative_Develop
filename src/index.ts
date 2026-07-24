import { BinanceApiError, BinanceClient, scanMarket } from "./binance";
import { buildPage } from "./page";

interface Env {
  TOP_N?: string;
  EMA_PERIOD?: string;
  KLINE_INTERVAL?: string;
  KLINE_LIMIT?: string;
  REQUEST_CONCURRENCY?: string;
  ENABLE_EXIT_STRATEGY?: string;
}

function getConfig(env: Env) {
  return {
    topN: Number(env.TOP_N || 20),
    emaPeriod: Number(env.EMA_PERIOD || 99),
    interval: env.KLINE_INTERVAL || "4h",
    klineLimit: Number(env.KLINE_LIMIT || 320),
    concurrency: Number(env.REQUEST_CONCURRENCY || 5),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "access-control-allow-origin": "*",
    },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET")
      return json({ error: "仅支持 GET 请求" }, 405);
    if (url.pathname === "/")
      return new Response(buildPage(env.ENABLE_EXIT_STRATEGY !== "false"), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    if (url.pathname === "/api/scan") {
      try {
        return json(await scanMarket(new BinanceClient(), getConfig(env)));
      } catch (error) {
        console.error(error);
        if (error instanceof BinanceApiError)
          return json(
            {
              error: error.message,
              endpoint: error.endpoint,
              details: error.attempts,
            },
            502,
          );
        return json(
          { error: error instanceof Error ? error.message : "未知扫描错误" },
          500,
        );
      }
    }
    if (url.pathname === "/health") return json({ ok: true });
    return json({ error: "Not Found" }, 404);
  },
} satisfies ExportedHandler<Env>;
