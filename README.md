# 零度雷达 ZeroSlope

一个专注于币安 USDⓈ-M 永续合约的 4H EMA99 趋势筛选器。

零度雷达不会给出交易指令。它从高流动性合约中找出 EMA99 角度最接近水平、趋势最陡、正在加速或可能改变方向的标的，供交易者再到 Binance 或 Hyperliquid 人工确认。

线上地址：

<https://binance-ema99-scanner.ema99-scanner-cw2046.workers.dev>

## 策略适配币对 1.0

策略适配排名使用最近 10 根 4H K线对应的 EMA99 角度：

```text
SlopePctPerBar = [(EMA_now / EMA_10_bars_ago) - 1] × 100 / 10
Angle10 = atan(SlopePctPerBar) × 180 / π
```

排名按照 `|Angle10|` 从小到大排列。正角度和负角度一起比较，越接近 `0°` 越靠前：

```text
+0.01°
-0.03°
+0.06°
-0.08°
```

这只表示 EMA99 越接近水平状态，不代表确定反转或进场信号。

## 页面内容

- 固定关注：比特币、QQQ 和 SK Hynix 独立展示在第一排。
- 策略适配币对：Angle10 绝对值最小的前 10 个合约。
- 趋势观察：最陡上涨、最陡下跌、加速上涨、加速下降和可能转向。
- 完整扫描表：默认按 Angle10 距离零度排序，可点击表头重新排序。
- 市场状态：统计 EMA99 方向、价格相对 EMA99 的位置和趋势扩散程度。
- 异常记录：单个合约失败不会中断整次扫描。

## 数据与计算口径

- 数据只来自 Binance 官方 USDⓈ-M Futures 公共 API。
- 主地址为 `fapi.binance.com`，失败时依次尝试 `fapi1` 至 `fapi4` 官方备用地址。
- 不需要 Binance API Key，不使用数据库或第三方行情。
- 扫描 `USDT + PERPETUAL + TRADING` 合约，排除稳定币、杠杆代币和交割合约。
- 普通币按最近 24 小时 `quoteVolume` 选择高流动性候选，最终展示 Top20。
- 每个合约请求 320 根 4H K线，只计算已经收盘且有效的 K线。
- 当前价格使用 Mark Price。
- Open Interest 名义价值按 `Open Interest × Mark Price` 估算。
- 页面时间统一显示为北京时间 UTC+8。

EMA99 使用前 99 个收盘价的简单平均值作为初始值，之后按标准 EMA 递推：

```text
α = 2 / (99 + 1)
EMA_t = Close_t × α + EMA_(t-1) × (1 - α)
```

## 当前架构

Cloudflare Worker 负责提供网页。点击“立即扫描”后，浏览器直接请求 Binance 官方 API，并在本地完成 EMA99 和角度计算。

采用浏览器直连是因为 Binance 会对部分 Cloudflare Worker 出口节点返回 `403 Forbidden`。这种结构具有以下特点：

- 不需要自建服务器，也不需要电脑长期在线。
- Cloudflare 只负责托管轻量页面。
- 行情不会经过自建中转服务。
- 手机或电脑所在网络必须能够访问 `fapi.binance.com`。
- `/api/scan` 保留为服务端接口，但在 Binance 拒绝 Cloudflare 出口的区域可能返回 403 汇总错误。

## 固定关注配置

固定合约集中配置在 [`src/page.ts`](src/page.ts)：

```js
const PINNED_PAIRS = [
  { label: "比特币", symbol: "BTCUSDT" },
  { label: "纳指 QQQ", symbol: "QQQUSDT" },
  { label: "海力士", symbol: "SKHYNIXUSDT" },
];
```

固定 TradFi 合约不依赖普通币的批量行情集合，而是分别请求指定符号的：

- `/fapi/v1/ticker/24hr`
- `/fapi/v1/premiumIndex`
- `/fapi/v1/klines`
- `/fapi/v1/openInterest`

修改 `label` 和 `symbol` 后重新部署即可更换第一排合约。不存在或不可用的合约会明确显示错误，不会生成虚假数据。

## 本地开发

需要 Node.js 20 或更高版本。

```bash
npm install
npm run dev
```

打开 Wrangler 输出的本地地址，通常为 <http://localhost:8787>。

常用检查命令：

```bash
npm test
npm run lint
npm run format:check
npm run typecheck
npm run build
```

## 部署

首次部署需要登录自己的 Cloudflare 账户：

```bash
npx wrangler login
npm run deploy
```

后续修改代码后，只需重新执行：

```bash
npm run deploy
```

项目不需要 `.env`、API Key 或 Secret。当前免费套餐足以覆盖个人按需使用，实际额度以 Cloudflare Workers 官方说明为准。

## 故障排查

### 网页打不开

部分网络可能无法直接访问 `workers.dev`。可以切换网络、使用代理，或为 Worker 绑定自己的 Cloudflare 域名。

### 所有 Binance 地址均失败

查看页面展示的实际状态：

- `403`：Binance 拒绝当前出口或所在地区访问。
- `418` / `429`：请求频率过高，稍后重试。
- 网络或 CORS 错误：当前浏览器网络无法直连 Binance API。

系统不会静默切换到第三方行情。

### 单个合约没有数据

可能是合约尚未积累 150 根已收盘 4H K线、已经停止交易，或该符号不在 Binance USDⓈ-M 永续池。其他合约仍会继续扫描。

## 免责声明

技术指标不构成投资建议。
