/**
 * tsdown.config.ts：koishi 适配器构建。
 *
 * 产物：lib/index.cjs（CJS）——koishi loader 用 require() 加载插件。
 * 发布形态（2026-08-09 产品化）：@napuketto/kernel、@napuketto/loader 为
 * dependencies（npm 真实安装），**external 不 bundle**——自建宿主子进程
 * spawn 时按绝对路径读磁盘真实文件（self-host.cjs / stub QQNT.dll /
 * kernel 入口），bundle 后这些资产丢失（见 HANDOVER §5）。koishi 保持
 * external（peer 单实例）。
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
    deps: {
        // 生产依赖全部 external（dependencies：@napuketto/* + @koishijs/*），
        // 运行时由 npm 安装的真实包提供（子进程要磁盘文件，不能 bundle）。
        bundle: false,
        dts: {
            // koishi 生态 d.ts 用 CJS dts 语法（export = Element）或 namespace 成员
            // re-export（Fragment/Render），dts 打包无法解析 → 生成 d.ts 时保持
            // 外部引用（产物 d.ts 保留 import，消费端由 koishi 提供类型）。
            neverBundle: [/^koishi/, /^@satorijs\//, /^@koishijs\//, /^cordis/, /^minato/, /^cosmokit/],
        },
    },
});
