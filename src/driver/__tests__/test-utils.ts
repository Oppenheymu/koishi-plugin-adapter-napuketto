/**
 * test-utils.ts：driver 层测试共享设施。
 * FakeChild（可触发 exit）+ createHarness（driver + spawns/peers 记录）。
 */
import { Writable } from "node:stream";
import {
    encodeIpcMessage,
    IPC_VERSION,
    type IpcMessage,
    type IpcStatusPayload,
} from "../../ipc/index.js";
import { MemoryLinePair } from "../../ipc/test-utils.js";
import { NapukettoDriver } from "../driver.js";
import type { ChildProcessLike, DriverEvents } from "../types.js";

/** 假子进程：可手动触发 exit。 */
export class FakeChild implements ChildProcessLike {
    readonly stdout: NodeJS.ReadableStream = new Writable({
        write(_c, _e, cb) {
            cb();
        },
    }) as unknown as NodeJS.ReadableStream;
    readonly stdin: NodeJS.WritableStream = new Writable({
        write(_c, _e, cb) {
            cb();
        },
    });
    private readonly exitListeners: Array<(code: number | null, signal: string | null) => void> =
        [];
    killed = false;
    pid = 9999;

    once(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown {
        if (event === "exit") {
            this.exitListeners.push(listener);
        }
        return this;
    }

    kill(_signal?: NodeJS.Signals | number): boolean {
        this.killed = true;
        return true;
    }

    /** 触发子进程退出（模拟崩溃/正常退出）。 */
    emitExit(code: number | null, signal: string | null): void {
        for (const listener of [...this.exitListeners]) {
            listener(code, signal);
        }
    }
}

/** 测试夹具：driver + 每次 spawn 的 child/pair 记录。 */
export interface DriverHarness {
    driver: NapukettoDriver;
    spawns: FakeChild[];
    peers: MemoryLinePair[];
    /** 模拟子进程发 status 消息（发给最近一次 spawn 的 client）。 */
    emit: (phase: IpcStatusPayload["phase"], message?: string) => void;
}

/** 创建夹具（restart 默认 maxRetries=3 / backoffMs=100 / factor=2）。 */
export function createHarness(
    events: DriverEvents = {},
    options: { restart?: { maxRetries?: number; backoffMs?: number; backoffFactor?: number } } = {},
): DriverHarness {
    const spawns: FakeChild[] = [];
    const peers: MemoryLinePair[] = [];
    const driver = new NapukettoDriver({
        launch: () => {
            const child = new FakeChild();
            spawns.push(child);
            return { child };
        },
        createTransport: () => {
            const pair = new MemoryLinePair();
            peers.push(pair);
            return pair;
        },
        events,
        restart: { maxRetries: 3, backoffMs: 100, backoffFactor: 2, ...options.restart },
        heartbeatTimeoutMs: 45_000,
    });
    return {
        driver,
        spawns,
        peers,
        emit: (phase, message) => {
            const pair = peers.at(-1);
            if (pair === undefined) {
                throw new Error("尚无 spawn");
            }
            const msg: IpcMessage = {
                v: IPC_VERSION,
                type: "status",
                payload: message !== undefined ? { phase, message } : { phase },
            };
            pair.peer.write(encodeIpcMessage(msg));
        },
    };
}

/** 等待 driver 状态切换（同步 tick + 微任务）。 */
export async function flush(): Promise<void> {
    await Promise.resolve();
}
