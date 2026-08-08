/**
 * test-utils.ts：IPC 层测试共享设施。
 * MemoryLinePair（内存双端传输）+ captureAction（捕获对端发出的 action 请求）。
 */
import { decodeIpcMessage, type IpcLineTransport, type IpcMessage } from "./index.js";

/** 内存双端传输：一端 write → 对端（peer）lineHandlers 立即收到。 */
export class MemoryLinePair implements IpcLineTransport {
    readonly peer: MemoryLinePair;
    private readonly lineHandlers = new Set<(line: string) => void>();
    private readonly closeHandlers = new Set<() => void>();
    private closed = false;

    constructor(peer?: MemoryLinePair) {
        // 构造时互指：new MemoryLinePair() 自动成对
        this.peer = peer ?? new MemoryLinePair(this);
    }

    /** 写入对端（管道语义：write 进一端 = 对端收到）。 */
    write(line: string): void {
        this.peer.receive(line);
    }

    /** 从对端收到一行。 */
    private receive(line: string): void {
        if (this.closed) {
            return;
        }
        for (const handler of [...this.lineHandlers]) {
            handler(line);
        }
    }

    onLine(callback: (line: string) => void): () => void {
        this.lineHandlers.add(callback);
        return () => {
            this.lineHandlers.delete(callback);
        };
    }

    onClose(callback: () => void): () => void {
        this.closeHandlers.add(callback);
        return () => {
            this.closeHandlers.delete(callback);
        };
    }

    close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        for (const handler of [...this.closeHandlers]) {
            handler();
        }
        this.lineHandlers.clear();
        this.closeHandlers.clear();
    }
}

/** 捕获对端发出的第一个 action 请求（先注册再发请求，不泄漏订阅）。 */
export async function captureAction(
    pair: MemoryLinePair,
): Promise<Extract<IpcMessage, { type: "action" }> | null> {
    let captured: Extract<IpcMessage, { type: "action" }> | null = null;
    pair.peer.onLine((line) => {
        const msg = decodeIpcMessage(line);
        if (msg?.type === "action" && captured === null) {
            captured = msg;
        }
    });
    await Promise.resolve(); // 让已同步发出的消息被处理
    return captured;
}
