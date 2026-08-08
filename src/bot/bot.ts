/**
 * bot.ts：NapukettoBot——koishi Bot 子类（design.md §5.11，端到端验证点）。
 *
 * 装配方式：不写 Adapter（fork/connect 为 HTTP/WS 网络服务设计）。koishi Bot
 * 构造自动注册 `ctx.on('ready', () => this.start())`——override start() spawn
 * driver（进程编排），stop() 停 driver。
 *
 * 链路：driver（子进程生命周期）→ IPC client → 事件桥（kernel 事件 → koishi
 * session，dispatch）+ 动作桥（NapukettoInternal，koishi 动作 → IPC action）。
 *
 * 运行时 import koishi（Bot/Universal 等）——本文件不进单测（HANDOVER §7 坑 1）。
 *
 * ⚠️ Context 来源（2026-08-08 修复）：Bot 基类（satorijs）的泛型约束是
 * satorijs/cordis 的 Context，而 koishi 的 Context（独立 interface，含
 * [minato.Types] 泛型）在 exactOptionalPropertyTypes 下不满足该约束（逆变
 * 不兼容，部分 TS 版本报 TS2344）。修复：用 `@satorijs/core` 的 Context
 * （约束正主）——运行时传入的仍是 koishi.Context（其子类），类型层面
 * 只按 Bot 基类能力使用，无需 koishi 特有 API。
 */

import type { Context } from "@satorijs/core";
import { Bot, h, type MessageEncoder, type Universal } from "koishi";
import { NapukettoInternal } from "../actions/index.js";
import { type NapukettoBotConfig, napukettoConfigSchema } from "../config.js";
import { NapukettoDriver } from "../driver/index.js";
import type { HFn } from "../events/elements.js";
import { NapukettoEventBridge, type NapukettoSessionFields } from "../events/index.js";
import type { NapukettoIpcClient } from "../ipc/index.js";
import { NapukettoLoginState } from "../login/index.js";
import { buildLaunch } from "./launch.js";
import { NapukettoMessageEncoder } from "./message.js";

/** 私聊 channelId 前缀（napcat 同构）。 */
const PRIVATE_PREFIX = "private:";

// protocol 常量（const enum，verbatimModuleSyntax 禁直接访问）：
// Channel.Type：TEXT=0 / DIRECT=1；Status：CONNECT=2 / DISCONNECT=3
const CHANNEL_TYPE = { TEXT: 0, DIRECT: 1 } as const;
const BOT_STATUS = { CONNECT: 2, DISCONNECT: 3 } as const;

/** NapukettoQQ 的 koishi Bot（平台 "napuketto"）。
 *
 * ⚠️ 不带泛型 C（2026-08-08 修复）：`C extends Context` 泛型在
 * exactOptionalPropertyTypes 下触发 koishi Context 与 satorijs/cordis Context 的
 * 逆变不兼容（Database/C[unique symbol] 泛型），VS Code TS server 报 TS2344。
 * 显式用 satorijs Context（Bot 约束正主）即可（运行时仍是 koishi.Context）。
 */
export class NapukettoBot extends Bot<Context, NapukettoBotConfig> {
    // koishi 基类 static 类型用 satorijs Bot<cordis.Context>，与 koishi Bot<koishi.Context>
    // 逆变不兼容（napcat 用 eslint 宽松，我们 cast 豁免——运行时是真实 encoder 类）。
    // bot 参数 unknown + 返回 never 泛型：构造签名与基类 static 兼容且不损失运行时行为。
    static override MessageEncoder = NapukettoMessageEncoder as unknown as new (
        bot: unknown,
        channelId: string,
        referrer?: unknown,
        options?: unknown,
    ) => MessageEncoder<never, never>;

    /** 当前 IPC 客户端引用（driver 重启后换实例，onReady 更新）。 */
    private readonly clientRef: { current: NapukettoIpcClient | null } = { current: null };
    private driver: NapukettoDriver | null = null;
    private readonly login: NapukettoLoginState;
    private readonly bridge: NapukettoEventBridge;

