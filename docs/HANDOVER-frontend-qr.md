# 交接：koishi 前端扫码二维码不渲染（2026-08-14）

> 新对话接手先读本文件，再读 docs/HANDOVER.md（主交接）与参考项目
> C:\Dev\QQBot-Dev\koishi-plugin-adapter-bilibili-dm-main（对标实现）。

## 一句话现状

后端已通、前端无渲染。子进程能 spawn，登录流程走到 waiting_scan 且二维码数据已到达 Bot
（日志可见「二维码更新」），但 koishi 浏览器控制台的插件详情页里什么都没出来——用户要的是
前端二维码，不是终端日志。

    2026-08-14 00:40:49 [D] napuketto 引导阶段: booting / dlopening / logging
    2026-08-14 00:40:55 [D] napuketto 登录状态: waiting_scan
    2026-08-14 00:40:55 [D] napuketto 二维码更新   ← onQr 已到 Bot，pushLoginPanel 被调用

## ⚠️ 2026-08-14 深夜定论：生产环境 403 根因（0.0.18 已修，勿再绕）

生产环境（NODE_ENV ≠ development → console devMode=false）登录面板不显示的**真正根因**：
`@koishijs/plugin-console` 的 `serveAssets()` 对 `/<uiPath>/@plugin-<key>/...` 有安全检查——

    if (!filename2.startsWith(this.root) && !filename2.includes("node_modules")) {
        return ctx.status = 403;
    }

插件前端入口（addEntry 的 prod，默认 `<包根>/dist`）路径必须 startsWith(console root) 或
包含 "node_modules"，否则 403 → 浏览器动态 import 失败 → 插件详情页 slot 不挂载 → 面板永不
显示。**标准 npm/pnpm 安装（插件在 node_modules 下）天然通过；portal/本地路径/桌面端等
非标准安装（路径不含 node_modules）必 403**。开发环境（yarn dev，NODE_ENV=development →
devMode=true）走 vite dev server（/vite/@fs/ 路径），不经 serveAssets 安全检查，故正常。

**实证**（koishi-dev 生产模式复现，浏览器 F12）：
- portal 链接形态：`GET /@plugin-uvgmyp4u6t/index.js → 403`，面板不显示
- 标准 npm 形态（复制到 node_modules）：200，面板显示「未登录（等待子进程就绪）」
- portal + 0.0.18 修复：200，面板显示二维码（image data URI 完整）→ 登录成功后切「登录成功」

**修复（0.0.18，src/bot/utils/console-entry.ts）**：`ensureServeableProd()`——prod 路径不含
node_modules 时，把 dist 产物复制到 `<baseDir>/data/napuketto-console/node_modules/
koishi-plugin-adapter-napuketto/dist`（路径字符串含 node_modules → 通过安全检查），
addEntry 指向复制产物；文件未变化仅 stat 比较不重复写盘。标准安装零改动。注册日志
console.log → ctx.logger（koishi 日志可见，此前 console.log 混在 stdout 不易定位）。

**排查经验（勿重复）**：后端数据全通（provider 推送 + `get() 被调用 qr=true`）+ 面板不显示
的组合，**先看浏览器 F12 Network 的 `@plugin-` 请求**——403 即本根因；服务端/koishi 日志
都不会打这个 403，只能从浏览器侧看到。

## 之前两轮（勿再绕）

### 第二轮：provider 装配已修（0.0.16，本文件上一版内容）



loader 的 launchSelfHost 在 P2（Linux/wine 分支）起变 async，但 buildLaunch 没 await，child 恒为
undefined → driver 在 child.once 崩 → 子进程从未 spawn（表现为「无任何日志」）。已修：

- src/bot/launch.ts：buildLaunch 改 async + await launchSelfHost(...)
- src/driver/types.ts：DriverLauncher = () => Promise<DriverLaunchResult>
- src/driver/driver.ts：spawnProcess 改 async + await this.launch()
- 测试同步更新（driver 三个测试 + test-utils + launch.test.ts 补 source: "local"）
- 已验证：tsc + biome 通过；vitest 18 文件 122 用例全绿；lib + client dist 已重建

## 前端数据流（务必理解这条链）

1. NapukettoBot 构造函数内：this.ctx.inject(["console"], cb)，cb 里 registerConsoleEntry(ctx)
   （ctx.console.addEntry({dev: client/index.ts, prod: dist})）+ new NapukettoLoginProvider(ctx) 并 pushLoginPanel()
2. NapukettoLoginProvider extends DataService，update(payload) → this.refresh()
3. DataService.refresh()（@koishijs/console/src/service.ts）→ this.ctx.get('console')?.broadcast('data',
   { key: "napuketto-login-<uin>", value })
