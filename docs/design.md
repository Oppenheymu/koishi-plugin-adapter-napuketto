# koishi-plugin-adapter-napuketto 设计

> **定位**：NapukettoQQ 的 Koishi 适配器——把 NapukettoQQ（自研 QQ NT `wrapper.node` 协议层）
> 嵌入 Koishi，让 Koishi 直接驱动 QQ，无需 NapCat、无需独立进程、无 WebUI 依赖。
> **配套**：主仓库 `docs/architecture.md`（分层/ADR/红线）、`docs/STATUS.md`（现状 + 决策点）、
> `packages/kernel/docs/design.md`（核心装配）、`packages/loader/docs/design.md`（引导）。
> **新对话先读 `docs/HANDOVER.md`（施工交接，2026-08-08 深夜）** → 主仓库 STATUS → AGENTS.md
> → architecture.md → 本文件（已实现模块有 ✅ 标注）。

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
│   ├── driver/               # 驱动层（§5.7，已实现 2026-08-08）
│   │   ├── index.ts          #   出口（barrel）
│   │   ├── types.ts          #   DriverOptions/DriverEvents/DriverState/ChildProcessLike
│   │   ├── backoff.ts        #   指数退避纯函数
│   │   ├── driver.ts         #   NapukettoDriver：spawn/IPC/重启/健康检查
│   │   └── *.test.ts         #   单测（FakeChild + MemoryLinePair 注入，15 用例）
│   ├── ipc/                  # IPC 协议层（§5.6，已实现 2026-08-08）
│   │   ├── index.ts          #   出口（barrel）
│   │   ├── types.ts          #   消息类型联合 + payload 类型（协议契约，loader 侧复用）
│   │   ├── codec.ts          #   JSON 行编解码（encode/decode）
│   │   ├── errors.ts         #   IpcError（协议级错误：TIMEOUT / CLOSED / 远端错误码）
│   │   ├── transport.ts      #   IpcLineTransport + ChildProcessIpcTransport
│   │   ├── client.ts         #   NapukettoIpcClient（请求-响应 + 心跳 + 事件分发）
│   │   └── index.test.ts     #   单测（内存双端注入，不依赖真实子进程）
│   ├── login/                # 登录交互层（§5.8，已实现 2026-08-08）
│   │   ├── index.ts          #   出口（barrel）
│   │   ├── types.ts          #   LoginObserver / LoginView / LoginSnapshot
│   │   ├── machine.ts        #   NapukettoLoginState：状态机 + QR 缓冲
│   │   └── machine.test.ts   #   单测（8 用例：QR 全流程/快速直通/缓冲/重置）
│   ├── events/               # 事件桥（§5.9，已实现 2026-08-08，地基验证点）
│   │   ├── index.ts          #   出口（barrel）
│   │   ├── types.ts          #   EventBridgeOptions / NapukettoSessionFields
│   │   ├── elements.ts       #   canonical → koishi h()（依赖注入，可单测）
│   │   ├── adapt.ts          #   RawMessage → session 字段（群聊/私聊/临时会话）
│   │   ├── bridge.ts         #   NapukettoEventBridge：kernel 事件 → dispatch
│   │   └── *.test.ts         #   单测（17 用例，mock h 注入不依赖 koishi 运行时）
│   ├── actions.ts            # 动作调用：koishi 动作 → kernel API（经 IPC）
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

### 5.6 IPC 协议层细节（`ipc.ts`，实现顺序第 1 步）

**传输**：JSON 行协议，走子进程 stdin/stdout（`spawn('node', [self-host.cjs], { stdio: ['pipe','pipe','pipe'] })`）：

| 流 | 方向 | 用途 |
|---|---|---|
| stdout | 子进程 → 插件 | IPC 消息流（readline 按行解析） |
| stdin | 插件 → 子进程 | IPC 消息流 |
| stderr | 子进程 → 插件 | 日志兜底（崩溃堆栈等原始输出） |

每行一条 JSON 消息，`\n` 结尾；`encodeIpcMessage` / `decodeIpcMessage` 保证不丢行。
**消息信封**：`{ v: 1, type, id?, payload }`——`v` 协议版本（解码校验）、`type` 判别字段、
`id` 请求 id（仅 action/result）、`payload` 消息体。

**消息清单**（type 判别联合，`IpcMessage`）：

