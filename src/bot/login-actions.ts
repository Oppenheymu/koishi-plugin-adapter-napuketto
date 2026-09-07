/**
 * login-actions.ts：重新登录/强制扫码的动作决策（纯函数，2026-09-08 T2）。
 *
 * 两条可用通道：
 *  - control login（原地，不重启子进程）：仅登录期有效——loader 端成功结果
 *    抢占初始登录竞速（bootstrap-core LoginPreemptRef）；ready 态子进程的
 *    服务绑定旧 session，原地重登会造成状态断裂，不可用。
 *  - control restart（整进程重启）：任何状态可靠；配合一次性 NAPUTO_QR_ONLY
 *    标记可在重启后直接扫码（qrOnly 由 launch 消费，见 launch.ts）。
 *
 * 决策表（clientReady = IPC client 可用）：
 *  - 登录期（idle/waiting_scan/scanned）+ client 可用 → control login
 *    （qrOnly=true 时 qr:true 强制扫码）
 *  - 其余（logged_in/failed/client 不可用）→ restart（qrOnly 时带 forceQr
 *    一次性标记，重启后子进程直接出码）
 */

import type { LoginState } from "@napuketto/kernel";

/** 登录期状态（子进程登录流程进行中，control login 可原地接管）。 */
const LOGIN_PHASE_STATES: ReadonlySet<string> = new Set(["idle", "waiting_scan", "scanned"]);

/** 重新登录/扫码登录计划。 */
export type ReloginPlan =
    | { kind: "control-login"; uin: string; qr: boolean }
    | { kind: "restart"; forceQr: boolean };

/** 决策入参。 */
export interface ReloginPlanInput {
    /** 当前登录状态快照。 */
    state: LoginState;
    /** 登录账号（quickUin 透传给 control login）。 */
    uin: string;
    /** IPC client 是否可用（control 指令可达子进程）。 */
    clientReady: boolean;
    /** 是否强制扫码（false = 普通重新登录）。 */
    qrOnly: boolean;
}

/** 决策重新登录/强制扫码走哪条通道（纯函数）。 */
export function planRelogin(input: ReloginPlanInput): ReloginPlan {
    if (LOGIN_PHASE_STATES.has(input.state) && input.clientReady) {
        return { kind: "control-login", uin: input.uin, qr: input.qrOnly };
    }
    return { kind: "restart", forceQr: input.qrOnly };
}

/** 计划执行器（login-panel 传入 IPC 能力；单测 mock 验证指令发出）。 */
export interface ReloginExecutor {
    /** 发送 IPC 控制指令（client 未就绪返回 false）。 */
    sendControl: (payload: { command: "login" | "restart"; uin?: string; qr?: boolean }) => boolean;
    /** 强制扫码重启（置 qrOnly 标记 + control restart；client 未就绪返回 false）。 */
    forceQrRestart: () => boolean;
    /** 日志（info/warn 最小面）。 */
    logger: { info(message: string): void; warn(message: string): void };
}

/** 执行计划：按 kind 发对应指令（control-login 失败回落 restart）。 */
export function executeRelogin(plan: ReloginPlan, exec: ReloginExecutor): void {
    if (plan.kind === "control-login") {
        if (exec.sendControl({ command: "login", uin: plan.uin, qr: plan.qr })) {
            exec.logger.info(
                plan.qr
                    ? "[napuketto] 控制台请求强制扫码（control login qr）"
                    : "[napuketto] 控制台请求重新登录（control login 原地重登）",
            );
            return;
        }
        // client 不可用回落整进程重启路径
    }
    if (plan.kind === "restart" && plan.forceQr) {
        if (exec.forceQrRestart()) {
            exec.logger.info("[napuketto] 控制台请求强制扫码（qrOnly 标记 + 重启子进程）");
            return;
        }
        exec.logger.warn("[napuketto] 子进程未就绪，已置扫码标记（等待驱动重启后生效）");
        return;
    }
    if (exec.sendControl({ command: "restart" })) {
        exec.logger.info("[napuketto] 控制台请求重新登录（重启子进程）");
    } else {
        exec.logger.warn("[napuketto] 子进程未就绪，无法重新登录");
    }
}
