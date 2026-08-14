# koishi-plugin-adapter-napuketto

## 0.0.16

### Patch Changes

- fix: inject 迁入 namespace 统一元数据位置（与 Config/usage 一致，编译产物等价 static），
  修正两处回归：① 误加 `export const name` 会编译成 `NapukettoBot.name = ...` 赋值，而
  Function.name 是 writable:false——ESM 严格模式加载即抛 TypeError（实证），已移除（Bot
  子类插件名由 package.json 决定）；② inject 误标 `required` 会让 database/console 变
  强制依赖（没装数据库/控制台插件则 Bot 起不来），改回 `optional` 保持「没装也能跑」

## 0.0.15

### Patch Changes

- fix: 补全 Bot 类服务依赖声明——`static inject` 增加 `console: { required: false }`（登录面板
  依赖，与 database 同为可选增强）；Bot 子类插件（`export default`）模块级导出被 loader
  unwrapExports 丢弃，inject 必须挂类上（napcat 同构），此前 console 仅经 `ctx.inject` fork
  声明、static 层缺失

## 0.0.14

### Patch Changes

- fix: `SerialQueue` 清理链前接 catch 吞掉任务失败——任务失败时 `finally` 派生 promise 随之
  reject 被 `void` 丢弃，产生 unhandled rejection（vitest/Node 均报错）；行为不变
- test: 补全该写未写的单测（+36 用例，全量 541 通过）

  - `bot/utils/session.ts` `applySessionFields`：必填直赋 / 可选条件展开（exactOptionalPropertyTypes
    不 set undefined）/ elements 特殊处理（只设 elements 不设 content）
  - `ipc/pending.ts` `PendingRequests`：id 单调 / resolve / reject（动作名 + 错误码透传）/ 迟到响应
    忽略 / 超时 IpcError(TIMEOUT) / rejectAll 幂等 / 超时后清理
  - `driver/heartbeat.ts` `HeartbeatMonitor`：超时判定（seenAt 为准 / spawnAt 兜底 / 无参照不触发 /
    边界严格大于）/ 暂停状态跳过 / start 幂等 / stop 停止轮询
  - `bot/utils/driver-events.ts` `buildDriverEvents`：7 个事件回调的转发与日志（全 type-only import，
    运行时零 koishi 依赖，此前「不进单测」的保守结论已推翻）
  - `database/serial-queue.ts` `SerialQueue`：同 key 串行 / 异 key 并行 / 前序失败不阻塞 / 链尾清理
    防 Map 增长

## 0.0.13

### Patch Changes

- refactor: 按 fallow 静态分析重构，消灭全部死代码并拆分大文件（行为不变，全量单测 489 通过）

  - **拆分 godfile**：`bot.ts`（602 行 → 384 行）拆出 `bot/assembly.ts`（构造装配工厂，
    host 注入）、`bot/transform.ts`（kernel → Universal 翻译纯函数，新增 13 单测）、
    `bot/driver-events.ts`（driver 事件接线工厂）、`bot/console-entry.ts`（前端入口注册）、
    `bot/login-panel.ts`（控制台面板装配/指令上行）、`bot/session.ts`（session 字段赋值
    纯函数）、`src/constants.ts`（协议共享常量）；`driver.ts` 拆出 `driver/heartbeat.ts`
    （心跳监控独立类）；`ipc/client.ts` 拆出 `ipc/pending.ts`（请求-响应匹配）；
    `database/index.ts` 拆出 `database/serial-queue.ts`（per-key 串行队列）；
    `events/elements.ts` 新增 `bindKoishiH`（原 bot.ts adaptH 正名归位，对齐文档命名）
  - **前端拆分**：`settings.vue`（363 行 → 217 行）template 拆成 `client/components/QrCodePanel.vue`
    （二维码块）与 `client/components/StatusSection.vue`（状态块），fallow template 复杂度
    CRITICAL → 移除
  - **死代码清理**：`console/provider.ts` 移除 6 个无消费者导出（`LOGIN_SERVICE_PREFIX`、
    `RELOGIN_EVENT_SUFFIX`、`REFRESH_QR_EVENT_SUFFIX`、`reloginEventName`、`refreshQrEventName`、
    `LoginPanelOptions`），`console/index.ts` barrel 收窄；fallow dead files 3.2% → 0%、
    dead exports 8.6% → 0%，MI 91.4 → 92.7
  - **复杂度**：`dispatchSession` CRAP 306 → 132（预热逻辑拆 `preheat()`），`getLogin` CRAP
    110 → 消除；`dispatchSession`/`getLogin` 均不再 CRITICAL
  - **误报豁免**：`.fallowrc.jsonc` 标记 `client/**` 为动态入口（控制台 addEntry 注册，静态
    分析看不到）+ `provider.get` 为 DataService 抽象实现豁免
  - **顺带修复**：`QrCodePanel.vue` template 引用未定义的 `qrUrl`（改为 `qr?.qrcodeUrl`）
  - 前端类型声明文件迁移到 `client/types/`（`koishijs-client.d.ts`/`shims.d.ts`）

