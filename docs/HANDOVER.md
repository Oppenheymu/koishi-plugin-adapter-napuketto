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
| 6 | `src/bot.ts` Bot 集成 | ⏳ **下一步** | — | NapukettoBot 注册 koishi 平台 |
| 7 | 收尾（多账号/文档/发布） | ⏳ | — | changesets + koishi 市场 |

**子仓库 HEAD = `801067b`（动作桥）**，工作区干净；主仓库 HEAD = `c4d2dff`（submodule 指针），
领先 origin 3 提交（未 push）。**新会话第一件事：把两个仓库 push 到 origin**（或先继续施工再一起推）。

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

## 4. 主仓库前置（§7 已落地，勿重复）

- **kernel**：`NTEventChannel.onAny`（全事件订阅）+ `CoreLoginOptions.onLoginProgress`
  （QR 阶段回调）+ `LoginProgress` 类型导出
- **loader**：`src/host/ipc/`（NAPUTO_IPC=1）——类型/编解码/发送/动作表/stdin 服务端/心跳；
  `protocols.ts` 拆 `kernel-services.ts`（IPC/协议共用）+ `assemble-protocols.ts`（OB11/Satori）；
  `launcher.ts` `LaunchOptions.ipc` 注入 NAPUTO_IPC=1
- **变化集**（主仓库 9005c43 + changeset `koishi-ipc-prereq.md`，kernel/loader patch）

## 5. 下一步：Bot 集成 `src/bot.ts`（实现顺序第 6 步）

### 设计要点（在 design.md §5.11 先补设计）
- **目标**：`NapukettoBot extends Bot`（koishi 平台注册）——**端到端验证点：koishi 控制台
  收到消息 + 能回复**。把 apply() 全面装配起来：driver + login + events + actions + bot。
- **关键问题（先想清楚再动手）**：
  1. **koishi 主包 import 边界**：`import { Bot } from "koishi"` 是运行时 import（单测崩溃，
     HANDOVER §7 坑 1）——bot.ts 是否进单测？进的话需要把 Bot 基类也依赖注入（apply() 层
     注入 Bot 类构造），只对可单测的纯逻辑（MessageEncoder 元素链路）写测试。
  2. **`internal` 挂载**：`NapukettoBot.internal = new NapukettoInternal({ request })`——request
     绑定 `client.request`（重启后 client 会换实例，onReady 时重建）。
  3. **`MessageEncoder`**：koishi 元素发送链路（`forward()`/`flush()`/`prepare()`），最终调
     `bot.internal.sendMessage(channelId, elements)`。
  4. **`initialize()`**：`getLogin()` 拉 selfInfo → `online()`；失败 `offline(error)`。
  5. **apply() 装配顺序**：spawn driver → onReady 里接 events（bridge）+ actions（internal 重建）
     → bot 平台注册（`ctx.platform('napuketto', ...)`）。
- **参考**：design.md §9.1 的 napcat/onebot Bot/MessageEncoder 骨架；`adaptSession` 模式
  （session 字段我们已由 events/adapt.ts 产出，bot.ts 只做 Bot.dispatch 接线）。

### 提示
- events/adapt.ts 已产 koishi session 字段（type/channelId/guildId/userId/elements/content），
  Bot 侧只需 `bot.session(event)` → 填字段 → `bot.dispatch(session)`。
- actions/internal.ts 已就绪（sendMessage/deleteMessage/getMessageList/markAsRead/列表/self），
  Bot 动作方法默认走 `this.internal.*`，无需重复实现。
- 多账号：apply 按 config.accounts 遍历 spawn（每账号一子进程），driver 事件回调闭包绑定 uin。
- config.ts schema 本轮一并做（koishi `Schema.object`，账号列表 + 连接参数）。

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

*交接完毕。下一会话从「§5 Bot 集成 src/bot.ts」开始，先补 design.md §5.11 设计，再实现。*
