# koishi-plugin-adapter-napuketto 交接（2026-08-08 深夜）

> **新对话开场指引（照抄主仓库惯例）**：先读本文件 → `docs/design.md`（总体设计 +
> 已实现模块标注）→ 主仓库 `docs/STATUS.md` / `AGENTS.md` / `docs/architecture.md`。
> 本文件记录 koishi 适配器施工进度、关键决策、坑与下一步，供新会话无缝衔接。

---

## 1. 定位与总体方案（一句话）

**koishi-plugin-adapter-napuketto**：把 NapukettoQQ（自研 QQ NT `wrapper.node` 协议层）
嵌入 Koishi 的适配器。**关键决策（2026-08-08 拍板）：子进程 IPC 方案**——spawn
`self-host.cjs` 子进程（每账号一个），stdout/stdin JSON 行协议通信，不在 koishi 进程内
dlopen（稳定性隔离 + 复用现有链路，design.md §5.2）。

```
koishi 插件（本包）                    Napuketto 子进程（self-host.cjs）
  apply() → NapukettoDriver                dlopen wrapper.node + stub QQNT.dll
  ├─ spawn (launchSelfHost ipc:true)  →    O3MiscService 激活 → 登录 → session
  ├─ IPC client（stdout 收行/stdin 发行）   ← status/login/qr/event/log/ping
  ├─ 登录状态机（login/）                   ← 动作响应 result
  └─ 事件桥（events/） → bot.dispatch  →    ← action 请求 → kernel API
```

## 2. 施工进度（截至 2026-08-08 深夜，已全部提交）

| 实现顺序（design.md §6） | 模块 | 状态 | 提交（子仓库） | 备注 |
|---|---|---|---|---|
| 0 | design.md 总体设计 | ✅ | f8447c1 | 子进程 IPC 方案 + 参考调研 §9 |
| 1 | `src/ipc/` IPC 协议层 | ✅ | 95c80d7 | 编解码/传输/请求-响应/心跳，13 单测 |
| — | §7 loader IPC 化（主仓库前置） | ✅ | 主仓库 9005c43 | kernel onAny/onLoginProgress + loader host/ipc |
| 2 | `src/driver/` 驱动层 | ✅ | 8c16547 | spawn/重启/健康检查，15 单测 |
| 3 | `src/login/` 登录交互层 | ✅ | 6e1efbf | 状态机/QR 缓冲，8 单测 |
| 4 | `src/events/` 事件桥 | ✅ | 31f3504 | **地基验证点**，17 单测 |
| 5 | `src/actions/` 动作桥 | ✅ | 801067b | koishi 动作 → IPC action，27 单测 |
| 6 | `src/bot/` Bot 集成 | ✅ | <新提交> | **端到端验证点**，NapukettoBot + MessageEncoder + launch |
| 7 | 收尾（多账号/文档/发布） | ⏳ **下一步** | — | 端到端联调 + changesets + koishi 市场 |

**子仓库 HEAD = <新提交>（Bot 集成）**，工作区干净；主仓库 HEAD 待更新（submodule 指针）。
**新会话第一件事：push 两个仓库到 origin**（子仓库 + 主仓库各领先 origin 若干提交）。

## 3. 已实现模块速览（新会话必读）

### 3.1 `src/ipc/`（IPC 协议层，零 koishi 依赖）
- `types.ts`：消息判别联合 `IpcMessage`（status/login/qr/event/result/log/ping/pong/action/control），协议 `v: 1`
- `codec.ts`：`encodeIpcMessage` / `decodeIpcMessage`（JSON 行，非法行 null）
- `transport.ts`：`IpcLineTransport` 接口 + `ChildProcessIpcTransport`（stdout readline 收行 / stdin 发行）
- `client.ts`：`NapukettoIpcClient`——`request(action, params)`（单调 id + pending Map + 超时 60s +
  迟到忽略）、`on(type, handler)` 泛型收窄、ping 自动回 pong、`seenAt/pingAt/pongAt`
- `errors.ts`：`IpcError(code, message)`（协议边界宽松 code，不伪造 KernelErrorCode）
- 测试用 `MemoryLinePair`（内存双端，src/ipc/test-utils.ts）

