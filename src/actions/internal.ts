/**
 * internal.ts：NapukettoInternal——koishi bot.internal 封装（design.md §5.10）。
 *
 * 对应 napcat 的 `internal._request` 传输抽象（§9.1）：koishi 动作 → IPC action
 * 请求 → 子进程 kernel API。request 回调由 apply() 层注入（client.request 绑定），
 * 单测用 mock request。
 *
 * koishi 主包不 import（单测崩溃，HANDOVER §7 坑 1）：方法签名用宽松结构，
 * bot.ts（§6 第 6 步）挂载时与 koishi Internal 类型适配。
 */
import { parseChannelId } from "./channel.js";
import { toCanonicalElements } from "./elements.js";
import type { MessageListResponse, NapukettoInternalOptions } from "./types.js";

/** koishi bot.internal 封装（动作方法签名对齐 koishi Internal 惯例）。 */
export class NapukettoInternal {
    constructor(private readonly options: NapukettoInternalOptions) {}

    /** 统一动作调用（napcat internal._request 同构；IPC 动作请求）。 */
    _request(action: string, params?: Record<string, unknown>): Promise<unknown> {
        return this.options.request(action, params);
    }

    /** 发消息：koishi 元素 → canonical → msg.sendMessage。返回消息 id 数组。 */
    async sendMessage(channelId: string, content: unknown, guildId?: string): Promise<string[]> {
        const peer = parseChannelId(channelId, guildId);
        const elements = toCanonicalElements(content);
        if (elements.length === 0) {
            return []; // 空内容：不发请求
        }
        const result = await this.options.request("msg.sendMessage", {
            chatType: peer.chatType,
            peerUin: peer.peerUin,
            elements,
        });
        const msgId = (result as { msgId?: string } | null | undefined)?.msgId;
        return msgId === undefined || msgId === "" ? [] : [msgId];
    }

    /** 撤回消息（messageId → msg.recallMessage）。 */
    async deleteMessage(channelId: string, messageId: string): Promise<void> {
        const peer = parseChannelId(channelId);
        await this.options.request("msg.recallMessage", {
            chatType: peer.chatType,
            peerUin: peer.peerUin,
            msgIds: [messageId],
        });
    }

    /** 拉取消息历史：RawMessage[] → koishi MessageList 形状 { data, next? }。 */
    async getMessageList(
        channelId: string,
        before?: string,
        limit?: number,
    ): Promise<MessageListResponse<unknown>> {
        const peer = parseChannelId(channelId);
        const params: Record<string, unknown> = {
            chatType: peer.chatType,
            peerUin: peer.peerUin,
            count: limit ?? 20,
        };
        if (before !== undefined && before !== "") {
            params["msgId"] = before;
        }
        const data = await this.options.request("msg.fetchMessages", params);
        const list: unknown[] = Array.isArray(data) ? data : [];
        const last = list.at(-1) as { msgId?: unknown } | undefined;
        return {
            data: list,
            ...(last !== undefined && typeof last["msgId"] === "string"
                ? { next: last["msgId"] }
                : {}),
        };
    }

    /** 标记已读。 */
    async markAsRead(channelId: string): Promise<void> {
        const peer = parseChannelId(channelId);
        await this.options.request("msg.markRead", {
            chatType: peer.chatType,
            peerUin: peer.peerUin,
        });
    }

    /** 群列表。 */
    getGroupList(): Promise<unknown> {
        return this.options.request("group.getGroupList");
    }

    /** 好友列表。 */
    getFriendList(): Promise<unknown> {
        return this.options.request("friend.getFriendList");
    }

    /** 登录账号自身信息。 */
    getSelf(): Promise<unknown> {
        return this.options.request("login.getSelf");
    }
}
