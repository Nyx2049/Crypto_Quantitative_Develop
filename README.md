# 币安 USDT 永续 4H EMA99 趋势扫描器

一个按需执行的极简 Cloudflare Worker。点击“立即扫描”后，只访问币安官方 USDⓈ-M Futures 公共 API，按 24 小时 `quoteVolume` 筛选高流动性 USDT 永续合约，并展示 EMA99 趋势、角度动量与可能的方向变化。无需 API Key、数据库或定时任务。

## 功能与口径

- 使用 `https://fapi.binance.com`，失败时依次尝试 `fapi1` 至 `fapi4` 官方备用地址；不回退到第三方数据。
- 合约必须为 `USDT` 报价、`PERPETUAL`、`TRADING`，排除稳定币、杠杆代币和临近交割标的。
- 默认请求 320 根 4H K线，仅使用 `closeTime < 当前时间` 的已收盘 K线；不足 150 根会跳过。
- 当前价格取 Mark Price。Open Interest 名义价值为 `openInterest × Mark Price`。
- 趋势按 10 根 EMA99 角度分类，角度使用每根百分比斜率标准化。
- 单个币对异常只记录在响应的 `errors` 中；基础接口完全失败会返回接口、状态码和响应摘要。
- 所有响应均设置 `no-store`。

## 本地运行

要求 Node.js 20+。

```bash
npm install
npm run dev
```

打开 Wrangler 输出的地址（通常为 `http://localhost:8787`）。JSON API 是 `/api/scan`，健康检查是 `/health`。

质量检查：

```bash
npm test
npm run lint
npm run format:check
npm run build
```

## Cloudflare 部署

```bash
npm install
npx wrangler login
npm run deploy
```

部署命令会输出 `workers.dev` 地址。手机浏览器直接打开该地址并点击“立即扫描”；完整表格可横向滑动。

### 配置

配置位于 `wrangler.jsonc` 的 `vars`，均非密钥：

| 变量                  | 默认值 | 说明                         |
| --------------------- | -----: | ---------------------------- |
| `TOP_N`               |   `20` | 成功扫描的高流动性交易对数量 |
| `EMA_PERIOD`          |   `99` | EMA 周期                     |
| `KLINE_INTERVAL`      |   `4h` | K线周期                      |
| `KLINE_LIMIT`         |  `320` | 每个候选交易对请求的 K线根数 |
| `REQUEST_CONCURRENCY` |    `5` | 并发扫描数                   |

无需 `.env`、API Key 或 Secret。若部署区域无法访问币安，页面会显示所有官方地址的失败状态；可更换 Cloudflare Worker 路由后重试，不应接入非官方镜像。

## API 响应

`GET /api/scan` 返回扫描时间、耗时、最近已收盘 K线时间、完整 `rows`、重点分组 `highlights`、市场统计 `market` 和被跳过币对的 `errors`。时间戳为 Unix 毫秒；网页统一按北京时间（`Asia/Shanghai`）显示。

技术指标不构成投资建议。
