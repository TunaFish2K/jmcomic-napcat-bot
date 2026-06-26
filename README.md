# jmcomic-napcat-bot

为 NapCat 机器人提供 JMComic 本子查询与 PDF 生成服务的 pnpm monorepo。

## 子包

| 子包 | 路径 | 说明 |
|---|---|---|
| `@jmcomic/api` | `packages/api` | HTTP API 服务：信息查询、PDF 生成与缓存 |
| `@jmcomic/bot` | `packages/bot` | QQ 机器人：基于 `node-napcat-ts` 接收指令并调用 API |

## 功能

- **本子信息查询**：`/info/:id` 返回标题、描述、作者、标签、浏览量、点赞数、**封面图片**。
- **PDF 异步生成**：`/makePDF/:id` 将任务推入队列，后台 Worker 并发生成 PDF。
- **PDF 文件获取**：`/pdf/:id` 返回已缓存的 PDF；未就绪时返回状态供轮询。
- **本机模式**：`/pdf/local/:id` 返回缓存 PDF 的本地绝对路径（仅 localhost）。
- **PDF 硬盘缓存**：FIFO 淘汰策略，支持手动清理，总量上限可配置。
- **图片解密**：移植自 jmcomic-web-client 的 slice 逆序解密算法，服务端使用 `sharp` 实现。

## 安装

```bash
pnpm install
```

## 运行

### API 服务

```bash
# 开发（热重载）
pnpm dev:api

# 生产
pnpm build
pnpm start:api
```

API 默认监听 `http://localhost:8088`。

### QQ 机器人

```bash
# 开发（热重载）
pnpm dev:bot

# 生产
pnpm build
pnpm start:bot
```

## 配置

### API 配置

`packages/api/src/constants.ts`：

| 常量 | 默认值 | 说明 |
|---|---|---|
| `DEV_PORT` | `8088` | 服务端口 |
| `UPSTREAM_BASE_URL` | `https://jmserver.2kb.fish` | 上游 API 地址 |
| `UPSTREAM_TIMEOUT_MS` | `10000` | 上游 API 超时 |
| `INFO_CACHE_TTL_SECONDS` | `600` | 本子信息缓存时间 |
| `INFO_CACHE_MAX_KEYS` | `100` | 本子信息缓存最大条目 |
| `MAX_TASK_QUEUED` | `100` | PDF 任务队列上限 |
| `PDF_CACHE_DIR` | `./cache/pdf` | PDF 缓存目录 |
| `PDF_CACHE_MAX_SIZE` | `10 GB` | PDF 缓存硬盘上限 |
| `WORKER_POOL_SIZE` | `3` | 并发生成 PDF 的 Worker 数 |
| `MAX_RETRIES` | `3` | 失败任务重试次数 |
| `ERROR_TTL_MS` | `1 hour` | 错误状态保留时间 |
| `IMAGE_DOWNLOAD_TIMEOUT_MS` | `30 s` | 单张图片下载超时 |
| `PDF_DOWNLOAD_CONCURRENCY` | `5` | 并发下载图片数 |

### Bot 配置（环境变量）

```bash
NAPCAT_WS_URL=ws://localhost:3001      # Napcat WebSocket 地址
NAPCAT_ACCESS_TOKEN=                   # Napcat 访问令牌（可选）
API_BASE_URL=http://localhost:8088     # API 服务地址
LOCAL_MODE=false                       # 是否本机模式（直接读取 API 缓存路径）
```

## API

### `GET /health`

健康检查。

```json
{
  "alive": true,
  "shuttingDown": false,
  "queueLength": 0,
  "activeWorkers": 0
}
```

### `GET /info/:id`

查询本子信息（含封面 data URL）。

```bash
curl http://localhost:8088/info/12345
```

### `POST /makePDF/:id`

触发 PDF 生成。

```bash
curl -X POST http://localhost:8088/makePDF/12345
```

### `GET /pdf/status/:id`

轮询状态。

```bash
curl http://localhost:8088/pdf/status/12345
```

### `GET /pdf/:id`

获取 PDF 文件。

```bash
curl -O http://localhost:8088/pdf/12345
```

### `GET /pdf/local/:id`（本机模式）

仅允许 localhost 访问，返回本地绝对路径。

```bash
curl http://localhost:8088/pdf/local/12345
```

## 机器人指令

机器人在**群聊中仅当被 @ 时**响应，支持以下指令：

### 查询本子

```text
@bot /query 12345
@bot /查询 12345
@bot /本子 12345
```

返回本子信息文本 + 封面图片。

### 下载 PDF

```text
@bot /pdf 12345
@bot /download 12345
@bot /dl 12345
```

机器人会回复“生成中”，后台轮询 API，生成完毕后发送 PDF 文件。

## 本机模式

当 `LOCAL_MODE=true` 时，机器人通过 `GET /pdf/local/:id` 获取 API 服务本地缓存文件的路径，直接读取文件内容到 Buffer，再以 `Structs.file(buffer, name)` 发送。这样可以避免机器人与 API 之间的 HTTP 文件传输，同时兼容 Napcat 运行在 Docker 等隔离环境中的场景（因为最终发给 Napcat 的是 base64 编码的 Buffer，不是文件路径）。

要求机器人能够访问 API 服务的 `PDF_CACHE_DIR` 所在文件系统。

## 目录结构

```text
jmcomic-napcat-bot/
├── packages/
│   ├── api/
│   │   ├── src/
│   │   │   ├── index.ts        # Express 路由与 Worker
│   │   │   ├── upstream.ts     # 上游 API 封装
│   │   │   ├── pdf.ts          # PDF 生成
│   │   │   ├── image.ts        # 图片下载、解密、封面
│   │   │   ├── data.ts         # TaskQueue、PDFCache、任务状态
│   │   │   └── constants.ts    # 配置常量
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── bot/
│       ├── src/
│       │   ├── index.ts        # Napcat 连接与消息监听
│       │   ├── config.ts       # 环境变量配置
│       │   ├── api-client.ts   # 调用 API
│       │   ├── commands.ts     # 指令解析与执行
│       │   └── reply.ts        # 发送消息/图片/文件
│       ├── package.json
│       └── tsconfig.json
├── package.json
├── pnpm-workspace.yaml
└── README.md
```

## 依赖

### API
- [express](https://expressjs.com/)
- [pdf-lib](https://pdf-lib.js.org/)
- [sharp](https://sharp.pixelplumbing.com/)
- [p-limit](https://github.com/sindresorhus/p-limit)
- [node-cache](https://github.com/node-cache/node-cache)
- [@sinclair/typebox](https://github.com/sinclairzx81/typebox)

### Bot
- [node-napcat-ts](https://github.com/HkTeamX/node-napcat-ts)