| type | 方向 | payload | 说明 |
|---|---|---|---|
| `status` | 子→父 | `{ phase, message?, error? }` | 引导阶段：booting/dlopening/logging/sessioning/ready/failed |
| `login` | 子→父 | `{ state, selfInfo? }` | 登录状态（kernel `LoginState`）+ selfInfo |
| `qr` | 子→父 | `{ pngBase64, qrcodeUrl }` | 二维码（kernel `QrCodeData`，koishi 控制台展示用） |
| `event` | 子→父 | `{ service, name, args }` | kernel 事件（NTEventChannel 形状，翻译层消费） |
| `result` | 子→父 | `{ ok, value? } \| { ok, error }` | 动作响应（error 携带 kernel 错误码/消息） |
| `log` | 子→父 | `{ level, message }` | 结构化日志转发（pino level） |
| `ping` | 双向 | — | 心跳 |
| `pong` | 双向 | — | 心跳应答 |
| `action` | 父→子 | `{ action, params? }` | 动作请求（koishi → kernel API） |
| `control` | 父→子 | `{ command, ... }` | 控制指令：stop / restart / login（`{ uin?, qr? }`） |

**请求-响应匹配**（`NapukettoIpcClient.request`）：
- 单调递增 `nextId`；下行 `{ type: "action", id, payload }`
- 内部 pending Map：`id → { resolve, reject, timer }`；`result` 按 `id` 匹配
- 超时（默认 60s，可配）reject `IpcError("TIMEOUT")` 并清理；迟到 result 忽略
- result.error 反序列化为 `IpcError(code, message)`（协议边界错误码是宽松 string，
  不伪造 `KernelErrorCode`；插件侧按需映射 koishi 错误）

**心跳**：子进程每 15s 发 `ping`（self-host 改造时实现，§7）；插件收到自动回 `pong`，
并记录 `lastPingAt`/`lastSeenAt`（epoch ms）。driver 用 `lastSeenAt` 超时（默认 45s）判定失联
→ 重启（指数退避，§6.2）。插件也可主动 `sendPing()` 探活（观察 `lastPongAt` 是否前进）。

**通道抽象**（可独立单测，`src/ipc.test.ts` 用内存双端）：
- `IpcLineTransport`：`write(line)` / `onLine(cb)` / `onClose(cb)` / `close()`
- `ChildProcessIpcTransport`：包装 ChildProcess（stdout readline 收行 + stdin 发行）
- `MemoryLinePair`：测试用内存双端（left/right 互写）
- `NapukettoIpcClient`：传输 + 编解码 + 请求-响应 + 心跳 + 事件分发
  （`on(type, handler)`，泛型收窄到具体消息类型）

**健壮性**：解码失败（非法行/未知 type/v 不匹配）记日志跳过，不崩通道；`close()` 时
pending 全部 reject（`KernelError("CLOSED")`）。

### 5.7 驱动层细节（`driver.ts`，实现顺序第 2 步）

**形态**：`src/driver/` 目录（单文件 ≤300 行约束）：

| 文件 | 职责 |
|---|---|
| `types.ts` | DriverOptions / DriverEvents / DriverState / ChildProcessLike / DriverLauncher |
| `backoff.ts` | 指数退避纯函数（attempt → delayMs，可单测） |
| `driver.ts` | `NapukettoDriver`：spawn / IPC / 重启 / 健康检查 |
| `index.ts` | barrel |

**依赖注入（可单测，不依赖真实子进程）**：

```ts
export interface DriverOptions {
    launch: DriverLauncher;                    // 启动子进程（默认 launchSelfHost 组装，测试注入假 child）
    createTransport?: (child) => IpcLineTransport; // 默认 ChildProcessIpcTransport，测试注入内存双端
    events: DriverEvents;                      // 事件回调（status/login/qr/event/log/ready/exit/error）
    restart?: { maxRetries?: number; backoffMs?: number; backoffFactor?: number };
    heartbeatTimeoutMs?: number;               // 默认 45s
}
export type DriverLauncher = () => { child: ChildProcessLike; cleanup?: () => void };
```

driver **不直接 import loader**（launch 封装隔离，`launchSelfHost({ ipc: true, stdio: ['pipe','pipe','pipe'] })`
在 apply() 层组装注入）——只管子进程生命周期，与传输/IPC 解耦。

**状态机**：

```
idle → spawning → booting（收到 status）→ ready / failed
         └── 崩溃 / 失联（心跳超时）→ restarting（退避）→ spawning ...
stop → stopping → stopped（stop 后不再重启）
```