### 3.2 `src/driver/`（驱动层，依赖注入可单测）
- `types.ts`：`DriverOptions { launch, createTransport?, events, restart?, heartbeatTimeoutMs? }`、
  `DriverEvents`（onStatus/onLogin/onQr/onEvent/onLog/onReady/onExit/onError）、`DriverState` 状态机
- `driver.ts`：`NapukettoDriver`——spawn（launch 工厂）→ IPC client → 状态机；
  **崩溃退避重启**（maxRetries 默认 3，1s/2s/4s，ready 重置计数）；**心跳健康检查**（1s 轮询
  seenAt，超 45s 判失联 kill+重启，spawn 时间兜底 dlopen 卡死）；stop 优雅退出（5s 超时强杀）
- **driver 不 import loader**：launch 工厂由 apply() 层用 `launchSelfHost({ ipc: true, stdio: ['pipe','pipe','pipe'] })` 组装注入
- 测试：`FakeChild` + `createHarness`（src/driver/test-utils.ts）

### 3.3 `src/login/`（登录交互层，状态观察）
- `machine.ts`：`NapukettoLoginState implements LoginObserver`——`onLogin(state, selfInfo?)` /
  `onQr(qr)` / `onReady()` / `onExit()`；**QR 缓冲**（onQr 先于 waiting_scan 到达暂存）、
  快速登录直通 logged_in、onExit 重置 idle、failed 记 lastError
- `types.ts`：`LoginView`（onStateChange/onQrChange/onError）+ `LoginSnapshot` 快照

### 3.4 `src/events/`（事件桥，地基验证点）
- `elements.ts`：canonical → koishi 元素（text/at/image/face/voice/reply + 占位）；
  **h 依赖注入**（`HFn` + `bindKoishiH`，避免 import koishi 主包单测崩溃）
- `adapt.ts`：`adaptRawMessage(msg, { selfId, platform, h })`——群聊 `message.group`
  （channelId=guildId=群号）/ 私聊 `message.private`（`private:` + senderUin）/ 临时会话带 guildId；
  元素经 kernel `toCanonicalElements` 转 canonical
- `bridge.ts`：`NapukettoEventBridge`——`handle(payload)` 处理 `Msg/onRecvMsg`（**数组/单条兼容**，
  运行时实证）→ 逐条 `dispatch(session)`；非消息事件忽略（Group/notice 系列后续）
- 测试用 `mockH()`（src/events/test-utils.ts）

### 3.5 `src/actions/`（动作桥）
- `types.ts`：`RequestFn`（传输抽象，`(action, params?) => Promise<unknown>`）/ `NapukettoInternalOptions` / `PeerTarget`
- `elements.ts`：**koishi 元素 → canonical 反向映射**（与 events/elements.ts 对称）——text/at/image/face/
  audio→voice/quote→reply；**http(s) URL 的 image/audio 降级 text**（需下载后发送，后续轮次）；
  未知元素降级 text（toString 保内容）；字符串 content → 单 text
- `channel.ts`：`parseChannelId(channelId, guildId?)`——群号→chatType=2 / `private:`+uin→chatType=1 /
  `private:`+uin+guildId→chatType=100（临时会话）
- `internal.ts`：`NapukettoInternal`——**koishi `bot.internal` 封装**（对应 napcat `internal._request`）：
  `_request(action, params)` 透传；`sendMessage`（元素反向映射，返回 msgId[]）/ `deleteMessage`→
  recallMessage / `getMessageList`→fetchMessages（返回 `{ data, next }` koishi MessageList 形状）/ `markAsRead` /
  `getGroupList` / `getFriendList` / `getSelf`；空内容 → 返回 [] 不发请求
- 测试：mock request（`vi.fn`）断言动作名 + params，27 单测（elements 12 + channel 4 + internal 11）
- 载荷经 IPC `client.request` 到 loader 侧动作表（`msg.sendMessage` 等，peerUin 自动转 uid）