    constructor(ctx: Context, config: NapukettoBotConfig) {
        super(ctx, config, "napuketto");
        // selfId setter 写 user.id（satorijs defineAccessor），sid 立即可用
        this.selfId = config.selfId;
        this.user ??= {} as Universal.User;
        this.user.avatar = `http://q.qlogo.cn/headimg_dl?dst_uin=${config.selfId}&spec=640`;

        this.login = new NapukettoLoginState({
            onStateChange: (state, self) => {
                if (self !== undefined) {
                    this.user ??= {} as Universal.User;
                    this.user.id = self.uin;
                    this.user.name = self.nick;
                }
                this.logger.debug("[napuketto] 登录状态: %s", state);
            },
            onError: (error) => {
                this.logger.warn("[napuketto] 登录错误: %o", error);
            },
        });

        // 事件桥（构造时装配一次；dispatch/selfId 无状态转发，driver 重启不影响）
        this.bridge = new NapukettoEventBridge({
            dispatch: (session) => this.dispatchSession(session),
            selfId: () => this.login.snapshot.self?.uin ?? this.config.selfId,
            // koishi h 可调用（Element 工厂）；类型适配（宽松签名，规避逆变检查）
            h: adaptH(h),
            platform: "napuketto",
        });

        // 动作桥：request 绑定 clientRef（client null 时抛错，driver 就绪后可用）
        this.internal = new NapukettoInternal({
            request: async (action, params) => {
                const client = this.clientRef.current;
                if (client === null) {
                    throw new Error("Napuketto 子进程未就绪（等待驱动连接）");
                }
                return client.request(action, params);
            },
        });
    }

    /** 启动：spawn driver（子进程引导 + 登录 + session READY）。 */
    override async start(): Promise<void> {
        if (this.isActive) {
            return;
        }
        this.status = BOT_STATUS.CONNECT;
        try {
            this.setupDriver();
            this.driver?.start();
        } catch (error) {
            this.offline(error instanceof Error ? error : new Error(String(error)));
        }
    }

    /** 停止：停 driver（子进程优雅退出）→ 基类 offline。 */
    override async stop(): Promise<void> {
        this.driver?.stop();
        await super.stop();
    }

    // ── koishi 动作方法（走 internal → IPC action → kernel API） ──

    /** 私聊频道（napcat 同款）。 */
    override async createDirectChannel(userId: string): Promise<Universal.Channel> {
        return { id: `${PRIVATE_PREFIX}${userId}`, type: CHANNEL_TYPE.DIRECT };
    }

    /** 消息历史 → koishi MessageList 形状 { data, next }。 */
    override async getMessageList(
        channelId: string,
        next?: string,
        _direction?: Universal.Direction,
        limit?: number,
    ): Promise<Universal.BidiList<Universal.Message>> {
        const list = await this.internal.getMessageList(channelId, next, limit);
        return {
            data: list.data as Universal.Message[],
            ...(list.next !== undefined ? { next: list.next } : {}),
        };
    }

    /** 撤回消息。 */
    override async deleteMessage(_channelId: string, messageId: string): Promise<void> {
        await this.internal.deleteMessage(_channelId, messageId);
    }

    /** 登录信息（getSelf → user → toJSON）。 */
    override async getLogin(): Promise<Universal.Login> {
        const data = (await this.internal.getSelf()) as
            | { uin?: string; nickname?: string }
            | undefined;
        if (data !== undefined && data !== null) {
            this.user ??= {} as Universal.User;
            if (typeof data.uin === "string" && data.uin !== "") {
                this.selfId = data.uin;
            }
            this.user.name = data.nickname ?? this.user.name ?? "";
        }
        return this.toJSON();
    }

    /** 好友列表（kernel Friend { uin, nickname } → Universal.Friend）。 */
    override async getFriendList(): Promise<Universal.List<Universal.Friend>> {
        const friends = (await this.internal.getFriendList()) as
            | Array<{ uin?: string; nickname?: string }>
            | undefined;
        return {
            data: (friends ?? []).map((friend) => ({
                user: {
                    id: friend.uin ?? "",
                    name: friend.nickname ?? friend.uin ?? "",
                },
                nick: friend.nickname ?? friend.uin ?? "",
            })),
        };
    }

    /** 群列表（kernel Group { groupCode, groupName } → Universal.Guild）。 */
    override async getGuildList(): Promise<Universal.List<Universal.Guild>> {
        const groups = (await this.internal.getGroupList()) as
            | Array<{ groupCode?: string; groupName?: string }>
            | undefined;
        return {
            data: (groups ?? []).map((group) => ({
                id: group.groupCode ?? "",
                name: group.groupName ?? group.groupCode ?? "",
            })),
        };
    }

    /** 群详情（群列表里找）。 */
    override async getGuild(guildId: string): Promise<Universal.Guild> {
        const guilds = await this.getGuildList();
        const guild = guilds.data.find((item) => item.id === guildId);
        if (guild === undefined) {
            throw new Error(`群不存在: ${guildId}`);
        }
        return guild;
    }

