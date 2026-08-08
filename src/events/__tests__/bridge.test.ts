/**
 * bridge.test.ts：事件桥单测（kernel 事件 → dispatch）。
 */
import { describe, expect, it, vi } from "vitest";
import type { IpcEventPayload } from "../../ipc/index.js";
import { NapukettoEventBridge } from "../bridge.js";
import { mockH } from "../test-utils.js";

/** 构造 Msg/onRecvMsg 事件 payload（消息数组或单条——bridge 兼容两者）。 */
function recvPayload(messages: unknown): IpcEventPayload {
    return { service: "Msg", name: "onRecvMsg", args: [messages] };
}

describe("NapukettoEventBridge", () => {
    it("Msg/onRecvMsg（数组）→ 逐条 dispatch", () => {
        const dispatch = vi.fn();
        const bridge = new NapukettoEventBridge({
            dispatch,
            selfId: () => "10086",
            platform: "napuketto",
            h: mockH(),
        });
        bridge.handle(
            recvPayload([
                {
                    msgId: "m1",
                    msgSeq: "1",
                    msgTime: "1700000000",
                    msgType: 9,
                    chatType: 2,
                    peerUid: "u_peer",
                    peerUin: "10001",
                    senderUid: "u_s",
                    senderUin: "20001",
                    peerName: "群",
                    sendNickName: "小明",
                    elements: [{ elementType: 1, textElement: { content: "a" } }],
                },
                {
                    msgId: "m2",
                    msgSeq: "2",
                    msgTime: "1700000001",
                    msgType: 9,
                    chatType: 1,
                    peerUid: "u_s",
                    peerUin: "20001",
                    senderUid: "u_s",
                    senderUin: "20001",
                    peerName: "小明",
                    sendNickName: "小明",
                    elements: [{ elementType: 1, textElement: { content: "b" } }],
                },
            ]),
        );
        expect(dispatch).toHaveBeenCalledTimes(2);
        expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
            type: "message",
            subtype: "group",
            userId: "20001",
            channelId: "10001",
        });
        expect(dispatch.mock.calls[1]?.[0]).toMatchObject({
            type: "message",
            subtype: "private",
            channelId: "private:20001",
        });
    });

    it("Msg/onRecvMsg 单条（非数组）兼容", () => {
        const dispatch = vi.fn();
        const bridge = new NapukettoEventBridge({
            dispatch,
            selfId: () => "10086",
            h: mockH(),
        });
        bridge.handle(
            recvPayload({
                msgId: "m1",
                msgSeq: "1",
                msgTime: "1700000000",
                msgType: 9,
                chatType: 2,
                peerUid: "u_peer",
                peerUin: "10001",
                senderUid: "u_s",
                senderUin: "20001",
                peerName: "群",
                sendNickName: "小明",
                elements: [{ elementType: 1, textElement: { content: "x" } }],
            }),
        );
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it("非 Msg/onRecvMsg 事件忽略", () => {
        const dispatch = vi.fn();
        const bridge = new NapukettoEventBridge({ dispatch, selfId: () => "1", h: mockH() });
        bridge.handle({ service: "Group", name: "onGroupListUpdate", args: [] });
        expect(dispatch).not.toHaveBeenCalled();
    });

    it("数组含无效项跳过", () => {
        const dispatch = vi.fn();
        const bridge = new NapukettoEventBridge({ dispatch, selfId: () => "1", h: mockH() });
        const raw: Record<string, unknown> = {
            msgId: "ok",
            msgSeq: "1",
            msgTime: "0",
            msgType: 9,
            chatType: 2,
            peerUid: "u",
            peerUin: "1",
            senderUid: "u",
            senderUin: "2",
            peerName: "",
            sendNickName: "",
            elements: [],
        };
        bridge.handle(recvPayload([null, "string", raw]));
        expect(dispatch).toHaveBeenCalledTimes(1);
    });

    it("系统占位消息（senderUin=0）跳过，不 dispatch", () => {
        const dispatch = vi.fn();
        const bridge = new NapukettoEventBridge({ dispatch, selfId: () => "1", h: mockH() });
        const system: Record<string, unknown> = {
            msgId: "sys1",
            msgSeq: "0",
            msgTime: "0",
            msgType: 9,
            chatType: 2,
            peerUid: "u",
            peerUin: "10001",
            senderUid: "u",
            senderUin: "0",
            peerName: "",
            sendNickName: "",
            elements: [],
        };
        // 批量里混着 2 条系统消息 + 1 条真实消息 → 只 dispatch 真实消息
        bridge.handle(
            recvPayload([
                system,
                { ...system, msgId: "sys2" },
                { ...system, msgId: "real", senderUin: "20001" },
            ]),
        );
        expect(dispatch).toHaveBeenCalledTimes(1);
        expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
            type: "message",
            userId: "20001",
            channelId: "10001",
        });
    });
});