### 3.6 `src/bot/`（Bot 集成，端到端验证点）
- `bot.ts`：`NapukettoBot extends Bot`（平台 "napuketto"，**不写 Adapter**——override `start()`
  spawn driver / `stop()` 停 driver，koishi 构造自动注册 ready → start）
  - 构造：selfId → user.id；internal = `NapukettoInternal`（request 绑定 `clientRef`，null 抛错）；
    bridge = `NapukettoEventBridge`（dispatch → `this.dispatchSession`，h 用 `adaptH` 适配）
  - 动作方法：createDirectChannel / getMessageList / deleteMessage / getLogin / getFriendList /
    getGuildList / getGuild / getChannel（走 internal → IPC action）
  - 生命周期：start → driver 装配（launch 工厂 + events 接线）→ onReady（clientRef 更新 +
    login.onReady + online + getLogin）→ onExit（login 归 idle + offline）/ onError（offline）
  - `namespace NapukettoBot { export const Config }`（napcat 同构，koishi bots 配置校验）
- `message.ts`：`NapukettoMessageEncoder extends MessageEncoder`——prepare（channel.type 补全）+
  visit（收集 h 实例）+ flush（一次性 `internal.sendMessage(channelId, children, guildId)` →
  session 'send' 事件）；元素 → canonical 复用 actions/elements.ts
- `launch.ts`：`resolveEntry`（override 优先，否则 import.meta.resolve）+ `resolveLaunchOptions`
  （纯函数，组装 launchSelfHost 选项：IPC + selfHost + pipe stdio + quickUin= selfId；deps 注入
  假 QQ 解析可单测）+ `buildLaunch`（DriverLauncher，child cast 适配 ChildProcessLike）
- `config.ts`：`NapukettoBotConfig`（selfId 必填 + qqPath/stubDir/dataDir/kernelEntry 覆盖 +
  restart/heartbeatTimeoutMs）+ `napukettoConfigSchema`
- `index.ts`：默认导出 `NapukettoBot`（koishi 自动注册平台）+ 导出 Config/actions/events
- 测试：launch 纯函数 5 单测；bot/message/config/index 运行时 import koishi 不进单测
- **⚠️ 发布形态（HANDOVER §5 记录）**：bundle 后 `import.meta.resolve` 失效（tsdown 警告
  EMPTY_IMPORT_META）、launchSelfHost 的 `__dirname` 定位 self-host.cjs 失效——生产发布需
  config 显式覆盖 kernelEntry 或改依赖形态（收尾步骤 7）

## 4. 主仓库前置（§7 已落地，勿重复）

- **kernel**：`NTEventChannel.onAny`（全事件订阅）+ `CoreLoginOptions.onLoginProgress`
  （QR 阶段回调）+ `LoginProgress` 类型导出
- **loader**：`src/host/ipc/`（NAPUTO_IPC=1）——类型/编解码/发送/动作表/stdin 服务端/心跳；
  `protocols.ts` 拆 `kernel-services.ts`（IPC/协议共用）+ `assemble-protocols.ts`（OB11/Satori）；
  `launcher.ts` `LaunchOptions.ipc` 注入 NAPUTO_IPC=1
- **变化集**（主仓库 9005c43 + changeset `koishi-ipc-prereq.md`，kernel/loader patch）

## 5. 下一步：收尾（实现顺序第 7 步）

### 待办
1. **端到端联调（最高优先）**：koishi 进程（NODE_ENV=development 直载 src + 主仓库各包
   已 build）加载插件 → bots 配置 `napuketto:<uin>` → spawn self-host 子进程（IPC）→
   快速登录（`quickUin`）→ READY → 控制台收到消息 + 能回复。这是「端到端验证点」的
   最终确认——**当前所有模块是单测通过的组装件，联调会暴露真实集成问题**。
2. **QR 登录展示**：`login.onQr`（pngBase64）→ koishi 控制台 <img>（LoginView 已定义，
   bot.ts 尚未接 console）。
