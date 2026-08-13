/**
 * types.ts：IPC 协议消息类型（判别联合）。
 *
 * 协议契约（design.md §5.6）：`{ v, type, id?, payload }`。
 * 这些类型同样供 loader 侧 self-host 改造（§7）作为协议契约复用。
 */
import type { LoginState, QrCodeData, SelfInfo } from "@napuketto/kernel";

/** IPC 协议版本（解码校验）。 */
export const IPC_VERSION = 1;

/** 引导阶段（status 消息）。 */
export type IpcBootPhase =
    | "booting" // 子进程已启动（spawn 成功）
    | "dlopening" // dlopen wrapper.node
    | "logging" // 登录流程进行中
    | "sessioning" // session 初始化中
    | "ready" // session READY + 协议装配完成
    | "failed"; // 引导失败（携带错误）

/** 结构化日志级别（pino level）。 */
export type IpcLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

/** status 消息 payload。 */
export interface IpcStatusPayload {
    phase: IpcBootPhase;
    message?: string;
    error?: { code: string; message: string };
}

/** login 消息 payload。 */
export interface IpcLoginPayload {
    state: LoginState;
    selfInfo?: SelfInfo;
    /** 失败原因（state=failed 时；如「登录超时，请刷新页面重试」）。 */
    message?: string;
}

/** event 消息 payload（kernel 事件通道形状，翻译层按 service/name 断言具体类型）。 */
export interface IpcEventPayload {
    service: string;
    name: string;
    args: unknown[];
}

/** log 消息 payload。 */
export interface IpcLogPayload {
    level: IpcLogLevel;
    message: string;
}

/** 动作响应 payload（result 消息）。 */
export type IpcResultPayload =
    | { ok: true; value?: unknown }
    | { ok: false; error: { code: string; message: string } };

/** 动作请求 payload（action 消息）。 */
export interface IpcActionPayload {
    action: string;
    params?: Record<string, unknown>;
}

/** 控制指令 payload（control 消息，父→子）。 */
export type IpcControlPayload =
    | { command: "stop" } // 优雅退出
    | { command: "restart" } // 重启（driver 处理）
    | { command: "login"; uin?: string; qr?: boolean }; // 触发登录（重连后）

// ── 消息联合 ──

export interface IpcStatusMessage {
    v: typeof IPC_VERSION;
    type: "status";
    payload: IpcStatusPayload;
}

export interface IpcLoginMessage {
    v: typeof IPC_VERSION;
    type: "login";
    payload: IpcLoginPayload;
}

export interface IpcQrMessage {
    v: typeof IPC_VERSION;
    type: "qr";
    payload: QrCodeData;
}

export interface IpcEventMessage {
    v: typeof IPC_VERSION;
    type: "event";
    payload: IpcEventPayload;
}

export interface IpcResultMessage {
    v: typeof IPC_VERSION;
    type: "result";
    id: number;
    payload: IpcResultPayload;
}

export interface IpcLogMessage {
    v: typeof IPC_VERSION;
    type: "log";
    payload: IpcLogPayload;
}

export interface IpcPingMessage {
    v: typeof IPC_VERSION;
    type: "ping";
}

export interface IpcPongMessage {
    v: typeof IPC_VERSION;
    type: "pong";
}

export interface IpcActionMessage {
    v: typeof IPC_VERSION;
    type: "action";
    id: number;
    payload: IpcActionPayload;
}

export interface IpcControlMessage {
    v: typeof IPC_VERSION;
    type: "control";
    payload: IpcControlPayload;
}

/** IPC 消息判别联合（协议边界，运行时数据宽类型）。 */
export type IpcMessage =
    | IpcStatusMessage
    | IpcLoginMessage
    | IpcQrMessage
    | IpcEventMessage
    | IpcResultMessage
    | IpcLogMessage
    | IpcPingMessage
    | IpcPongMessage
    | IpcActionMessage
    | IpcControlMessage;

/** 消息类型集合（解码校验用）。 */
export const IPC_MESSAGE_TYPES = new Set<string>([
    "status",
    "login",
    "qr",
    "event",
    "result",
    "log",
    "ping",
    "pong",
    "action",
    "control",
]);
