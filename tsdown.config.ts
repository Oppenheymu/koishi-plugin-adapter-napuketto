/**
 * tsdown.config.ts：koishi 适配器构建（骨架阶段）。
 *
 * 产物形态：CJS 单文件 bundle（lib/index.cjs）——koishi loader 用 require()
 * 加载插件（@koishijs/loader 4.18.11 实测，ns-require 解析后直接 require）。
 * 自包含策略：
 *   - @napuketto/*（devDependencies）被 rolldown bundle 进产物，运行时
 *     不依赖主仓库（绕开「CJS require ESM 依赖」与 workspace 协议跨仓库失效）
 *   - koishi（peerDependencies）保持 external，运行时从 koishi 实例解析
 *     （单实例，无双 koishi 风险）
 */
import { defineConfig } from "tsdown";

export default defineConfig({
    entry: ["src/index.ts"],
    format: ["cjs"],
    platform: "node",
    outDir: "lib",
    clean: true,
    dts: true,
});
