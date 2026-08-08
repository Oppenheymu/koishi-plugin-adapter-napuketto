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
| 5 | `src/actions/` 动作桥 | ⏳ **下一步** | — | koishi 动作 → kernel API |
| 6 | `src/bot.ts` Bot 集成 | ⏳ | — | NapukettoBot 注册 koishi 平台 |
| 7 | 收尾（多账号/文档/发布） | ⏳ | — | changesets + koishi 市场 |

**子仓库 HEAD = `31f3504`（事件桥）**，工作区干净；主仓库 HEAD = `1257992`（submodule 指针），
领先 origin 1 提交（未 push）。**新会话第一件事：把两个仓库 push 到 origin**（或先继续施工再一起推）。

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

## 4. 主仓库前置（§7 已落地，勿重复）

- **kernel**：`NTEventChannel.onAny`（全事件订阅）+ `CoreLoginOptions.onLoginProgress`
  （QR 阶段回调）+ `LoginProgress` 类型导出
- **loader**：`src/host/ipc/`（NAPUTO_IPC=1）——类型/编解码/发送/动作表/stdin 服务端/心跳；
  `protocols.ts` 拆 `kernel-services.ts`（IPC/协议共用）+ `assemble-protocols.ts`（OB11/Satori）；
  `launcher.ts` `LaunchOptions.ipc` 注入 NAPUTO_IPC=1
- **变化集**（主仓库 9005c43 + changeset `koishi-ipc-prereq.md`，kernel/loader patch）

## 5. 下一步：动作桥 `src/actions/`（实现顺序第 5 步）

### 设计要点（在 design.md §5.10 先补设计）
- **目标**：koishi Bot 动作 → IPC action 请求 → 子进程 kernel API。打通「koishi 发消息」。
- **loader 侧动作表已就绪**（主仓库 §7）：`msg.sendMessage/recallMessage/fetchMessages/markRead`
  + `group.getGroupList` + `friend.getFriendList` + `login.getSelf`；**peerUin 自动转 uid**
  （注入 groupApi.uinToUid）。动作名点分域：`msg.sendMessage` 等。
- **插件侧**：`NapukettoInternal`（koishi `bot.internal` 封装）→ `client.request(action, params)`；
  参考 napcat 的 `internal._request` 传输抽象（design.md §9.1）——把传输换成 IPC 请求即可。
- **关键映射**：
  - `sendMessage(channelId, content)` → `msg.sendMessage`：channelId 是群号（group）或
    `private:` + uin（私聊，事件桥 §5.9 同款）；content 是 koishi 元素 → **反向映射**
    canonical（新写 `src/actions/elements.ts`，与 events/elements.ts 对称：h.at → at、
    h.image → image、h.quote → reply、纯文本 → text）
  - `deleteMessage` → `msg.recallMessage`（msgIds 数组）
  - `getMessageList` → `msg.fetchMessages`
  - `markAsRead` → `msg.markRead`
- **可单测**：纯函数（元素反向映射 + channelId 解析）用 mock h / mock client；client.request
  用 MemoryLinePair 注入。

### 提示
- `NapukettoIpcClient.request` 已就绪（超时/错误 IpcError），直接复用。
- 元素反向映射注意 koishi `h.at` 的 attrs 是 `{ id }`（事件桥 §5.9 已确认），image 是 `{ src }`。
- peer 目标解析：群聊 channelId=群号（chatType=2）、私聊 channelId=`private:`+uin（chatType=1）——
  用 `client.request("msg.sendMessage", { chatType, peerUin, elements })`，loader 侧自动转 uid。

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

*交接完毕。下一会话从「§5 动作桥 src/actions/」开始，先补 design.md §5.10 设计，再实现。*
