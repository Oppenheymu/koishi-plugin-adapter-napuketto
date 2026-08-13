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
        // ⚠️ 必须 immediate: false（2026-08-14 根因修复）：cordis Service 在
        // 'immediate: true' + 直接 new 时走 'expose' 符号路径——该路径只在
        // 'ctx.plugin(ServiceClass)' 时被消费（scope.ts apply 里读 expose 后
        // ctx.set(name, instance)），直接 new 永不消费 → 从不调用 ctx.set →
        // ctx.get('console.services.napuketto-login-<uin>') 恒 undefined →
        // 控制台客户端连接时的初始拉取（Client.refresh() 遍历 root internal +
        // ctx.get）找不到本服务 → store 永远拿不到数据（二维码不渲染）。
        // immediate: false 则 ready 后走 if (!immediate) ctx.set(name, self)
        // 路径，服务值正常注册（bilibili-dm 的 BilibiliLauncher 同款 immediate:
        // true 实则存在同一隐患，但它靠用户点按钮触发 PUSH 掩盖了）。
        super(ctx, loginServiceId(options.selfId) as keyof Console.Services, {
            immediate: false,
        });
        this.onRelogin = options.onRelogin;
        this.onRefreshQr = options.onRefreshQr;
        this.payload = { state: "idle", selfId: options.selfId };
        // 显式注册服务值（不依赖 ready 事件）：确保控制台客户端连接时
        // Client.refresh() 的初始拉取（root.get）能找到本服务，store 才有数据。
        ctx.set(`console.services.${loginServiceId(options.selfId)}`, this);
        console.log(
            "[napuketto] provider 已注册服务值: console.services." + loginServiceId(options.selfId),
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