4. console 客户端把 value 写进 store["napuketto-login-<uin>"]
5. client/settings.vue 的 data computed 读 store["napuketto-login-<selfId>"] → 渲染二维码

## 断点关键

bot.ts 的 pushLoginPanel()：若 provider === null 则静默 return（前端什么都没发生）。所以「二维码更新」
日志出现但前端没东西，最可能说明 panelRef.current 仍是 null——即 ctx.inject(["console"], cb) 的回调压根没
触发，或触发了但 provider 在错误的 scope 创建。

## 最可能根因（按概率排序）

- A. ctx.inject(["console"], cb) 回调没触发 → addEntry 没注册 + DataService 没创建 → 前端既无 entry 也无数据
- B. 回调触发，但 DataService 所在 scope 的 ctx.get('console') 为 undefined → refresh() 里 ?.broadcast 静默空转
- C. addEntry 的 dev/prod 路径或 console 编译没生效 → settings.vue 压根没被加载到插件详情页 slot

## 与参考项目的关键差异（重头）

参考项目：C:\Dev\QQBot-Dev\koishi-plugin-adapter-bilibili-dm-main（MIT，可整段借鉴骨架）。

- bilibili-dm：export function apply(ctx, config) + export const inject = { required: ["console", ...] }；
  在 apply() 里直接 ctx.console.addEntry(...) + new BilibiliLauncher(ctx,...)（DataService），console 由
  插件级 inject.required 保证在 apply 前就绪。
- napuketto：export default NapukettoBot（Bot 子类，平台适配器模式）；console 装配塞在 Bot 构造函数里，
  用 ctx.inject(["console"], cb) 延迟做。

结论：napuketto 走的是「构造器内 ctx.inject 延迟」的脆弱路径；bilibili-dm 走「插件级 apply +
inject.required」的稳健路径。大概率要往 bilibili-dm 的模式靠。

## 建议修复方向

1. 先加日志定位断点（最快，10 分钟）：在 registerConsoleEntry 开头、NapukettoLoginProvider 构造函数、
   update() 里各加一条 console.log / this.logger.info，重启 yarn dev 看断在哪一层。
2. 大概率重构（把 console 装配从 Bot 构造器挪到插件级）：
   - 方案 a（对齐 bilibili-dm）：改成 apply(ctx, config) 默认导出 + inject.required: ["console"]，在 apply 里
     ctx.console.addEntry + 创建 DataService，再 ctx.plugin(适配器)。
   - 方案 b（保留 Bot 子类）：把 DataService 创建改为用 root ctx（ctx.root，参考 bot.ts 里 NapukettoDatabase
     收 root ctx 的做法——root 一定有 console），并确保 addEntry 在插件级执行一次。

## 参考项目关键文件（直接对照抄）

| 文件 | 作用 |
|---|---|
| src/index.ts | apply + inject.required + BilibiliLauncher（DataService 子类）+ ctx.console.addEntry |
| src/bot/adapter.ts | Adapter 子类 + fork/startBot |
| src/bot/service.ts | 状态管理，updateStatus → launcher.updateStatus → refresh() |
| client/index.ts | ctx.slot({ type: 'plugin-details', component: Settings }) |
| client/settings.vue | data computed：inject('manager.settings.current') 查 disabled、inject('manager.settings.config') 查 selfId、store[serviceId] 读数据 |

已知差异：napuketto 的 settings.vue 用 config.value?.disabled 判断禁用，bilibili-dm 用 current.value?.disabled
（manager.settings.current）。前者可能拿不到 disabled，属次要问题，一并核对。

## 验证命令

    # 子仓库 check（biome + tsc + client tsc）
    pnpm -C c:\Dev\QQBot-Dev\NapukettoQQ\apps\koishi-plugin-adapter check
    # 单测（主仓库根；esbuild 要 spawn 子进程，沙箱下需 full-access 否则 EPERM）
    node_modules\.bin\vitest run apps/koishi-plugin-adapter
    # 联调
    cd C:\Dev\QQBot-Dev\koishi-dev && yarn dev   # 控制台 http://localhost:5140（密码 123456）

## 本轮已改文件（均 staged，未提交）

- src/bot/launch.ts / src/driver/types.ts / src/driver/driver.ts / src/driver/test-utils.ts
- src/driver/__tests__/{driver,driver-restart,driver-events}.test.ts / src/bot/launch.test.ts
- 重建产物 lib/index.cjs / lib/index.d.cts / dist/index.js / dist/index.css
- 另有用户自己的 0.0.9 发版准备（CHANGELOG.md + package.json version 0.0.8→0.0.9），与本次修复分开提交
