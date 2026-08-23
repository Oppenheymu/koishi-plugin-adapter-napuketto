/**
 * launch.ts：launch 工厂（design.md §5.11）——launchSelfHost 组装 + 包入口解析。
 *
 * 参考 cli boot.ts 的组装方式。IPC 模式不传 adapterEntry/networkEntry
 * （loader ipc-bootstrap 只用 kernel services，§7）。
 *
 * `resolveLaunchOptions` 为纯函数（不 spawn，可单测）；`buildLaunch` 返回
 * DriverLauncher（真实 spawn，由 driver 调用，不直接测）。
 *
 * ⚠️ 发布形态（2026-08-09 产品化）：`@napuketto/kernel` / `@napuketto/loader`
 * 为 dependencies（真实安装，不 bundle）——子进程要的是磁盘真实文件
 * （self-host.cjs / stub QQNT.dll / kernel 入口），bundle 后资产丢失。
 * `resolveEntry` 用 `createRequire`（CJS 产物下 `import.meta.resolve` 被
 * 替换成 `{}` 报错，见 HANDOVER §5）；`launchSelfHost` 内部 `__dirname`
 * 定位 self-host.cjs 由 loader 包内 `files: ["dist", "native/..."]` 保证。
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import { resolveConfigPath, resolveDataRoot } from "@napuketto/kernel";
import {
    defaultStubDir,
    ensureQqFiles,
    launchSelfHost,
    type QqInstallInfo,
    resolveQqInstall,
} from "@napuketto/loader";
import type { NapukettoBotConfig } from "../config.js";
import type { DriverLauncher, DriverLaunchResult } from "../driver/index.js";

/**
 * 解析包入口（override 优先；否则 createRequire.resolve——CJS 产物下
 * `import.meta.resolve` 不可用，被 rolldown 替换成 `{}` 报
 * `{}.resolve is not a function`）。
 *
 * 缺省解析依赖 `@napuketto/*` 为真实 dependencies（发布后 npm 安装到
 * node_modules，createRequire 按 Node 标准解析规则查找）。
 */
const require = createRequire(import.meta.url);

export function resolveEntry(pkg: string, override?: string): string {
    if (override !== undefined && override !== "") {
        return resolvePath(override);
    }
    try {
        return require.resolve(pkg);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
            `无法解析 ${pkg} 入口: ${message}（请确认 ${pkg} 依赖已安装；` +
                `或手动指定 ${pkg} 入口路径）`,
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

/** 可注入依赖（测试用假实现，生产默认按平台分支解析）。 */
export interface LaunchResolvers {
    /** QQ 原生文件解析（默认按平台分支：win32 本机 / linux 下载到 ext4；测试注入假目录）。 */
    resolveQq?: (opts: { qqPath: string | undefined; dataRoot: string }) => Promise<QqInstallInfo>;
    /** 阶段回调（下载/解包/win-node/启动提示；默认无——resolveLaunchOptions 纯函数不落地）。 */
    onStage?: (message: string) => void;
}

/**
 * 默认 QQ 原生文件解析（2026-08-14 WSL 生产修复：按平台分支）。
 * win32 探测本机安装；linux/wine 直接用数据根 ext4 缓存 + 缺失自动下载——
 * wine 读 /mnt/c（DrvFS）会 File not found（2026-08-12 实测），本机探测命中
 * DrvFS 会导致 dlopen 失败、子进程 code=1 退出。
 */
async function defaultResolveQq(
    opts: {
        qqPath: string | undefined;
        dataRoot: string;
    },
    onStage?: (message: string) => void,
): Promise<QqInstallInfo> {
    // 显式 qqPath：直接定位（尊重用户显式路径；WSL 用户应指向 ext4 路径）
    if (opts.qqPath !== undefined && opts.qqPath !== "") {
        return resolveQqInstall(opts.qqPath);
    }
    if (process.platform === "linux") {
        return ensureQqFiles({
            dataRoot: opts.dataRoot,
            ...(onStage !== undefined ? { onStage } : {}),
        });
    }
    return resolveQqInstall();
}

/** 组装 launchSelfHost 选项（不 spawn；deps 测试注入）。 */
export async function resolveLaunchOptions(
    config: NapukettoBotConfig,
    deps: LaunchResolvers = {},
): Promise<ResolvedLaunch> {
    const dataRoot = resolveDataRoot(config.dataDir);
    const qq = await (deps.resolveQq ?? ((opts) => defaultResolveQq(opts, deps.onStage)))({
        qqPath: config.qqPath,
        dataRoot,
    });
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

/** launch 宿主（bot 注入 logger 等；buildLaunch 每次 spawn 前解析一次）。 */
export interface LaunchHost {
    /** 阶段日志回调（下载/解包/win-node/启动提示；bot 接 logger.info）。 */
    onStage?: (message: string) => void;
}

/** 启动工厂（driver 注入：每次 spawn 组装一次 launchSelfHost 调用）。 */
export function buildLaunch(config: NapukettoBotConfig, host: LaunchHost = {}): DriverLauncher {
    // ⚠️ launchSelfHost 自 P2（2026-08-12，Linux/wine 分支）起为 async：必须 await，
    // 否则 child 取自 Promise 为 undefined，driver 随后在 child.once 处崩溃。
    return async () => {
        const options = await resolveLaunchOptions(config, {
            ...(host.onStage !== undefined ? { onStage: host.onStage } : {}),
        });
        const { child } = await launchSelfHost({
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
            ...(host.onStage !== undefined ? { onStage: host.onStage } : {}),
        });
        // ChildProcess → 宽松 ChildProcessLike（pid 类型差异，driver 内部断言收窄）
        return { child: child as unknown as DriverLaunchResult["child"] };
    };
}
