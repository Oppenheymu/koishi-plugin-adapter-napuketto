/**
 * driver-events.test.ts：NapukettoDriver 事件转发单测（login/qr/event/log）。
 */
import { describe, expect, it, vi } from "vitest";
import { encodeIpcMessage, IPC_VERSION } from "../../ipc/index.js";
import { createHarness } from "./test-utils.js";

describe("NapukettoDriver 事件转发", () => {
    it("login/qr/event/log 透传给 events 回调", () => {
        const onLogin = vi.fn();
        const onQr = vi.fn();
        const onEvent = vi.fn();
        const onLog = vi.fn();
        const { driver, peers } = createHarness({ onLogin, onQr, onEvent, onLog });
        driver.start();
        const pair = peers[0]?.peer;
        expect(pair).toBeDefined();

        pair?.write(
            encodeIpcMessage({
                v: IPC_VERSION,
                type: "login",
                payload: { state: "logged_in", selfInfo: { uin: "1", uid: "u1", nick: "n" } },
            }),
        );
        pair?.write(
            encodeIpcMessage({
                v: IPC_VERSION,
                type: "qr",
                payload: { pngBase64: "aGk=", qrcodeUrl: "https://x" },
            }),
        );
        pair?.write(
            encodeIpcMessage({
                v: IPC_VERSION,
                type: "event",
                payload: { service: "Msg", name: "onRecvMsg", args: [] },
            }),
        );
        pair?.write(
            encodeIpcMessage({
                v: IPC_VERSION,
                type: "log",
                payload: { level: "info", message: "hi" },
            }),
        );
        expect(onLogin).toHaveBeenCalled();
        expect(onQr).toHaveBeenCalled();
        expect(onEvent).toHaveBeenCalledWith({ service: "Msg", name: "onRecvMsg", args: [] });
        expect(onLog).toHaveBeenCalledWith({ level: "info", message: "hi" });
        driver.stop();
    });
});
