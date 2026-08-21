/**
 * types.ts：事件桥类型（design.md §5.9）。
 *
 * 事件桥做 kernel 事件 → koishi session 翻译。koishi Session 构造由
 * Bot.session(event) 完成（apply() 层注入 dispatch 回调），本层只产字段。
 */
import type { IpcEventPayload } from "../ipc/index.js";
import type { HFn } from "./elements.js";

/** koishi session 字段（宽松构造面——Bot.session(event) 接受的 Partial<Event>）。 */
export interface NapukettoSessionFields {
    type: string;
    /** 消息子类型（onebot 同构：群聊 group / 私聊 private；临时会话归 private）。 */
    subtype?: string;
    selfId: string;
    platform: string;
    timestamp: number;
    userId?: string;
    channelId?: string;
    guildId?: string;
    messageId?: string;
    /** 是否私聊（私聊/临时会话 true；驱动 event.channel.type = DIRECT/TEXT）。 */
    isDirect?: boolean;
    /** koishi 元素数组（h[]，经 Element.toElementArray 可解析）。 */
    elements?: unknown[];
    content?: string;
}

/** 事件桥选项（apply() 层注入）。 */
export interface EventBridgeOptions {
    /** dispatch 回调（koishi Bot.dispatch(session)）。 */
    dispatch: (session: NapukettoSessionFields) => void;
    /** 登录账号 uin（selfId）。 */
    selfId: () => string;
    /** koishi h() 工厂（apply() 层传 bindKoishiH(h)）。 */
    h: HFn;
    /** 平台名（默认 "onebot"）。 */
    platform?: string;
}

/** 事件桥（driver 事件源 → dispatch）。 */
export interface EventBridge {
    /** 处理一条 kernel 事件（apply() 层作为 DriverEvents.onEvent 注入）。 */
    handle(payload: IpcEventPayload): void;
}
