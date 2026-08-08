/**
 * driver.ts：NapukettoDriver——自建宿主子进程生命周期驱动（design.md §5.7）。
 *
 * 职责：spawn（launch 工厂注入）→ IPC client → 状态机 → 崩溃/失联重启（退避）。
 * 不 import loader：launch 由 apply() 用 launchSelfHost 组装注入。
 *
 * 心跳监控：spawn 后立即开始（兜 dlopen/登录卡死挂起），client.seenAt 超过
 * heartbeatTimeoutMs 判定失联 → kill + 重启。
 */
import type { ChildProcess } from "node:child_process";
import {
    ChildProcessIpcTransport,
    type IpcLineTransport,
    NapukettoIpcClient,
} from "../ipc/index.js";
import { backoffDelay } from "./backoff.js";
import type {
    ChildProcessLike,
    DriverEvents,
    DriverLauncher,
    DriverOptions,
    DriverState,
    ExitReason,
    RestartPolicy,
    TransportFactory,
} from "./types.js";

/** 心跳检查间隔（毫秒）。 */
const HEALTH_CHECK_INTERVAL_MS = 1_000;

/** 优雅退出等待超时（毫秒）。 */
const STOP_TIMEOUT_MS = 5_000;

/** 默认重启策略。 */
const DEFAULT_RESTART: Required<RestartPolicy> = {
    maxRetries: 3,
    backoffMs: 1_000,
    backoffFactor: 2,
};

/** 默认传输工厂（ChildProcessIpcTransport，断言收窄宽松 child 面）。 */
const defaultTransport: TransportFactory = (child) => {
    return new ChildProcessIpcTransport(child as ChildProcess);
};

/** 子进程生命周期驱动。 */
export class NapukettoDriver {
    private readonly events: DriverEvents;
    private readonly launch: DriverLauncher;
    private readonly createTransport: TransportFactory;
    private readonly restart: Required<RestartPolicy>;
    private readonly heartbeatTimeoutMs: number;

    private state: DriverState = "idle";
    private client: NapukettoIpcClient | null = null;
    private child: ChildProcessLike | null = null;
    private restartCount = 0;
    private stopping = false;
    private spawnAt = 0;
    private healthTimer: NodeJS.Timeout | null = null;
    private restartTimer: NodeJS.Timeout | null = null;
    private stopTimer: NodeJS.Timeout | null = null;

    constructor(options: DriverOptions) {
        this.events = options.events;
        this.launch = options.launch;
        this.createTransport = options.createTransport ?? defaultTransport;
        this.restart = {
            maxRetries: options.restart?.maxRetries ?? DEFAULT_RESTART.maxRetries,
            backoffMs: options.restart?.backoffMs ?? DEFAULT_RESTART.backoffMs,
            backoffFactor: options.restart?.backoffFactor ?? DEFAULT_RESTART.backoffFactor,
        };
        this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 45_000;
    }

    /** 当前状态。 */
    get currentState(): DriverState {
        return this.state;
    }

    /** 当前 IPC 客户端（重启后实例会换；ready 时经 onReady 重新获取）。 */
    get currentClient(): NapukettoIpcClient | null {
        return this.client;
    }

    /** 已重启次数（诊断用）。 */
    get restartAttempts(): number {
        return this.restartCount;
    }

    /** 启动子进程（幂等：非 idle 直接忽略）。 */
    start(): void {
        if (this.state !== "idle") {
            return;
        }
        this.spawnProcess("start");
    }

    /** 主动停止：发 control stop → 等退出（5s）→ kill。不再重启。 */
    stop(): void {
        if (this.state === "idle" || this.state === "stopped" || this.state === "stopping") {
            return;
        }
        this.stopping = true;
        this.setState("stopping");
        this.clearRestartTimer();
        this.clearHealthTimer();

        const current = this.client;
        if (current === null) {
            this.finishStop();
            return;
        }
        if (current.alive) {
            current.sendControl({ command: "stop" });
        }
        // 等待子进程退出；超时强杀
        this.stopTimer = setTimeout(() => {
            this.killChild();
            this.finishStop();
        }, STOP_TIMEOUT_MS);
    }

    // ── 内部 ──

