# koishi-plugin-adapter-napuketto

[![npm](https://img.shields.io/npm/v/koishi-plugin-adapter-napuketto?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-adapter-napuketto)

NapukettoQQ 的 Koishi 适配器：让 Koishi 直接驱动 NapukettoQQ（自研 QQ NT `wrapper.node` 协议层，无需 NapCat）。

## 状态

**骨架阶段**（2026-08-08）：已验证「koishi 加载 bundle 了 @napuketto/* 的 CJS 产物」链路。

## 开发

本仓库是 NapukettoQQ 主仓库的 git submodule（`apps/koishi-plugin-adapter-napuketto`），
日常开发在主仓库内进行（pnpm workspace 解析 `@napuketto/*`）：

```bash
pnpm install                       # 主仓库内
pnpm --filter koishi-plugin-adapter-napuketto build
pnpm --filter koishi-plugin-adapter-napuketto check
```

koishi 实例在仓库外（如 `koishi-dev/`），通过 `portal:` 或 `file:` 链接本包。

### 双模开发

- **开发免构建**：`exports.development` 条件（NODE_ENV=development 时 koishi 直载 `src/index.ts`，
  配合 esbuild-register 转译），改源码即时生效，无需 `pnpm build`
- **发布形态**：`exports.default` 指向 `lib/index.js`（CJS bundle，@napuketto/* 已内联，
  运行时只依赖 koishi peer）

## 许可证

MIT

