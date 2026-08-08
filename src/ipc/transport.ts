/**
 * transport.ts：JSON 行传输抽象。
 *
 * 真实实现包装 ChildProcess stdio（stdout readline 收行 + stdin 发行）；
 * 测试注入内存双端（MemoryLinePair，见 index.test.ts）。
 */
import type { ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { KernelError } from "@napuketto/kernel";
import { SubscriberSet } from "./subscribers.js";

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

/**
 * 行传输抽象基类：订阅管理（onLine/onClose/close）与 closed 状态共享。
 * 子类只实现 write 与数据源接线（dispatchLine/onClosed 钩子）。
 */
export abstract class BaseLineTransport implements IpcLineTransport {
    protected readonly lineHandlers = new SubscriberSet<[line: string]>();
    protected readonly closeHandlers = new SubscriberSet<[]>();
    protected closed = false;

    /** 发送一行。 */
    abstract write(line: string): void;

    /** 收到一行并分发（子类在数据源回调中调用；closed 后忽略）。 */
    protected dispatchLine(line: string): void {
        if (!this.closed) {
            this.lineHandlers.dispatch(line);
        }
    }

    onLine(callback: (line: string) => void): () => void {
        return this.lineHandlers.add(callback);
    }

    onClose(callback: () => void): () => void {
        return this.closeHandlers.add(callback);
    }

    close(): void {
        if (this.closed) {
            return;
        }
        this.closed = true;
        this.onClosed();
        this.closeHandlers.dispatch();
        this.lineHandlers.clear();
        this.closeHandlers.clear();
    }

    /** 子类钩子：关闭时的资源清理（默认无操作）。 */
    protected onClosed(): void {}
}

/** 基于 ChildProcess stdio 的传输：stdout 收行（readline），stdin 发行。 */
export class ChildProcessIpcTransport extends BaseLineTransport {
    private readonly readline: Interface;

    constructor(private readonly child: ChildProcess) {
        super();
        if (child.stdout === null || child.stdin === null) {
            throw new KernelError("子进程 stdio 未启用（需要 stdout/stdin pipe）", "INVALID_STATE");
        }
        this.readline = createInterface({ input: child.stdout, crlfDelay: Infinity });
        this.readline.on("line", (line) => {
            this.dispatchLine(line);
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

    protected override onClosed(): void {
        this.readline.close();
    }
}
