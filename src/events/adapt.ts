/**
 * adapt.ts：kernel RawMessage → koishi session 字段（纯函数，design.md §5.9）。
 *
 * 链路：IPC event.args（RawMessage）→ kernel toCanonicalElements（canonical 中间层）
 * → toKoishiElements（koishi 元素）→ session 字段。
 *
 * 会话标识映射（napcat/onebot 同构，§9.1）：
 *  - 群聊（chatType=2）：type=message.group，channelId=guildId=groupCode
 *  - 私聊（chatType=1）：type=message.private，channelId=private:+senderUin
 *  - 临时会话（chatType=100）：type=message.private，guildId=groupCode
 */

import type { RawMessage } from "@napuketto/kernel";
import { toCanonicalElements } from "@napuketto/kernel";
import { type HFn, toKoishiElements } from "./elements.js";
import type { NapukettoSessionFields } from "./types.js";

/** 私聊 channelId 前缀（napcat 同构）。 */
const PRIVATE_PREFIX = "private:";

/** 会话类型（kernel ChatType 对齐）。 */
const ChatType = { C2C: 1, GROUP: 2, TEMP: 100 } as const;

/** 适配选项。 */
export interface AdaptOptions {
    selfId: string;
    platform: string;
    /** koishi h() 工厂（生产传 bindKoishiH(h)，单测传 mock）。 */
    h: HFn;
}

/** RawMessage → koishi session 字段。 */
export function adaptRawMessage(msg: RawMessage, options: AdaptOptions): NapukettoSessionFields {
    const { selfId, platform, h } = options;
    const senderUin = msg.senderUin ?? "";
    const groupCode = msg.peerUin ?? ""; // 群聊时 peerUin = 群号
    const isGroup = msg.chatType === ChatType.GROUP;

    const session: NapukettoSessionFields = {
        type: isGroup ? "message.group" : "message.private",
        selfId,
        platform,
        timestamp: Number(msg.msgTime) * 1000,
        userId: senderUin,
        messageId: msg.msgId,
        ...(isGroup
            ? { channelId: groupCode, guildId: groupCode }
            : { channelId: `${PRIVATE_PREFIX}${senderUin}` }),
    };
    // 临时会话（群内私聊）带 guildId（群号）
    if (msg.chatType === ChatType.TEMP && groupCode !== "") {
        session.guildId = groupCode;
    }

    // NT RawElement → canonical → koishi 元素
    const elements = toKoishiElements(toCanonicalElements(msg), h);
    session.elements = elements;
    session.content = elements.map(String).join("");

    return session;
}