- status.phase 驱动 booting/ready/failed 迁移；`ready` 时回调 `events.onReady(client)`（上层在
  onReady 里拿新 client 重新接 events/actions——重启后 client 实例会换）
- 每次 spawn 建新 transport + 新 `NapukettoIpcClient`（旧 client 随子进程退出 closed）

**心跳健康检查**：
- 定时器（1s）读 `client.seenAt`；超过 `heartbeatTimeoutMs`（默认 45s）→ 判定失联 → kill + 重启
- **spawn 后立即监控**（兜 dlopen / 登录卡死挂起——wrapper 原生层卡住不发任何消息）

**重启策略**：
- `maxRetries` 默认 3（0 = 不重启）；`backoffMs` 默认 1000 × factor 2（1s/2s/4s）
- 达到上限 → `failed`；`stop()` 后不再重启（stopping 标志）

**stop()**：置 stopping → 发 control stop（优雅退出）→ 等 exit 5s → kill → 清理定时器 + client.close()

**ChildProcessLike**（宽松子进程面，测试可伪造）：`{ stdout, stdin, once('exit'), kill, pid? }`；
`ChildProcessIpcTransport` 构造时断言收窄。

### 5.8 登录交互层细节（`login.ts`，实现顺序第 3 步）

**定位**：登录状态在子进程内驱动（self-host bootstrap 登录），插件侧只做**状态观察 +
QR 展示 + 交互**。driver 的 `onLogin`（kernel LoginState）+ `onQr`（QrCodeData）已透出——
登录层消费这两个回调。

**形态**：`src/login/` 目录（单文件 ≤300 行约束）：

| 文件 | 职责 |
|---|---|
| `types.ts` | `LoginObserver`（driver 回调装配）+ `LoginView`（UI 回调：状态/QR 变化）+ LoginStatus 快照 |
| `machine.ts` | `NapukettoLoginState`：状态机（观察 driver onLogin/onQr → 迁移 + 通知） |
| `index.ts` | barrel |

**状态机**（与 kernel `LoginState` 对齐：idle/waiting_scan/scanned/logged_in/failed）：

```
idle → waiting_scan（收到 QR / polling started）→ scanned（用户已扫码）
     → logged_in（onQRCodeLoginSucceed，携带 selfInfo）
     └→ failed（登录失败 / QR 过期）
```

- **快速登录**（无 QR 阶段）：driver 直接 `onLogin(logged_in)` → logged_in（不经过 waiting_scan）
- **QR 缓冲**：`onQr` 先于 `onLogin(waiting_scan)` 到达（IPC 乱序）→ 内部暂存最新 QR，
  迁移到 waiting_scan 时随状态通知一起送出
- **每次 spawn 重置**：driver 重启（崩溃/失联）→ 新 client → 登录层状态归 idle
  （driver.onExit 或 onReady 重置）

**登录 UI 视图**（koishi 控制台展示，本轮定义接口，apply() 层接 console）：

```ts
export interface LoginView {
    onStateChange?(state: LoginState, self?: SelfInfo): void;  // 状态变化
    onQrChange?(qr: QrCodeData): void;                          // 二维码更新（刷新/过期重取）
}
```

**QR 展示形态**：`qr.pngBase64` → `data:image/png;base64,...` → koishi 控制台 `<img>`；
`qr.qrcodeUrl` 兜底链接（控制台不可用时发消息）。本轮定义 `LoginObserver` 装配，
UI 渲染（console 组件）留给 §6.5 Bot 集成后。

**错误**：`failed` 时经 `view.onStateChange` 通知 + 记录最近错误（`lastError`），
apply() 层可查（driver 已按重启策略兜底）。

### 5.9 事件桥细节（`events.ts`，实现顺序第 4 步，**地基验证点**）

**定位**：driver 已把 kernel 事件 `{ service, name, args }` 透出（onEvent）——事件桥做
**kernel 事件 → koishi session** 翻译并 `bot.dispatch(session)`。**验证点：koishi 里能
收到 QQ 消息。**

**形态**：`src/events/` 目录（单文件 ≤300 行约束）：

| 文件 | 职责 |
|---|---|
| `types.ts` | `NapukettoSession`（宽松 Session 构造面）+ EventBridgeOptions / 回调 |
| `elements.ts` | canonical 元素 → koishi `h()` 元素（纯函数，可单测） |
| `adapt.ts` | kernel `RawMessage` → koishi session 字段（纯函数，可单测） |
| `bridge.ts` | `NapukettoEventBridge`：订阅 driver onEvent → 翻译 → dispatch |
| `index.ts` | barrel |