## 0.0.12

### Patch Changes

- 5ad758c: fix(adapter): 修复控制台扫码登录二维码不显示——二维码改为后端拼成完整 data URI（`image` 字段）由前端 `<img :src>` 直接展示（参照 bilibili-dm 的 image 模式，不再前端拼 `data:image/png;base64,`）；并在 console 服务自身作用域监听 `console/connection`，客户端连接瞬间兜底重推最新登录快照（登录自动启动早于客户端连接，PUSH 被 broadcast 的 `!handles.length` 丢弃）
- 9c071b8: fix(adapter): 修复控制台插件详情页不显示「本插件提供了…」说明——`usage` 原在 `index.ts` 模块级导出，被 koishi loader 的 `unwrapExports`（`module?.default || module`）随 `export default NapukettoBot` 解包时丢弃；改为挂到 `NapukettoBot` 类上（namespace 声明合并），`PackageProvider.parseExports` 的 `exports?.usage` 才能读到。同时把二维码面板 `get()` 的诊断日志从裸 `console.log` 改为 `logger.info`，便于确认前端 PULL 是否触发

## 0.0.11

### Patch Changes

- d2f9245: fix(adapter): 修复控制台扫码登录二维码不显示——登录自动启动早于控制台客户端连接，二维码推送因 `broadcast` 无客户端被丢弃；改为服务值注册到 root store（`Client.refresh()` 的 PULL 能读到）并拿 `set` 返回的 dispose 函数在 bot dispose 时清理，reload 不再报 `service has been registered`

## 0.0.10

### Patch Changes

- d2f9245: fix(adapter): 修复控制台扫码登录二维码不显示——登录自动启动早于控制台客户端连接，二维码推送因 `broadcast` 无客户端被丢弃；修复服务值注册到 `ctx.root` 确保 `Client.refresh()` 的 PULL 能拉到快照，并在 `console/connection` 事件触发时兜底推送

## 0.0.9

### Patch Changes

- 98c27a3: feat(adapter): 扫码登录「刷新二维码」改为 IPC 直达（不再重启子进程）+ 超时文案

  - 前端「刷新二维码」按钮改发 `refresh-qr` console 事件 → `requestRefreshQr()`
    → IPC `login.refreshQr` 动作直达 kernel，不重启子进程（「重新登录」按钮仍保留重启语义）
  - `NapukettoLoginProvider` 新增 `refresh-qr` 事件上行；`NapukettoLoginState.onLogin`
    支持 `message`（failed 态失败原因，如「登录超时，请刷新页面重试」）
  - 前端 waiting_scan 增加「请在两分钟内…」提示，移除 3 分钟 UI 过期计时器
    （kernel 已自动刷新 + 120s 超时兜底）

- Updated dependencies [98c27a3]
- Updated dependencies [98c27a3]
  - @napuketto/loader@0.0.12
  - @napuketto/kernel@0.0.10

## 0.0.8

### Patch Changes

- fix(actions): 媒体路径统一规范化（Windows 反斜杠 → 正斜杠）——redposter 实证 `file://` 转 `fileURLToPath` 后 Windows 返回反斜杠路径，透传给 wrapper.node rich media 服务读不到文件，仍报 `rich media transfer failed`（现象：发送方日志「已缓存海报图片」成功但 `msg.sendMessage` 失败）。`mediaElement` 现对 `img`/`audio` 的本地路径（含 `file://` 转换结果）统一 `replace(/\\/g, "/")` 转正斜杠（Chromium/Electron 内部按 URL 语义处理路径），同步更新单测与 design.md §5.10

