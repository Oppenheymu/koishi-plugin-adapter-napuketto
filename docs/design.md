# koishi-plugin-adapter-napuketto 设计

> **定位**：NapukettoQQ 的 Koishi 适配器——把 NapukettoQQ（自研 QQ NT `wrapper.node` 协议层）
> 嵌入 Koishi，让 Koishi 直接驱动 QQ，无需 NapCat、无需独立进程、无 WebUI 依赖。
> **配套**：主仓库 `docs/architecture.md`（分层/ADR/红线）、`docs/STATUS.md`（现状 + 决策点）、
> `packages/kernel/docs/design.md`（核心装配）、`packages/loader/docs/design.md`（引导）。
> 新对话先读主仓库 STATUS → AGENTS.md → architecture.md → 本文件。

---

## 1. 边界

- **做**：koishi 插件壳（`apply` 生命周期、配置 schema、登录交互）、自建宿主子进程编排、
  事件翻译（kernel 事件 → koishi session）、动作调用（koishi → kernel API）。
- **不做**：不直接触碰 `wrapper.node` / session / 原生 listener（kernel 唯一原生交互层）；
  不做协议语义翻译（adapter 包负责）；不做媒体转码（media 包负责）。

依赖方向（遵循主仓库硬约束）：

```
koishi-plugin-adapter-napuketto
  ├─ koishi（peer，宿主提供）
  ├─ @napuketto/kernel（装配 + 登录 + 事件通道 + API）
  ├─ @napuketto/adapter（协议语义：事件模型 / 动作注册表 / 数据翻译）
  └─ @napuketto/loader（自建宿主引导：dlopen + stub + O3MiscService 激活）
```

**关键决策（2026-08-08）**：嵌入走**子进程 IPC**（方案二），不在 koishi 进程内 dlopen。
理由见 §5.2。

## 2. 为什么是「子进程 + IPC」而不是「进程内 dlopen」

NapukettoQQ 的自建宿主（路线 A）是**标准 Node 进程**（stub QQNT.dll 转发 napi_* → node.exe +
`process.dlopen(wrapper.node)`）。koishi 也是标准 Node 进程——两个选择：

| 方案 | 形态 | 稳定性 | 事件延迟 | 多账号 |
|---|---|---|---|---|
| **一：进程内** | koishi 进程内 `NapukettoCore.create()` + dlopen | QQ 原生层崩溃 = koishi 一起挂 | 最低 | 每账号一 Core 实例（ADR-015） |
| **二：子进程 IPC**（选定） | spawn `self-host.cjs` 子进程，stdin/stdout 或 IPC 通道通信 | 子进程崩了重启，koishi 无恙 | 略高 | 每账号一子进程（同 supervisor 模式） |

**选定方案二，理由**：
1. **复用现有链路**：`self-host.cjs`（loader 包已有）就是「spawn 标准 node → dlopen →
   O3MiscService → 登录 → session → 协议装配」的现成脚本，子进程方案**零改造**接入；
   进程内方案要把脚本式改为 API 式（`process.exit` → 回调），改造量大且风险高。
2. **稳定性隔离**：QQ 原生层（wrapper.node 的 C++ 代码）不稳定因素多，崩溃/卡死都不该
   拖垮 koishi 主进程。子进程崩溃可由插件拉起重试，符合 koishi 生态的「适配器隔离」惯例。
3. **多账号天然支持**：每账号一个子进程，与 cli supervisor 完全同构，多账号状态互不污染。

**代价**：事件/调用走 IPC 有序列化开销（可接受）；登录交互（QR 码）需通过 IPC 转发
（见 §6.4）。

## 3. 总体架构

