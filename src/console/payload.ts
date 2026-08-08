/**
 * payload.ts：LoginSnapshot → LoginPanelPayload 纯函数映射（design.md §5.12）。
 *
 * 独立成纯函数（不 import koishi 运行时）→ 可单测（HANDOVER §7 坑 1）。
 */
import type { LoginState } from "@napuketto/kernel";
import type { LoginSnapshot } from "../login/types.js";
import type { LoginPanelPayload } from "./types.js";

/** 登录状态 → 面板人类可读文案。 */
export function loginStateMessage(state: LoginState): string {
    switch (state) {
        case "idle":
            return "未登录（等待子进程就绪）";
        case "waiting_scan":
            return "请使用手机 QQ 扫描二维码";
        case "scanned":
            return "已扫码，请在手机上确认登录";
        case "logged_in":
            return "登录成功";
        case "failed":
            return "登录失败";
    }
}

/** LoginSnapshot → LoginPanelPayload（exactOptionalPropertyTypes：条件展开，不显式赋 undefined）。 */
export function toLoginPanelPayload(snapshot: LoginSnapshot, selfId: string): LoginPanelPayload {
    return {
        state: snapshot.state,
        selfId,
        message: loginStateMessage(snapshot.state),
        ...(snapshot.qr !== undefined ? { qr: snapshot.qr } : {}),
        ...(snapshot.self !== undefined ? { self: snapshot.self } : {}),
        ...(snapshot.lastError !== undefined ? { lastError: snapshot.lastError } : {}),
    };
}
