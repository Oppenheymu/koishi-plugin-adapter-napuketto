# koishi-plugin-adapter-napuketto

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
