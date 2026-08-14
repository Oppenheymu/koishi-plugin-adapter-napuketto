/**
 * codec.ts：IPC 消息编解码（JSON 行协议）。
 *
 * 每行一条 JSON 消息，`\n` 结尾（stdout 收行 / stdin 发行）。
 * 解码宽松：非法行 / 空行 / v 不匹配 / 未知 type → null，调用方记日志跳过，
 * 不崩通道。
 */
import { IpcMessageSchema, type IpcMessage } from "@napuketto/loader";

/** 编码为 JSON 行（追加换行）。 */
export function encodeIpcMessage(message: IpcMessage): string {
    return `${JSON.stringify(message)}\n`;
}

/** 解码一行 JSON；非法行/空行/形状不合法返回 null。 */
export function decodeIpcMessage(line: string): IpcMessage | null {
    const trimmed = line.trim();
    if (trimmed === "") {
        return null;
    }
    try {
        const parsed: unknown = JSON.parse(trimmed);
        const result = IpcMessageSchema.safeParse(parsed);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
}