**会话标识映射**（napcat/onebot 同构骨架，§9.1）：

| 场景 | session.type | userId | channelId | guildId | isDirect |
|---|---|---|---|---|---|
| 群聊（chatType=2） | `message.group` | senderUin | groupCode | groupCode | false |
| 私聊（chatType=1） | `message.private` | senderUin | `private:` + senderUin | — | true |
| 临时会话（chatType=100） | `message.private` | senderUin | `private:` + senderUin | groupCode | true |

- `senderUin`（RawMessage 直接带，无需 uid→uin 查询——群聊/私聊的发送者 QQ 号）
- `peerUin`（RawMessage 直接带：群号 / 对端 QQ 号）→ channelId/guildId
- **selfId**：登录账号 uin（onReady 时从 login 快照取，随事件桥初始化）

**元素映射**（canonical → koishi `h()`）：

| canonical | koishi |
|---|---|
| `{ type: "text", text }` | `h.text(text)` |
| `{ type: "at", target }` | `h.at(target)`（target 为 "all" → `h.at("all")`） |
| `{ type: "image", url?/path }` | `h.image(url ?? path)` |
| `{ type: "face", id }` | `h("face", { id })`（emoji 元素，QQ 表情码） |
| `{ type: "voice", url?/path }` | `h.audio(url ?? path)` |
| `{ type: "reply", messageId }` | `h.quote(messageId)`（引用） |
| 其他（video/file/forward/json/xml/unknown） | 降级 `h.text("[type]")` 占位（后续扩充） |

**桥装配**（apply() 层）：

```ts
const bridge = new NapukettoEventBridge({
    driverEvents: { onEvent: (payload) => bridge.handle(payload) }, // driver 事件源
    dispatch: (session) => bot.dispatch(session),                  // koishi Bot.dispatch
    selfId: () => login.snapshot.self?.uin ?? config.selfId ?? "",
});
```

**翻译链路**：`payload.args[0]`（RawMessage）→ `adaptRawMessage` → `adaptElements` →
`session.type/elements/content` 填充 → dispatch。`Msg/onRecvMsg` 的 args 是**消息数组**
（运行时实证，§5.3 注）→ 遍历逐条翻译。

**本轮不做**：群通知（GroupBridge）/ 请求类 → notice/request 系列（§6.6 后续）；
消息记录（`message-deleted` 等）——先打通 message 事件（验证点）。

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

**✅ 已实现（2026-08-08，§7 落地）**：loader 新增 `src/host/ipc/`（NAPUTO_IPC=1 开启）：

| 文件 | 职责 |
|---|---|
| `ipc-types.ts` | 协议消息类型（与插件侧 src/ipc/types.ts 对齐，IPC_VERSION 校验防漂移） |
| `ipc-codec.ts` | JSON 行编解码（与插件侧 codec.ts 对齐） |
| `ipc-sender.ts` | 发送封装（status/login/qr/event/log/result/ping/pong；仅 IPC 模式写 stdout） |
| `ipc-actions.ts` | 动作表（msg.sendMessage/recallMessage/fetchMessages/markRead + group/friend 列表 + login.getSelf；**peerUin 自动转 uid**——注入 groupApi.uinToUid） |
| `ipc-server.ts` | stdin readline 收 action/control/ping；心跳 15s；control stop/restart 退出 |
| `ipc-bootstrap.ts` | 装配入口：enableIpc + 动作表 + 服务端 + 事件通道 onAny 转发 |

配套改动：
- **kernel**：`NTEventChannel.onAny`（全事件订阅，IPC 转发用）+ `CoreLoginOptions.onLoginProgress`
  （QR 阶段回调：二维码数据 + 状态机，IPC 转发用）
- **self-host.ts**：IPC 模式发 status（booting → dlopening → logging → sessioning → ready / failed）
- **protocols.ts** 重构：kernel 服务创建抽到 `kernel-services.ts`（IPC/协议共用），
  OB11/Satori 装配抽到 `assemble-protocols.ts`（非 IPC 模式零回归）
- **launcher.ts**：`LaunchOptions.ipc` → 注入 NAPUTO_IPC=1（koishi 插件 driver 复用）

**driver.ts 前提就绪**：spawn `launchSelfHost({ ..., ipc: true, stdio: ["pipe","pipe","pipe"] })`
→ stdout 收协议行（readline）→ stdin 发 action/control。非 IPC 路径（cli pnpm start）零改动。

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
