/**
 * index.ts：IPC 协议层出口（barrel）。
 *
 * 只 re-export 有内部消费者的符号（driver/events/bot 层）；其余类型
 * 由消费方直接从 types.js import（barrel 保持最小面，fallow 无死导出）。
 */
export { NapukettoIpcClient } from "./client.js";
export { decodeIpcMessage, encodeIpcMessage } from "./codec.js";
export { ChildProcessIpcTransport, type IpcLineTransport } from "./transport.js";
export {
    IPC_VERSION,
    type IpcEventPayload,
    type IpcLoginPayload,
    type IpcLogPayload,
    type IpcMessage,
    type IpcStatusPayload,
} from "./types.js";
