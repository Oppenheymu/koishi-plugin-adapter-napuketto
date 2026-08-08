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
    }
}

/** serviceId 前缀（多账号隔离：napuketto-login-<uin>）。 */
export const LOGIN_SERVICE_PREFIX = "napuketto-login";

/** 重新登录 console 事件名后缀。 */
export const RELOGIN_EVENT_SUFFIX = "relogin";

/** store 键 / serviceId。 */
export function loginServiceId(selfId: string): string {
    return `${LOGIN_SERVICE_PREFIX}-${selfId}`;
}

/** 重新登录事件名（前端 send / 后端 addListener 用）。 */
export function reloginEventName(selfId: string): string {
    return `${loginServiceId(selfId)}/${RELOGIN_EVENT_SUFFIX}`;
}

/** provider 选项。 */
export interface LoginPanelOptions {
    /** 登录账号（QQ 号）。 */
    selfId: string;
    /** 前端点「重新登录」回调（bot 层发 IPC control restart）。 */
    onRelogin?: () => void;
}

/** 控制台登录面板数据服务（DataService 下行 + relogin 指令上行）。 */
export class NapukettoLoginProvider extends DataService<LoginPanelPayload> {
    private payload: LoginPanelPayload;
    private readonly onRelogin: (() => void) | undefined;

    constructor(ctx: Context, options: LoginPanelOptions) {
        super(ctx, loginServiceId(options.selfId) as keyof Console.Services, {
            immediate: true,
        });
        this.onRelogin = options.onRelogin;
        this.payload = { state: "idle", selfId: options.selfId };
        // 指令上行：前端「重新登录」→ bot 层重启登录流程
        ctx.console.addListener(reloginEventName(options.selfId) as keyof Events, () => {
            this.onRelogin?.();
        });
    }

    /** 更新登录状态并推送（每次全量推送——状态变化不频繁，无需 diff）。 */
    update(next: LoginPanelPayload): void {
        this.payload = next;
        this.refresh();
    }

    /** DataService 抽象方法：前端 store 请求时返回当前快照。 */
    override async get(): Promise<LoginPanelPayload> {
        return this.payload;
    }
}