    /** 频道（私聊 DIRECT / 群 TEXT）。 */
    override async getChannel(channelId: string): Promise<Universal.Channel> {
        if (channelId.startsWith(PRIVATE_PREFIX)) {
            const userId = channelId.slice(PRIVATE_PREFIX.length);
            return {
                id: channelId,
                type: CHANNEL_TYPE.DIRECT,
                name: userId,
            } satisfies Universal.Channel;
        }
        const guild = await this.getGuild(channelId);
        return {
            id: channelId,
            type: CHANNEL_TYPE.TEXT,
            name: guild.name ?? channelId,
        } satisfies Universal.Channel;
    }

    // ── 内部 ──

    /** 创建 driver（launch 工厂组装 launchSelfHost，events 接线）。 */
    private setupDriver(): void {
        if (this.driver !== null) {
            return;
        }
        const driver = new NapukettoDriver({
            launch: buildLaunch(this.config),
            events: {
                onStatus: (status) => {
                    this.logger.debug("[napuketto] 引导阶段: %s", status.phase);
                },
                onLogin: (payload) => {
                    this.login.onLogin(payload.state, payload.selfInfo);
                },
                onQr: (qr) => this.login.onQr(qr),
                onEvent: (payload) => {
                    this.bridge.handle(payload);
                },
                onReady: () => {
                    this.handleReady();
                },
                onExit: () => {
                    this.login.onExit();
                    // 非主动停止的退出 → offline（driver 内部会重启；达上限 onError）
                    if (this.status !== BOT_STATUS.DISCONNECT) {
                        this.offline();
                    }
                },
                onError: (error) => {
                    this.logger.warn("[napuketto] 驱动错误: %o", error);
                    this.offline(error instanceof Error ? error : new Error(String(error)));
                },
                onLog: (log) => {
                    this.logger.debug("[napuketto 子进程] %s", log.message);
                },
            },
            // exactOptionalPropertyTypes：可选字段条件展开，不显式赋 undefined
            ...(this.config.restart !== undefined ? { restart: this.config.restart } : {}),
            ...(this.config.heartbeatTimeoutMs !== undefined
                ? { heartbeatTimeoutMs: this.config.heartbeatTimeoutMs }
                : {}),
        });
        this.driver = driver;
    }

    /** driver ready：clientRef 更新 + 登录状态就绪 + online + 拉登录信息。 */
    private handleReady(): void {
        const client = this.driver?.currentClient;
        if (client !== null && client !== undefined) {
            this.clientRef.current = client;
        }
        this.login.onReady();
        this.online();
        void this.getLogin().catch((error) => {
            this.logger.warn("[napuketto] 拉取登录信息失败: %o", error);
        });
    }

    /** kernel 事件 session 字段 → koishi session → dispatch。 */
    private dispatchSession(fields: NapukettoSessionFields): void {
        const session = this.session({
            type: fields.type,
            selfId: fields.selfId,
            platform: fields.platform,
            timestamp: fields.timestamp,
        });
        if (fields.userId !== undefined) {
            session.userId = fields.userId;
        }
        if (fields.channelId !== undefined) {
            session.channelId = fields.channelId;
        }
        if (fields.guildId !== undefined) {
            session.guildId = fields.guildId;
        }
        if (fields.messageId !== undefined) {
            session.messageId = fields.messageId;
        }
        // 私聊/群聊判定（event.channel.type = DIRECT/TEXT；不设则 isDirect 恒 false，
        // 私聊消息会被当群聊路由——onebot 实证）
        if (fields.isDirect !== undefined) {
            session.isDirect = fields.isDirect;
        }
        // ⚠️ 只设 elements：satorijs content 是 getter（elements.join("") 派生）；
        // 若设 session.content 会走 setter → h.parse(value) 覆盖 elements（结构化
        // 元素丢失，含特殊字符时 parse 可能抛错 → dispatch 失败）。
        if (fields.elements !== undefined) {
            session.elements = fields.elements as h[];
        }
        this.dispatch(session);
    }
}

/** koishi h 工厂适配（HFn）。h 可调用（Element 工厂），类型宽适配规避逆变检查。 */
function adaptH(koishiH: typeof h): HFn {
    const factory = koishiH as unknown as (
        type: string,
        attrs?: Record<string, unknown>,
        ...children: unknown[]
    ) => { type: string; attrs: Record<string, unknown>; toString(): string };
    return (type, attrs, ...children) => factory(type, attrs, ...children);
}

/** 平台配置 schema（koishi bots 配置校验，napcat 同构 namespace 合并）。 */
export namespace NapukettoBot {
    export const Config = napukettoConfigSchema;
    export type Config = NapukettoBotConfig;
}
