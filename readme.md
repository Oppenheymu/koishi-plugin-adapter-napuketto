# koishi-plugin-adapter-napuketto

[![npm](https://img.shields.io/npm/v/koishi-plugin-adapter-napuketto?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-adapter-napuketto)

NapukettoQQ 的 Koishi 适配器：让 Koishi 直接驱动 NapukettoQQ（自研 QQ NT `wrapper.node` 协议层）。

## 状态

**骨架阶段**（2026-08-08）：已验证「koishi 加载 bundle 了 @napuketto/* 的 CJS 产物」链路。

## 开发

本仓库是 NapukettoQQ 主仓库的 git submodule（`apps/koishi-plugin-adapter-napuketto`），
日常开发在主仓库内进行（pnpm workspace 解析 `@napuketto/*`）：

```bash
pnpm install   # 主仓库内
pnpm --filter koishi-plugin-adapter-napuketto build
```

独立开发（脱离主仓库）：需要自行提供 `@napuketto/*` 依赖（portal 链接主仓库或等待 npm 发布）。

## 构建产物形态

- `lib/index.cjs`：CJS 单文件 bundle（koishi loader 用 `require()` 加载插件）
- `@napuketto/*` 已 bundle 进产物；`koishi` 保持 external（peer 依赖）