## 0.0.7

### Patch Changes

- f6b94c2: fix(events): dispatch 前原子预热 channel，消除 koishi get-or-create 并发撞唯一键——koishi `Session.getChannel` 是 check-then-act（先 SELECT、未命中才 INSERT），多条真实消息同 tick 批量 dispatch 时并发 INSERT 撞 `(id, platform)` 复合主键报 `UNIQUE constraint failed`（实测同批 4 条 → 1 成功 + 3 冲突，框架侧根因已上报 koishijs/koishi#1545）。新增 `src/database/`（NapukettoDatabase）集中管理数据库操作：dispatch 前两段式预热（get 命中直返 / 未命中 minato upsert 幂等创建）+ per-channel 串行队列（不同 channel 并行）+ 预热失败单次告警不阻断消息 + autoAssign=false 保持 koishi 不落库语义。预热后框架 SELECT 必命中，从根上消除竞态

## 0.0.6

### Patch Changes

- fix: 包 exports 增加 require/default 条件——`@napuketto/*` 被 koishi 插件（CJS 产物）作 dependencies 消费时，`require('@napuketto/kernel')` 此前因 exports 仅声明 `import` 条件而报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。补 `require`/`default` 条件指向同一 `.mjs`（无顶层 await，Node 22.12+ require(esm) 原生同步加载）；插件发布链自动追踪新版本
- Updated dependencies
  - @napuketto/kernel@0.0.4
  - @napuketto/loader@0.0.7

## 0.0.5

### Patch Changes

- a3ead3e: fix: 产品化发布形态——`@napuketto/kernel`/`@napuketto/loader` 从 devDependencies 移到 dependencies（tsdown external 不 bundle），子进程需要的磁盘资产（self-host.cjs / stub QQNT.dll / kernel 入口）由 npm 真实安装提供；`resolveEntry` 改用 `createRequire` 替代 `import.meta.resolve`（CJS 产物下失效，此前干净环境安装必然报 `{}.resolve is not a function`）。新增主仓库发布链工具 `scripts/sync-adapter-deps.ts`（Node 原生 type stripping 直跑 + vitest 单测）：发版时自动查询 registry latest 并把插件依赖范围刷成 `~latest`，自动追踪 kernel/loader 最新 0.0.x 修复（release 链已接入）
- 9f563f5: fix: client 前端 tsconfig 严格化（ES2025 + strict 全家桶 + bundler 解析），通过 paths 重定向 `@koishijs/client` 到本地类型 shim 隔离上游 TS 源码错误，并把 client 类型检查接入包级 `pnpm check`

## 0.0.4

### Patch Changes

- 6ee4b54: fix(actions): 修复 file:// 协议图片/语音发送失败（rich media transfer failed）——`mediaElement` 现将 `file://` URL（如 redposter 用 `pathToFileURL` 生成的 src）经 `fileURLToPath` 转为真实本地路径，避免带协议前缀透传给 wrapper.node

## 0.0.3

### Patch Changes

- f6666d1: fix(client): 修复前端类型报错与构建依赖——tsconfig 改用 bundler 解析、移除上游损坏的 `@koishijs/client/global` 类型引用（5.30.11 exports 映射 bug）、新增 shims.d.ts 提供 `*.vue` 模块声明、显式声明 vue devDependency 保证 vite 构建可复现

## 0.0.2（2026-08-09）

- feat: Bot 集成——NapukettoBot 注册 koishi 平台（driver 装配/事件桥/动作桥/MessageEncoder），端到端链路打通
- feat(config): selfHostEntry 自建宿主入口覆盖（发布形态方案 a）——bundle 后 \_\_dirname 定位 self-host.cjs 失效，bot 配置可显式指定入口
- fix(events): 修复 dispatch 链路三 bug——数据库无消息记录的根因
- fix(bot): 修复 Context 泛型逆变不兼容——改用 @satorijs/core 的 Context，TS 7.0 原生语言服务通过
- test: 新增单元测试覆盖 ipc/client/codec/subscribers/transport 与 channel/elements/internal
- refactor: fallow 静态分析优化——死代码 51→0、重复 63→0、MI 92.1

## 0.0.1（2026-08-08）

- 首版骨架：IPC 传输层 + NapukettoDriver 基础框架
