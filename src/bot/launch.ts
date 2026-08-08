/**
 * launch.ts：launch 工厂（design.md §5.11）——launchSelfHost 组装 + 包入口解析。
 *
 * 参考 cli boot.ts 的组装方式。IPC 模式不传 adapterEntry/networkEntry
 * （loader ipc-bootstrap 只用 kernel services，§7）。
 *
 * `resolveLaunchOptions` 为纯函数（不 spawn，可单测）；`buildLaunch` 返回
 * DriverLauncher（真实 spawn，由 driver 调用，不直接测）。
 *
 * ⚠️ 发布形态（HANDOVER 记录）：`@napuketto/*` 被 bundle 进产物后
 * `import.meta.resolve` 失效、`launchSelfHost` 内部 `__dirname` 定位
 * self-host.cjs 也失效。本轮目标 = 开发态端到端验证（workspace 包已 build）；
 * 生产发布需 config 显式覆盖入口路径或改依赖形态（收尾步骤 7）。
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveConfigPath, resolveDataRoot } from "@napuketto/kernel";
import {
    defaultStubDir,
    launchSelfHost,
    type QqInstallInfo,
    resolveQqInstall,
} from "@napuketto/loader";
import type { NapukettoBotConfig } from "../config.js";
import type { DriverLauncher, DriverLaunchResult } from "../driver/index.js";

/** 解析包入口（override 优先；否则 import.meta.resolve，开发态 workspace 包已 build）。 */
export function resolveEntry(pkg: string, override?: string): string {
    if (override !== undefined && override !== "") {
        return resolvePath(override);
    }
    try {
        const url = import.meta.resolve(pkg);
        return fileURLToPath(url);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
            `无法解析 ${pkg} 入口: ${message}（开发态请先 build 主仓库各包；` +
                `生产态请在 bot 配置指定 ${pkg} 入口路径）`,
        );
    }
}

/** 路径解析（相对路径基于进程 cwd 展开）。 */
function resolvePath(p: string): string {
    return p.startsWith(".") ? join(process.cwd(), p) : p;
}

/** launchSelfHost 选项（resolveLaunchOptions 产出，测试断言用）。 */
export interface ResolvedLaunch {
    qq: QqInstallInfo;
    kernelEntry: string;
    selfHostEntry?: string;
    cfgDir: string;
    cwd: string;
    configPath: string;
    stubDir: string;
    quickUin: string;
    selfHost: true;
    ipc: true;
    stdio: readonly ["pipe", "pipe", "pipe"];
}

/** 可注入依赖（测试用假实现，生产默认 loader 实现）。 */
export interface LaunchResolvers {
    /** QQ 安装解析（默认 resolveQqInstall；测试注入假 QQ 目录）。 */
    resolveQq?: (qqPath?: string) => QqInstallInfo;
}

/** 组装 launchSelfHost 选项（纯函数，不 spawn；deps 测试注入）。 */
export function resolveLaunchOptions(
    config: NapukettoBotConfig,
    deps: LaunchResolvers = {},
): ResolvedLaunch {
    const dataRoot = resolveDataRoot(config.dataDir);
    const qq = (deps.resolveQq ?? resolveQqInstall)(config.qqPath);
    const cfgDir = join(dataRoot, config.selfId);
    const stubDir = config.stubDir ?? defaultStubDir();
    return {
        qq,
        kernelEntry: resolveEntry("@napuketto/kernel", config.kernelEntry),
        ...(config.selfHostEntry !== undefined ? { selfHostEntry: config.selfHostEntry } : {}),
        cfgDir,
        cwd: dataRoot,
        configPath: resolveConfigPath({ dataRoot }),
        stubDir,
        quickUin: config.selfId,
        selfHost: true,
        ipc: true,
        stdio: ["pipe", "pipe", "pipe"],
    };
}

/** 启动工厂（driver 注入：每次 spawn 组装一次 launchSelfHost 调用）。 */
export function buildLaunch(config: NapukettoBotConfig): DriverLauncher {
    return () => {
        const options = resolveLaunchOptions(config);
        const { child } = launchSelfHost({
            qq: options.qq,
            kernelEntry: options.kernelEntry,
            ...(options.selfHostEntry !== undefined
                ? { selfHostEntry: options.selfHostEntry }
                : {}),
            cfgDir: options.cfgDir,
            cwd: options.cwd,
            configPath: options.configPath,
            stubDir: options.stubDir,
            quickUin: options.quickUin,
            selfHost: options.selfHost,
            ipc: options.ipc,
            stdio: [...options.stdio],
        });
        // ChildProcess → 宽松 ChildProcessLike（pid 类型差异，driver 内部断言收窄）
        return { child: child as unknown as DriverLaunchResult["child"] };
    };
}
