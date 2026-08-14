/**
 * driver-events.ts：driver 事件接线工厂（自 bot.ts setupDriver 拆出）。
 *
 * NapukettoBot.setupDriver 里 50 行的 events 回调对象 → buildDriverEvents(host)
 * 工厂函数。依赖通过 host 接口注入（logger/login/bridge/offline 等），
 * bot 的 setupDriver 只剩一行组装——接线逻辑独立可读。
 *
 * 运行时仅依赖类型（DriverEvents 来自 driver/types，logger 是 koishi Logger
 * 接口）——不进单测（HANDOVER §7 坑 1 同源）。
 */
import type { Logger } from "koishi";
import type { DriverEvents } from "../driver/types.js";
import type { NapukettoEventBridge } from "../events/index.js";
import type { NapukettoLoginState } from "../login/index.js";

/** driver events 主机（bot 层提供依赖，避免工厂直接依赖 NapukettoBot 全量）。 */
export interface DriverEventsHost {
    /** 日志对象（bot 的 logger，namespace 已含 napuketto）。 */
    logger: Logger;
    /** 登录状态机（onLogin/onQr/onExit 转发）。 */
    login: Pick<NapukettoLoginState, "onLogin" | "onQr" | "onExit">;
    /** 事件桥（kernel 事件 → koishi session）。 */
    bridge: Pick<NapukettoEventBridge, "handle">;
    /** 是否已主动断开（status === DISCONNECT，onExit 判断是否 offline）。 */
    isDisconnected: () => boolean;
    /** 就绪回调（clientRef 更新 + online + 拉登录信息）。 */
    handleReady: () => void;
    /** 下线回调（driver 崩溃/错误时置 offline）。 */
    offline: (error?: Error) => void;
}

/** 组装 driver 事件回调（bot.setupDriver 注入 DriverEvents）。 */
export function buildDriverEvents(host: DriverEventsHost): DriverEvents {
    return {
        onStatus: (status) => {
            host.logger.debug("[napuketto] 引导阶段: %s", status.phase);
        },
        onLogin: (payload) => {
            host.login.onLogin(payload.state, payload.selfInfo, payload.message);
        },
        onQr: (qr) => host.login.onQr(qr),
        onEvent: (payload) => {
            // 事件桥入口（debug：Group 等高频事件在 info 下不刷屏；
            // 用户配 debug 可见全量事件转发，便于排查）
            host.logger.debug(
                "[napuketto] 收到事件: %s/%s args=%d",
                payload.service,
                payload.name,
                payload.args.length,
            );
            host.bridge.handle(payload);
        },
        onReady: () => {
            host.handleReady();
        },
        onExit: () => {
            host.login.onExit();
            // 非主动停止的退出 → offline（driver 内部会重启；达上限 onError）
            if (!host.isDisconnected()) {
                host.offline();
            }
        },
        onError: (error) => {
            host.logger.warn("[napuketto] 驱动错误: %o", error);
            host.offline(error instanceof Error ? error : new Error(String(error)));
        },
        onLog: (log) => {
            host.logger.debug("[napuketto 子进程] %s", log.message);
        },
    };
}
