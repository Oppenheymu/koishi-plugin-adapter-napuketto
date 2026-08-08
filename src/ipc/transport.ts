/**
 * transport.ts：JSON 行传输抽象。
 *
 * 真实实现包装 ChildProcess stdio（stdout readline 收行 + stdin 发行）；
 * 测试注入内存双端（MemoryLinePair，见 index.test.ts）。
 */
import type { ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { KernelError } from "@napuketto/kernel";

/** JSON 行传输接口。 */
export interface IpcLineTransport {
    /** 发送一行（编码后的完整消息，含换行）。 */
    write(line: string): void;
    /** 订阅收到的行。返回退订函数。 */
    onLine(callback: (line: string) => void): () => void;
    /** 订阅通道关闭。返回退订函数。 */
    onClose(callback: () => void): () => void;
    /** 关闭通道（幂等）。 */
    close(): void;
}

/** 基于 ChildProcess stdio 的传输：stdout 收行（readline），stdin 发行。 */
export class ChildProcessIpcTransport implements IpcLineTransport {
    private readonly lineHandlers = new Set<(line: string) => void>();
    private readonly closeHandlers = new Set<() => void>();
    private readonly readline: Interface;
    private closed = false;

    constructor(private readonly child: ChildProcess) {
        if (child.stdout === null || child.stdin === null) {
            throw new KernelError("子进程 stdio 未启用（需要 stdout/stdin pipe）", "INVALID_STATE");
        }
        this.readline = createInterface({ input: child.stdout, crlfDelay: Infinity });
        this.readline.on("line", (line) => {
            for (const handler of [...this.lineHandlers]) {
                handler(line);
            }
        });
        // 子进程退出（正常/崩溃）→ 通知 onClose 订阅者
        child.once("close", () => {
            this.close();
        });
    }

    write(line: string): void {
        if (this.closed) {
            return;
        }
        const stdin = this.child.stdin;
        if (stdin !== null) {
            stdin.write(line);
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
        this.readline.close();
        for (const handler of [...this.closeHandlers]) {
            handler();
        }
        this.lineHandlers.clear();
        this.closeHandlers.clear();
    }
}
