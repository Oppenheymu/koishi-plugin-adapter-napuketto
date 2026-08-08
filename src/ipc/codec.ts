/**
 * codec.ts：IPC 消息编解码（JSON 行协议）。
 *
 * 每行一条 JSON 消息，`\n` 结尾（stdout 收行 / stdin 发行）。
 * 解码宽松：非法行 / 空行 / v 不匹配 / 未知 type → null，调用方记日志跳过，
 * 不崩通道。
 */
import { IPC_MESSAGE_TYPES, type IpcMessage } from "./types.js";

/** 编码为 JSON 行（追加换行）。 */
export function encodeIpcMessage(message: IpcMessage): string {
    return `${JSON.stringify(message)}\n`;
}

/** 类型守卫：v 匹配 + type 合法。 */
function isIpcMessage(value: unknown): value is IpcMessage {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        record["v"] === 1 &&
        typeof record["type"] === "string" &&
        IPC_MESSAGE_TYPES.has(record["type"])
    );
}

/** 解码一行 JSON；非法行/空行返回 null。 */
export function decodeIpcMessage(line: string): IpcMessage | null {
    const trimmed = line.trim();
    if (trimmed === "") {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(trimmed);
        return isIpcMessage(parsed) ? parsed : null;
    } catch {
        return null;
    }
}
