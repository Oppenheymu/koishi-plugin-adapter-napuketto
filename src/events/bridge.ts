/**
 * bridge.ts：NapukettoEventBridge——kernel 事件 → koishi session（design.md §5.9）。
 *
 * 订阅 driver.onEvent（kernel 事件 { service, name, args }）→ 翻译 → dispatch。
 * 本轮实现消息事件（Msg/onRecvMsg，args 为 RawMessage[] 运行时实证）——
 * 群通知/请求类（notice/request 系列）后续轮次。
 */
import type { RawMessage } from "@napuketto/kernel";
import { adaptRawMessage } from "./adapt.js";
import type { EventBridge, EventBridgeOptions } from "./types.js";

/** 消息事件名。 */
const MSG_RECV_EVENT = "onRecvMsg";

/** 消息事件桥（driver 事件源 → koishi dispatch）。 */
export class NapukettoEventBridge implements EventBridge {
    private readonly options: EventBridgeOptions;

    constructor(options: EventBridgeOptions) {
        this.options = options;
    }

    /** 处理一条 kernel 事件（apply() 层作为 DriverEvents.onEvent 注入）。 */
    handle(payload: { service: string; name: string; args: unknown[] }): void {
        if (payload.service !== "Msg" || payload.name !== MSG_RECV_EVENT) {
            return; // 本轮只处理消息事件
        }
        // onRecvMsg args[0] 为 RawMessage[]（批量推送，运行时实证）
        const messages = payload.args[0];
        const list = Array.isArray(messages) ? messages : [messages];
        for (const msg of list) {
            if (!msg || typeof msg !== "object") {
                continue;
            }
            this.dispatchMessage(msg as RawMessage);
        }
    }

    /** 单条 RawMessage → session → dispatch。 */
    private dispatchMessage(msg: RawMessage): void {
        const session = adaptRawMessage(msg, {
            selfId: this.options.selfId(),
            platform: this.options.platform ?? "napuketto",
            h: this.options.h,
        });
        this.options.dispatch(session);
    }
}
