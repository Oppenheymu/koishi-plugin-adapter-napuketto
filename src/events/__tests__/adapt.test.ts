/**
 * adapt.test.ts：RawMessage → koishi session 字段单测。
 */

import type { RawMessage } from "@napuketto/kernel";
import { describe, expect, it } from "vitest";
import { adaptRawMessage } from "../adapt.js";
import { mockH } from "./test-utils.js";

/** 默认适配选项（mock h）。 */
function adaptOpts(overrides: Partial<{ selfId: string; platform: string }> = {}): {
    selfId: string;
    platform: string;
    h: ReturnType<typeof mockH>;
} {
    return {
        selfId: overrides.selfId ?? "10086",
        platform: overrides.platform ?? "napuketto",
        h: mockH(),
    };
}

/** 构造一条测试 RawMessage。 */
function makeMsg(overrides: Partial<RawMessage> = {}): RawMessage {
    return {
        msgId: "m1",
        msgSeq: "1",
        msgTime: "1700000000",
        msgType: 9,
        chatType: 2,
        peerUid: "u_peer",
        peerUin: "10001",
        senderUid: "u_sender",
        senderUin: "20001",
        peerName: "测试群",
        sendNickName: "小明",
        elements: [{ elementType: 1, textElement: { content: "你好" } }],
        ...overrides,
    };
}

describe("adaptRawMessage", () => {
    it("群聊 → message.group + channelId=guildId=群号", () => {
        const session = adaptRawMessage(makeMsg(), adaptOpts());
        expect(session.type).toBe("message.group");
        expect(session.selfId).toBe("10086");
        expect(session.platform).toBe("napuketto");
        expect(session.userId).toBe("20001");
        expect(session.channelId).toBe("10001");
        expect(session.guildId).toBe("10001");
        expect(session.messageId).toBe("m1");
    });

    it("私聊 → message.private + channelId=private:+senderUin", () => {
        const session = adaptRawMessage(
            makeMsg({ chatType: 1, peerUin: "20001", peerUid: "u_sender" }),
            adaptOpts(),
        );
        expect(session.type).toBe("message.private");
        expect(session.channelId).toBe("private:20001");
        expect(session.guildId).toBeUndefined();
    });

    it("临时会话 → message.private + guildId=群号", () => {
        const session = adaptRawMessage(makeMsg({ chatType: 100, peerUin: "10001" }), adaptOpts());
        expect(session.type).toBe("message.private");
        expect(session.channelId).toBe("private:20001");
        expect(session.guildId).toBe("10001");
    });

    it("元素翻译：文本 → content", () => {
        const session = adaptRawMessage(makeMsg(), adaptOpts());
        expect(session.content).toContain("你好");
    });

    it("timestamp = msgTime × 1000", () => {
        const session = adaptRawMessage(makeMsg(), adaptOpts());
        expect(session.timestamp).toBe(1700000000 * 1000);
    });
});
