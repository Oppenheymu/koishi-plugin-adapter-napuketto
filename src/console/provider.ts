/**
 * provider.ts：控制台登录面板数据服务（design.md §5.12）。
 *
 * NapukettoLoginProvider extends DataService（@koishijs/plugin-console）：
 *  - 数据下行：update() 存快照 + refresh() 推送到前端 store（`napuketto-login-<uin>`）
 *  - 指令上行：注册 `napuketto-login-<uin>/relogin` console 事件 →
 *    onRelogin 回调（bot 层发 IPC control restart 重启登录流程）
 *
 * 运行时 import @koishijs/plugin-console / koishi——本文件不进单测
 * （HANDOVER §7 坑 1）；纯逻辑在 payload.ts（可单测）。
 */
import { type Console, DataService, type Events } from "@koishijs/plugin-console";
import type { Context } from "koishi";
import type { LoginPanelPayload } from "./types.js";

// 类型声明扩展（B站模板同款模式）：把本 provider 的 serviceId / relogin 事件
// 挂进 @koishijs/plugin-console 的类型空间（store 键 + addListener 事件名校验）。
// ⚠️ TS7 native（tsgo）对 declare module + export *（@koishijs/console）的
// namespace 合并不生效（调用点 cast 兜底，见 super/addListener）；旧 TS 下
// 声明有效，未来 TS 修复后可直接去掉 cast。
declare module "@koishijs/plugin-console" {
    namespace Console {
        interface Services {
            [key: `napuketto-login-${string}`]: NapukettoLoginProvider;
        }
    }
    interface Events {
        [key: `napuketto-login-${string}/relogin`]: (data: { selfId: string }) => void;
        [key: `napuketto-login-${string}/refresh-qr`]: (data: { selfId: string }) => void;
    }
}

/** serviceId 前缀（多账号隔离：napuketto-login-<uin>）。 */
export const LOGIN_SERVICE_PREFIX = "napuketto-login";

/** 重新登录 console 事件名后缀。 */
export const RELOGIN_EVENT_SUFFIX = "relogin";

/** 刷新二维码 console 事件名后缀。 */
export const REFRESH_QR_EVENT_SUFFIX = "refresh-qr";

/** store 键 / serviceId。 */
export function loginServiceId(selfId: string): string {
    return `${LOGIN_SERVICE_PREFIX}-${selfId}`;
}

/** 重新登录事件名（前端 send / 后端 addListener 用）。 */
export function reloginEventName(selfId: string): string {
    return `${loginServiceId(selfId)}/${RELOGIN_EVENT_SUFFIX}`;
}

/** 刷新二维码事件名（前端 send / 后端 addListener 用）。 */
export function refreshQrEventName(selfId: string): string {
    return `${loginServiceId(selfId)}/${REFRESH_QR_EVENT_SUFFIX}`;
}

/** provider 选项。 */
export interface LoginPanelOptions {
    /** 登录账号（QQ 号）。 */
    selfId: string;
    /** 前端点「重新登录」回调（bot 层发 IPC control restart）。 */
    onRelogin?: () => void;
    /** 前端点「刷新二维码」回调（bot 层发 IPC login.refreshQr 动作，不重启子进程）。 */
    onRefreshQr?: () => void;
}

/** 控制台登录面板数据服务（DataService 下行 + relogin 指令上行）。 */
export class NapukettoLoginProvider extends DataService<LoginPanelPayload> {
    private payload: LoginPanelPayload;
    private readonly onRelogin: (() => void) | undefined;
    private readonly onRefreshQr: (() => void) | undefined;

    constructor(ctx: Context, options: LoginPanelOptions) {
        // ⚠️ 服务值必须注册到 root（2026-08-14 根因修复 v2）：登录是自动启动的，
        // 二维码/状态在 koishi 启动阶段就推送完了，但此时控制台客户端尚未连接，
        // DataService.refresh() → broadcast 的 `if (!handles.length) return` 把
        // 推送全部丢弃；用户打开控制台后只能靠 Client.refresh() 的 PULL 拉取
        // 快照。Client.refresh() 用「Console 服务的 ctx」调 ctx.get(name) 读
        // store——本 provider 的 ctx 是 bot 的 inject(['console']) fork 作用域，
        // 与 Console 服务的 ctx 是兄弟作用域，set 到 inject 作用域后 PULL 可能
        // 读不到。修复：① ctx.root.set（root 是所有作用域 store 的祖先，PULL
        // 必能读到）；② immediate: true（避免 ready 后 `if (!immediate)
        // ctx.set` 与手动 set 重复注册抛 "service has been registered"，该异常
        // 会 cancel inject 作用域、连带移除 console/connection 兜底监听）。
        super(ctx, loginServiceId(options.selfId) as keyof Console.Services, {
            immediate: true,
        });
        this.onRelogin = options.onRelogin;
        this.onRefreshQr = options.onRefreshQr;
        this.payload = { state: "idle", selfId: options.selfId };
        // 显式注册服务值到 root：确保控制台客户端连接时 Client.refresh() 的
        // 初始拉取（root.get）能找到本服务，store 才有数据。
        ctx.root.set(`console.services.${loginServiceId(options.selfId)}`, this);
        console.log(
            `[napuketto] provider 已注册服务值: console.services.${loginServiceId(options.selfId)}`,
        );
        ctx.logger.info(
            "[napuketto] 控制台登录面板 provider 已创建: serviceId=%s",
            loginServiceId(options.selfId),
        );
        // 指令上行：前端「重新登录」→ bot 层重启登录流程
        ctx.console.addListener(reloginEventName(options.selfId) as keyof Events, () => {
            this.onRelogin?.();
        });
        // 指令上行：前端「刷新二维码」→ bot 层 IPC 直达 refreshQr（不重启子进程）
        ctx.console.addListener(refreshQrEventName(options.selfId) as keyof Events, () => {
            this.onRefreshQr?.();
        });
    }

    /** 更新登录状态并推送（每次全量推送——状态变化不频繁，无需 diff）。 */
    update(next: LoginPanelPayload): void {
        this.ctx.logger.info(
            "[napuketto] 控制台登录面板 update: state=%s selfId=%s",
            next.state,
            next.selfId,
        );
        this.payload = next;
        this.refresh();
    }

    /** DataService 抽象方法：前端 store 请求时返回当前快照。 */
    override async get(): Promise<LoginPanelPayload> {
        // 诊断：控制台客户端连接时 Client.refresh() 会调 get()（PULL 路径）。
        // 若这行不出现 = 服务值未注册 / 客户端没拉取到本服务。
        console.log(
            "[napuketto] get() 被调用（前端拉取）: state=" +
                this.payload.state +
                " qr=" +
                (this.payload.qr !== undefined),
        );
        return this.payload;
    }
}
