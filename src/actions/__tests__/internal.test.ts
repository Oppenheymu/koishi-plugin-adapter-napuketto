/**
 * internal.test.ts：NapukettoInternal 单测（mock request 注入，design.md §5.10）。
 */

import { describe, expect, it, vi } from "vitest";
import { NapukettoInternal } from "../internal.js";
import type { RequestFn } from "../types.js";

/** 构造 internal + mock request（记录调用，可自定义返回）。 */
function createInternal(
    impl?: (action: string, params?: Record<string, unknown>) => Promise<unknown>,
): {
    internal: NapukettoInternal;
    request: ReturnType<typeof vi.fn<RequestFn>>;
} {
    const request = vi.fn<RequestFn>(impl ?? (async () => ({})));
    const internal = new NapukettoInternal({ request });
    return { internal, request };
}

describe("NapukettoInternal", () => {
    it("sendMessage：群聊 → msg.sendMessage（元素反向映射）", async () => {
        const { internal, request } = createInternal(async () => ({ msgId: "m1" }));
        const ids = await internal.sendMessage("123456789", "你好");
        expect(ids).toEqual(["m1"]);
        expect(request).toHaveBeenCalledWith("msg.sendMessage", {
            chatType: 2,
            peerUin: "123456789",
            elements: [{ type: "text", text: "你好" }],
        });
    });

    it("sendMessage：私聊 → chatType=1", async () => {
        const { internal, request } = createInternal(async () => ({ msgId: "m2" }));
        await internal.sendMessage("private:10001", "在吗");
        expect(request).toHaveBeenCalledWith("msg.sendMessage", {
            chatType: 1,
            peerUin: "10001",
            elements: [{ type: "text", text: "在吗" }],
        });
    });

    it("sendMessage：空内容 → 不请求返回 []", async () => {
        const { internal, request } = createInternal();
        const ids = await internal.sendMessage("123", "");
        expect(ids).toEqual([]);
        expect(request).not.toHaveBeenCalled();
    });

    it("sendMessage：result 无 msgId → 返回 []", async () => {
        const { internal } = createInternal(async () => ({}));
        const ids = await internal.sendMessage("123", "hi");
        expect(ids).toEqual([]);
    });

    it("deleteMessage → msg.recallMessage", async () => {
        const { internal, request } = createInternal();
        await internal.deleteMessage("123", "mid-1");
        expect(request).toHaveBeenCalledWith("msg.recallMessage", {
            chatType: 2,
            peerUin: "123",
            msgIds: ["mid-1"],
        });
    });

    it("getMessageList → msg.fetchMessages（before → msgId，next=末条）", async () => {
        const { internal, request } = createInternal(async () => [{ msgId: "a" }, { msgId: "b" }]);
        const list = await internal.getMessageList("123", "a", 10);
        expect(request).toHaveBeenCalledWith("msg.fetchMessages", {
            chatType: 2,
            peerUin: "123",
            count: 10,
            msgId: "a",
        });
        expect(list).toEqual({ data: [{ msgId: "a" }, { msgId: "b" }], next: "b" });
    });

    it("getMessageList：无 before → 不带 msgId，count 默认 20", async () => {
        const { internal, request } = createInternal(async () => []);
        await internal.getMessageList("123");
        expect(request).toHaveBeenCalledWith("msg.fetchMessages", {
            chatType: 2,
            peerUin: "123",
            count: 20,
        });
    });

    it("getMessageList：末条无 msgId → 不带 next", async () => {
        const { internal } = createInternal(async () => [{ text: "x" }]);
        const list = await internal.getMessageList("123");
        expect(list).toEqual({ data: [{ text: "x" }] });
    });

    it("markAsRead → msg.markRead", async () => {
        const { internal, request } = createInternal();
        await internal.markAsRead("123");
        expect(request).toHaveBeenCalledWith("msg.markRead", {
            chatType: 2,
            peerUin: "123",
        });
    });

    it("getGroupList / getFriendList / getSelf 透传", async () => {
        const { internal, request } = createInternal(async () => []);
        await internal.getGroupList();
        await internal.getFriendList();
        await internal.getSelf();
        expect(request).toHaveBeenNthCalledWith(1, "group.getGroupList");
        expect(request).toHaveBeenNthCalledWith(2, "friend.getFriendList");
        expect(request).toHaveBeenNthCalledWith(3, "login.getSelf");
    });

    it("_request 透传（传输抽象）", async () => {
        const { internal, request } = createInternal(async () => ({ ok: 1 }));
        const value = await internal._request("msg.sendMessage", { chatType: 2 });
        expect(value).toEqual({ ok: 1 });
        expect(request).toHaveBeenCalledWith("msg.sendMessage", { chatType: 2 });
    });
});
