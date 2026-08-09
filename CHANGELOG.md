# koishi-plugin-adapter-napuketto

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