3. **发布形态（⚠️ 已知问题）**：`@napuketto/*` 被 bundle 进产物后 `import.meta.resolve`
   失效（tsdown EMPTY_IMPORT_META 警告实证）+ `launchSelfHost` 的 `__dirname` 定位
   self-host.cjs 失效。选项：a) config 显式覆盖 kernelEntry/selfHostEntry；b) 改依赖形态
   （@napuketto/* 移 dependencies + tsdown external）；c) 打包 self-host 资源进产物。
   生产发布前必须解决。
4. **多账号**：koishi bots 配置天然支持（每 bot 一个子进程，driver 事件闭包绑定 uin）——
   联调验证即可。
5. **changesets + koishi 市场**：确认 create-napukettoqq 的 CLI_VERSION 同步。

### 提示
- bot.ts 的 `static MessageEncoder` 用 `as unknown as new (bot: unknown, ...) => MessageEncoder<never, never>`
  cast 豁免（koishi 基类 static 用 satorijs Bot<cordis.Context>，与 koishi Bot 逆变不兼容）。
- `Universal.Channel.Type` / `Universal.Status` 是 const enum，verbatimModuleSyntax 下用数字字面量
  （bot.ts 顶部 CHANNEL_TYPE/BOT_STATUS 常量）。
- actions/elements.ts 的 text 元素取值：`attrs.content` 优先（koishi h text 内容在 attrs.content，
  napcat 实证），children 兜底；br → '\n'。
- 联调命令参考：koishi 启动后观察子进程 stdout（IPC 行）与 bot 状态（控制台）。

## 6. 后续轮次（实现顺序 §6）

6. **Bot 集成** `src/bot.ts`：`NapukettoBot extends Bot`（koishi 平台注册）、`MessageEncoder`
   （元素发送链路）、`initialize()` 里 getLogin → online()。**这是端到端验证点**：koishi 控制台
   收到消息 + 能回复。
7. **收尾**：apply() 全面装配（driver + login + events + actions + bot）、多账号、重连、
   控制台 QR 展示、config.ts schema 扩展、changesets + koishi 市场发布。

## 7. 关键坑（已踩，勿重复）

1. **koishi 主包不能 import**（单测环境）：`import { h } from "koishi"` 会初始化 loader 崩溃
   （`Class extends value #<Object> is not a constructor`）→ **依赖注入** h/回调，测试用 mock。
2. **driver 事件回调时序**：MemoryLinePair 是「write 到对端」语义；测试先注册监听再触发
   （stop 同步发送，后注册会漏掉）。
3. **onRecvMsg 参数是消息数组**（运行时实证）→ bridge 数组/单条兼容；loader 侧遍历处理。
4. **exactOptionalPropertyTypes**：可选字段用条件展开（`...(x !== undefined ? { x } : {})`），
   不显式赋 undefined。
5. **单文件 ≤300 行**（用户硬性要求）：超了拆目录 + test-utils 共享设施。
6. **biome JSON 行尾不可见字符**：已知无害，看到即跳过，别浪费 token。
7. **终端 PWD 卡子仓库**：`pnpm -C <绝对路径> check` / `git -C <绝对路径>` 强制主仓库根执行。
8. **loader 不自研 kernel 依赖**：错误码用宽松结构判断（`(err as {code?}).code`），不 import @napuketto/kernel。

## 8. 环境与验证命令

```bash
# 子仓库（koishi 适配器）
pnpm -C c:\Dev\QQBot-Dev\NapukettoQQ\apps\koishi-plugin-adapter-napuketto check
# 全量单测（主仓库根）
pnpm -C c:\Dev\QQBot-Dev\NapukettoQQ exec vitest run
# 主仓库全量 check（biome + tsc）
pnpm -C c:\Dev\QQBot-Dev\NapukettoQQ check
# 测试计数基准：238 个（27 文件）
```

**提交惯例**：子仓库提交功能 → 主仓库 `chore: 更新 koishi 适配器 submodule 指针（<描述>）`。
提交信息简体中文，参考现有历史（`feat:` / `docs:` / `chore:`）。

---

*交接完毕。下一会话从「§5 收尾」开始：端到端联调（koishi 加载插件 → 子进程 IPC → 收发消息）
优先，再处理发布形态。*