```
┌────────────────────────────── koishi 主进程 ──────────────────────────────┐
│  koishi-plugin-adapter-napuketto（本插件）                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ apply(ctx, config)                                                    │ │
│  │  ├─ 创建 NapukettoBot（koishi Bot 子类，注册平台）                       │ │
│  │  ├─ 创建 NapukettoDriver（驱动子进程生命周期：spawn / IPC / 重启）        │ │
│  │  └─ 事件桥：kernel 事件 → ctx.emit('message', ...)                      │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬───────────────────────────────────────────┘
                               │ IPC（stdin/stdout JSON 或 node:child_process IPC）
┌──────────────────────────────▼───────────────────────────────────────────┐
│  Napuketto 自建宿主子进程（每账号一个）                                      │
│  @napuketto/loader self-host.cjs                                           │
│  ├─ dlopen wrapper.node（stub QQNT.dll 转发）                              │
│  ├─ O3MiscService 激活事件分发                                             │
│  ├─ 登录（快速 / QR）→ session READY                                       │
│  ├─ NapukettoCore 装配 → 业务 service 全部 READY                            │
│  └─ 协议装配（adapter core + 事件通道）                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

## 4. 目录结构（规划）

```
apps/koishi-plugin-adapter-napuketto/
├── src/
│   ├── index.ts              # 插件入口：name / usage / Config / apply
│   ├── bot.ts                # NapukettoBot：koishi Bot 子类（平台注册、message 发送）
│   ├── driver.ts             # NapukettoDriver：子进程 spawn / IPC / 重启 / 健康检查
│   ├── ipc.ts                # IPC 协议：消息格式、序列化、心跳、请求-响应匹配
│   ├── events.ts             # 事件翻译：kernel 事件模型 → koishi session 事件
│   ├── actions.ts            # 动作调用：koishi 动作 → kernel API（经 IPC）
│   ├── login.ts              # 登录交互：快速登录 / QR 码展示（koishi 控制台）
│   └── config.ts             # Config schema（koishi Schema）
├── docs/
│   └── design.md             # 本文件
├── package.json
├── tsconfig.json
├── biome.json
└── tsdown.config.ts
```

## 5. 关键设计决策

### 5.1 依赖形态：bundle 自包含

- 源码 **ESM**（NodeNext + verbatimModuleSyntax，与主仓库一致，TS7.0 + ES2025）
- 产物 **CJS bundle**（tsdown `format: ['cjs']`，koishi loader 用 `require()` 加载）
- `@napuketto/*` 在 **devDependencies**，被 rolldown **bundle 进产物**——运行时只依赖
  `koishi`（peer），**不要求用户装主仓库包**，跨仓库 `workspace:*` 失效问题绕开
- 开发态：`exports.development` 条件（NODE_ENV=development 直载 `src/index.ts`，
  esbuild-register 转译 + Node24 `require(esm)`），改源码即时生效

### 5.2 子进程 IPC（核心决策）

```
koishi 插件                         Napuketto 子进程
   │  spawn('node', [self-host.cjs])   │
   │ ────────────────────────────────→ │  dlopen wrapper.node + stub
   │                                   │  O3MiscService 激活
   │  ← 状态事件 { type:'boot', ... }  │
   │  ← 登录状态 { type:'login', ... } │  登录（快速/QR）
   │  ← READY { type:'ready' }         │  session READY + 协议装配
   │  ← 消息事件 { type:'event', ... } │  收到消息
   │  动作请求 { type:'action', id }   │
   │ ────────────────────────────────→ │  kernel API 调用
   │  ← 动作响应 { type:'result', id } │
```

- **通道**：`node:child_process` 的 IPC（`fork` 或 spawn + `stdio: ['pipe']`），JSON 行协议
- **消息格式**：`{ type, id?, payload }`；请求-响应用 `id` 匹配（Promise 等待）
- **心跳**：子进程定期发 `ping`，插件超时未收 → 判定失联 → 重启（指数退避）
- **崩溃**：子进程退出码非 0 → 插件记录错误 → 按策略重启（可配置次数）

### 5.3 事件翻译：kernel 事件 → koishi session

kernel 事件通道（NTEventChannel，`{ service, name, args }`）→ koishi `ctx.emit`：

| kernel 事件 | koishi 事件 |
|---|---|
| `Msg/onRecvMsg`（私聊） | `message.private` / `message` |
| `Msg/onRecvMsg`（群聊） | `message.group` / `message` |
| `Msg/onRecvMsg`（临时会话） | `message.private`（临时会话归类） |
| 群通知（GroupBridge） | `notice` 系列（群成员增减、禁言等） |
| 请求类（加群/加好友） | `request` 系列（可选，先不做） |

翻译层需要：
- **会话标识映射**：kernel `Peer`（`{ chatType, peerUid }`）→ koishi `Session`（`{ platform, selfId, userId, channelId, guildId }`）
- **消息元素映射**：kernel canonical 元素（text/at/face/image/voice/reply）→ koishi 元素语法（`<at id=""/>`、`<img src=""/>` 等）

### 5.4 动作调用：koishi → kernel API

koishi Bot 动作 → IPC 请求 → 子进程内 kernel API：

| koishi 动作 | kernel API |
|---|---|
| `sendMessage(channelId, content)` | `apis.msg.sendMessage` |
| `deleteMessage(messageId)` | `apis.msg.recallMessage` |
| `getMessage / getMessageList` | `apis.msg.fetchMessages` |
| `markAsRead` | `apis.msg.markRead` |
| 其他 | kernel apis/ 各域（group / friend / user / file / system） |

**关键**：koishi 元素语法 → kernel canonical 元素（反向映射，与 §5.3 对称）。

### 5.5 登录交互

- **快速登录**：子进程自动尝试历史票据快速登录，状态经 IPC 上报
- **QR 登录**：kernel 支持 `qrCodePath` 落盘二维码图片；插件读图路径 → koishi 控制台
  展示（koishi 的 `ctx.console` 或消息形式），扫码成功状态实时推送
- 登录状态机：`idle → booting → logging → ready / failed`，插件可查询/重连

## 6. 实现顺序（一个模块一个模块，每步跑 `pnpm check`）

> **设计先行**：每实现一个模块前，先在本文件补一节细节设计。

1. **IPC 协议层**（`ipc.ts`）：消息格式 + 序列化 + 请求-响应匹配 + 心跳。先定义类型，
   可独立单测。
2. **驱动层**（`driver.ts`）：spawn self-host 子进程 + IPC 生命周期（启动/就绪/崩溃/
   重启）。**前提**：loader 的 `self-host.ts` 支持子进程模式（见 §7 主仓库前置改造）。
3. **登录交互**（`login.ts`）：快速登录 / QR 展示 / 状态机，经 IPC 驱动子进程登录。
4. **事件桥**（`events.ts`）：kernel 消息事件 → koishi session 事件。**地基验证点**：
   koishi 里能收到 QQ 消息。
5. **动作桥**（`actions.ts`）：koishi 动作 → kernel API（sendMessage 打通「koishi 发消息」）。
6. **Bot 集成**（`bot.ts`）：NapukettoBot 注册为 koishi 平台，`message` 事件进 koishi 会话。
7. **收尾**：多账号、重连、错误上报、文档、测试、发布（changesets + koishi 市场）。

## 7. 主仓库前置改造（loader 去脚本化）

`self-host.ts`（loader 包）目前是**脚本式**（`process.exit` 直接退出）。子进程 IPC 方案
需要它**可编程化**，改造成本低：

- `process.exit(1)`（锁失败 / wrapper 缺失 / dlopen 失败）→ 抛类型化错误或发 IPC 错误消息
- 引导进度（dlopen / 登录 / session / ready）→ 事件回调（`onStatus`）
- 登录结果 / QR 码路径 → 事件回调

**不改的**：dlopen + stub + O3MiscService 激活 + 登录 + session 装配链路（已验证，
HANDOVER-V9 结论，勿重复探索）。

## 8. 红线（继承主仓库）

- **零引入 NapCat 代码**（GPL-2.0-only 不兼容 MIT）：任何文件（含类型定义）不得来自 NapCat
- **kernel 唯一原生交互层**：插件不得 `process.dlopen` / 访问 wrapper.node
- **技术栈与主仓库一致**：TS7.0 + ES2025 + NodeNext + strict 全家桶 + biome 双引号
- **子进程方案**：不改成进程内 dlopen（§5.2 决策，除非用户推翻）

---

## 9. 参考项目（2026-08-08 调研）

> 两个开源参考：`koishi-plugin-adapter-napcat`（6.9.3-napcat.0，NapCat 官方适配器，
> MIT）+ `koishi-plugin-adapter-onebot`（Koishi 官方 OneBot 适配器）。两者是同一架构
> 谱系（napcat 基于 onebot 扩展），**照葫芦画瓢的核心是 koishi Bot/MessageEncoder/
> adaptSession 骨架**，但它们本质是「网络客户端」模式（HTTP/WS 连接外部服务），
> **不是**我们的「进程编排」模式（IPC 连接自建宿主）——传输层是唯一差异，骨架可借鉴。

### 9.1 可借鉴的骨架（napcat/onebot 同构）

```
src/
├── index.ts          # 入口：name/usage/Config/apply + declare module 扩展
├── bot/
│   ├── index.ts      # NapCatBot extends BaseBot（注册平台、协议选择）
│   ├── base.ts       # BaseBot extends Bot：Bot 生命周期 + internal 调用
│   ├── message.ts    # OneBotMessageEncoder extends MessageEncoder（发送）
│   ├── cqcode.ts     # CQCode 解析（消息元素 ↔ CQ 码）
│   └── qqguild.ts    # 频道 Bot（guild service，NapCat 特有）
├── http.ts           # HttpServer extends Adapter（HTTP 连接，action 请求 + 事件推送）
├── ws.ts             # WsClient / WsServer（WS 连接）
├── types.ts          # OneBot 类型定义
└── utils.ts          # adaptSession / adaptMessage / dispatchSession / Internal
```

**核心模式**：

| 模式 | 参考实现 | 我们的对应 |
|---|---|---|
| **Bot 子类** | `BaseBot extends Bot<C, T>`，`static inject = ['http']` | `NapukettoBot extends Bot`（§5.4） |
| **MessageEncoder** | `OneBotMessageEncoder extends MessageEncoder`（元素 → 协议格式） | 元素 → kernel canonical（§5.4） |
| **internal API 封装** | `bot.internal` = `Internal` 类，所有动作 `internal.getMsg()` 等 | `NapukettoInternal`：经 IPC 调 kernel API（§5.4） |
| **传输抽象** | `internal._request = async (action, params) => http.post(...)` | `internal._request = async (action, params) => ipc.request(action, params)` |
| **事件分发** | `dispatchSession(bot, payload)` → `adaptSession` → `bot.dispatch(session)` | `dispatchSession(bot, kernelEvent)` → 翻译 → `bot.dispatch`（§5.3） |
| **Session 扩展** | `declare module '@satorijs/core' { interface Session { onebot?: ... } }` | `declare module` 扩展 napuketto 事件字段 |
| **平台扩展** | `declare module 'koishi' { interface Events { 'onebot/...': ... } }` | `declare module` 扩展 koishi Events |

**关键洞察——`internal._request` 传输抽象**：napcat 把「动作调用」与「传输方式」解耦
（HTTP 时 `_request = http.post`），我们只需把 `_request` 换成 IPC 请求，**Bot/MessageEncoder/
adaptSession 骨架可几乎原样借鉴**（除元素格式：它们用 CQ 码，我们用 kernel canonical）。

### 9.2 关键差异（必须自研的部分）

| 维度 | napcat/onebot | 我们 |
|---|---|---|
| **NapCat 本体** | 独立进程（NapCat 服务，HTTP/WS） | 无独立进程——自建宿主子进程（`self-host.cjs`） |
| **传输** | HTTP POST / WS 连接（`http.ts`/`ws.ts`） | 子进程 IPC（`driver.ts`/`ipc.ts`） |
| **事件格式** | OneBot payload（`post_type`/`message_type` 等） | kernel 事件模型（NTEventChannel） |
| **消息元素** | CQ 码（`[CQ:at,qq=xxx]`） | kernel canonical 元素（text/at/face/image/voice/reply） |
| **登录** | 无（NapCat 自己登录） | 插件驱动子进程登录（快速/QR，§5.5） |
| **协议适配** | 只认 OneBot（`http.ts`/`ws.ts` 直连） | kernel 语义化 API（不依赖具体协议） |

**结论**：借鉴 **Bot/MessageEncoder/internal/adaptSession 骨架**（§9.1），自研 **driver/ipc
传输层 + kernel 事件/元素翻译**（§5.2/§5.3/§5.4）。napcat 的 `http.ts`/`ws.ts` 无参考价值
（传输完全不同），但 `bot/` + `utils.ts` 的骨架是极佳范本。

### 9.3 参考实现的细节要点（实现时对照）

1. **`adaptSession`**：payload → koishi `Session` 字段映射（`session.type/subtype/
   userId/channelId/guildId/isDirect`），私聊 `channelId = 'private:' + userId`，
   群聊 `guildId = channelId = group_id`——**会话标识映射照此模式**（§5.3 的 Peer → Session）。
2. **`adaptMessage`**：`message.id`、`elements`（CQ 码 → koishi 元素 `h()`）、`quote`
   （reply 元素取首 → `bot.getMessage` 拉引用）、`content = elements.join('')`。
3. **`dispatchSession`**：`bot.session()` → 填字段 → `session.setInternal` → `bot.dispatch`。
4. **Bot 生命周期**：`initialize()` 里 `getLogin()` → `online()`，失败 `offline(error)`
   ——koishi 平台注册的成败挂钩。
5. **`static inject`**：声明依赖（napcat 用 `['http']`、`['server']`），我们不用 network/
   http，可能不需要 inject（除非用到 koishi 内置服务）。
6. **`MessageEncoder`**：`forward()`（合并转发）、`flush()`（内容拼接）、`prepare()`
   （channel 类型补全）——发送链路的标准骨架。
