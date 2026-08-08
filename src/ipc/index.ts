/**
 * index.ts：IPC 协议层出口（barrel）。
 */

export {
    DEFAULT_REQUEST_TIMEOUT_MS,
    type IpcClientOptions,
    NapukettoIpcClient,
} from "./client.js";
export { decodeIpcMessage, encodeIpcMessage } from "./codec.js";
export { IpcError } from "./errors.js";
export {
    ChildProcessIpcTransport,
    type IpcLineTransport,
} from "./transport.js";
export {
    IPC_MESSAGE_TYPES,
    IPC_VERSION,
    type IpcActionMessage,
    type IpcActionPayload,
    type IpcBootPhase,
    type IpcControlMessage,
    type IpcControlPayload,
    type IpcEventMessage,
    type IpcEventPayload,
    type IpcLoginMessage,
    type IpcLoginPayload,
    type IpcLogLevel,
    type IpcLogMessage,
    type IpcLogPayload,
    type IpcMessage,
    type IpcPingMessage,
    type IpcPongMessage,
    type IpcQrMessage,
    type IpcResultMessage,
    type IpcResultPayload,
    type IpcStatusMessage,
    type IpcStatusPayload,
} from "./types.js";
