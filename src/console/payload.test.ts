/**
 * payload.test.ts：LoginSnapshot → LoginPanelPayload 纯函数映射单测。
 */
import { describe, expect, it } from "vitest";
import { loginStateMessage, toLoginPanelPayload } from "./payload.js";

describe("loginStateMessage", () => {
    it("各状态映射人类可读文案", () => {
        expect(loginStateMessage("idle")).toBe("未登录（等待子进程就绪）");
        expect(loginStateMessage("waiting_scan")).toBe("请使用手机 QQ 扫描二维码");
        expect(loginStateMessage("scanned")).toBe("已扫码，请在手机上确认登录");
        expect(loginStateMessage("logged_in")).toBe("登录成功");
        expect(loginStateMessage("failed")).toBe("登录失败");
    });
});

describe("toLoginPanelPayload", () => {
    it("基础快照 → payload（state/selfId/message，无可选字段）", () => {
        const payload = toLoginPanelPayload({ state: "idle" }, "10001");
        expect(payload).toEqual({
            state: "idle",
            selfId: "10001",
            message: "未登录（等待子进程就绪）",
        });
        expect(payload.qr).toBeUndefined();
        expect(payload.self).toBeUndefined();
        expect(payload.lastError).toBeUndefined();
    });

    it("QR 条件展开（waiting_scan）", () => {
        const payload = toLoginPanelPayload(
            {
                state: "waiting_scan",
                qr: { pngBase64: "aGVsbG8=", qrcodeUrl: "https://example.com/qr" },
            },
            "10001",
        );
        expect(payload.qr).toEqual({ pngBase64: "aGVsbG8=", qrcodeUrl: "https://example.com/qr" });
        expect(payload.image).toBe("data:image/png;base64,aGVsbG8=");
        expect(payload.message).toBe("请使用手机 QQ 扫描二维码");
    });

    it("pngBase64 为空时不产出 image 字段", () => {
        const payload = toLoginPanelPayload(
            { state: "waiting_scan", qr: { pngBase64: "", qrcodeUrl: "https://example.com/qr" } },
            "10001",
        );
        expect(payload.qr).toBeDefined();
        expect(payload.image).toBeUndefined();
    });

    it("self 条件展开（logged_in）", () => {
        const payload = toLoginPanelPayload(
            { state: "logged_in", self: { uin: "10001", uid: "u_1", nick: "测试号" } },
            "10001",
        );
        expect(payload.self).toEqual({ uin: "10001", uid: "u_1", nick: "测试号" });
    });

    it("lastError 条件展开（failed）", () => {
        const payload = toLoginPanelPayload({ state: "failed", lastError: "登录失败" }, "10001");
        expect(payload.lastError).toBe("登录失败");
    });
});
