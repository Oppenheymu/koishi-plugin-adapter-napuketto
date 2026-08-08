/**
 * tsdown.config.ts：koishi 适配器构建。
 *
 * 产物：lib/index.js（CJS，包无 type:module）——koishi loader 用 require() 加载插件。
 * 发布形态自包含：@napuketto/*（devDependencies）被 rolldown bundle 进产物，
 * 运行时只依赖 koishi（peer）；koishi 保持 external（单实例）。
 *
 * 开发形态走 package.json exports.development 条件（→ src/index.ts），
 * koishi 在 NODE_ENV=development 下直载 TS 源码（esbuild-register 转译），免构建。
 */
import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs'],
    platform: 'node',
    outDir: 'lib',
    clean: true,
    dts: true,
});
