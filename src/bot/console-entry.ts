/**
 * console-entry.ts：控制台前端入口注册（design.md §5.12）。
 *
 * packageRoot 逐级上溯定位插件包根目录（bundle 与源码两种形态均正确）；
 * registerConsoleEntry 模块级去重——多 bot 实例只注册一次 addEntry。
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "koishi";

/** 控制台前端入口已注册标记（模块级去重：多 bot 实例只注册一次）。 */
let consoleEntryRegistered = false;

/**
 * 包根目录（定位 client/ 与 dist/）。
 *
 * ⚠️ 2026-08-14 修复（二维码不显示根因）：bundle（lib/index.cjs，深 1 层）与
 * 源码（src/bot/bot.ts，深 2 层）的文件深度不同，`new URL("../..")` 只对源码
 * 形态正确；且 esbuild 转译 CJS 时把 import.meta.url shim 成可用（try 不抛错），
 * __dirname 兜底分支永远走不到——最终 dev/prod 入口被注册到 node_modules 根
 * （路径不存在），控制台面板永不挂载。改为逐级上溯找 package.json（校验包名），
 * bundle 与源码两种形态均正确。
 */
function packageRoot(): string {
    let dir: string;
    try {
        dir = fileURLToPath(new URL(".", import.meta.url));
    } catch {
        dir = __dirname;
    }
    for (let i = 0; i < 5; i += 1) {
        try {
            const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
                name?: string;
            };
            if (pkg.name === "koishi-plugin-adapter-napuketto") {
                return dir;
            }
        } catch {
            // 该层无 package.json（或不可读），继续上溯
        }
        dir = dirname(dir);
    }
    throw new Error("[napuketto] 无法定位插件包根目录（未找到 package.json）");
}

/** 注册控制台登录面板前端入口（dev 由 koishi dev 动态编译；prod 走 vite 产物 dist）。 */
export function registerConsoleEntry(ctx: Context): void {
    if (consoleEntryRegistered) {
        return;
    }
    consoleEntryRegistered = true;
    const root = packageRoot();
    console.log(
        "[napuketto] registerConsoleEntry: addEntry dev=" +
            resolve(root, "client/index.ts") +
            " prod=" +
            resolve(root, "dist"),
    );
    ctx.console.addEntry({
        dev: resolve(root, "client/index.ts"),
        prod: resolve(root, "dist"),
    });
}