    private spawnProcess(reason: "start" | "restart"): void {
        this.setState(reason === "start" ? "spawning" : "restarting");
        let result: ReturnType<DriverLauncher>;
        try {
            result = this.launch();
        } catch (err) {
            this.handleSpawnError(err);
            return;
        }
        const { child, cleanup } = result;
        this.child = child;
        // 子进程退出（崩溃/正常/被 kill）→ 统一处理（stop 流程除外）
        child.once("exit", (code, signal) => {
            this.handleChildExit(code, signal, "crash");
        });

        // 每次 spawn 建新 transport + 新 client（旧 client 随旧子进程 closed）
        let transport: IpcLineTransport;
        try {
            transport = this.createTransport(child);
        } catch (err) {
            cleanup?.();
            this.handleSpawnError(err);
            return;
        }
        const client = new NapukettoIpcClient(transport);
        this.client = client;
        this.subscribeClient(client);

        this.spawnAt = Date.now();
        this.setState("booting");
        this.startHealthCheck();
    }

    private subscribeClient(client: NapukettoIpcClient): void {
        client.on("status", (message) => {
            this.handleStatus(message.payload);
            this.events.onStatus?.(message.payload);
        });
        client.on("login", (message) => {
            this.events.onLogin?.(message.payload);
        });
        client.on("qr", (message) => {
            this.events.onQr?.(message.payload);
        });
        client.on("event", (message) => {
            this.events.onEvent?.(message.payload);
        });
        client.on("log", (message) => {
            this.events.onLog?.(message.payload);
        });
    }

    private handleStatus(status: { phase: string; message?: string; error?: unknown }): void {
        switch (status.phase) {
            case "ready":
                if (this.state !== "stopping" && this.state !== "stopped") {
                    this.restartCount = 0; // 就绪即健康，重置重启计数
                    this.setState("ready");
                    this.events.onReady?.();
                }
                break;
            case "failed":
                this.events.onError?.(new Error(status.message ?? "子进程引导失败"));
                break;
            default:
                // booting/dlopening/logging/sessioning：状态机保持 booting
                break;
        }
    }

    private handleChildExit(code: number | null, signal: string | null, reason: ExitReason): void {
        this.events.onExit?.({ code, signal, reason });

        if (this.stopping) {
            this.finishStop();
            return;
        }
        // 崩溃/失联 → 按策略重启
        if (this.restartCount >= this.restart.maxRetries) {
            this.setState("failed");
            this.events.onError?.(new Error(`子进程退出（code=${code ?? "?"}），重启次数达上限`));
            return;
        }
        this.scheduleRestart();
    }

    private handleSpawnError(err: unknown): void {
        this.events.onExit?.({ code: null, signal: null, reason: "spawn-error" });
        this.events.onError?.(err);
        if (this.stopping) {
            this.finishStop();
        } else {
            this.setState("failed");
        }
    }

    private scheduleRestart(): void {
        const attempt = this.restartCount + 1;
        const delay = backoffDelay(attempt, this.restart.backoffMs, this.restart.backoffFactor);
        this.setState("restarting");
        this.restartTimer = setTimeout(() => {
            this.restartCount = attempt;
            this.spawnProcess("restart");
        }, delay);
    }

    private startHealthCheck(): void {
        this.clearHealthTimer();
        this.healthTimer = setInterval(() => {
            if (this.stopping || this.state === "failed" || this.state === "restarting") {
                return;
            }
            const client = this.client;
            if (client === null) {
                return;
            }
            // 距最后一条消息超时 → 判定失联（兜 dlopen/登录卡死：
            // 从未收到消息时用 spawn 时间兜底，spawn 后无任何消息同样判失联）
            const lastSeen = client.seenAt;
            const reference = lastSeen > 0 ? lastSeen : this.spawnAt;
            if (reference > 0 && Date.now() - reference > this.heartbeatTimeoutMs) {
                this.killChild();
                this.handleChildExit(null, "SIGKILL", "stale");
            }
        }, HEALTH_CHECK_INTERVAL_MS);
    }

    private killChild(): void {
        const child = this.child;
        if (child !== null) {
            child.kill();
        }
    }

    private clearHealthTimer(): void {
        if (this.healthTimer !== null) {
            clearInterval(this.healthTimer);
            this.healthTimer = null;
        }
    }

    private clearRestartTimer(): void {
        if (this.restartTimer !== null) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
    }

    private finishStop(): void {
        this.stopping = false;
        if (this.stopTimer !== null) {
            clearTimeout(this.stopTimer);
            this.stopTimer = null;
        }
        this.client?.close();
        this.client = null;
        this.child = null;
        this.setState("stopped");
    }

    private setState(next: DriverState): void {
        this.state = next;
    }
}
