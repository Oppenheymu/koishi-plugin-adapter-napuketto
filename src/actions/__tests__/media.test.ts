/**
 * media.test.ts：ensureSilk / ensureVoiceSilk 单测（mock @napuketto/media）。
 *
 * 锁定语音归一化的三条路径（design.md §5.10）：
 * - 已是 silk（#!SILK 头）→ 原样返回（不触发转码）
 * - 非 silk → encodePcmToSilk 转码返回新路径
 * - 转码失败 → 回落原路径（kernel 发送兜底，不阻断）
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureSilk, ensureVoiceSilk, materializeDataUrlImages } from "../media.js";

const { encodePcmToSilkMock } = vi.hoisted(() => ({ encodePcmToSilkMock: vi.fn() }));
vi.mock("@napuketto/media", () => ({ encodePcmToSilk: encodePcmToSilkMock }));

describe("ensureSilk", () => {
    let dir: string;
    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), "napuketto-koishi-media-"));
        encodePcmToSilkMock.mockReset();
    });
    afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
    });

    it("已是 silk（#!SILK 头）→ 原样返回（不转码）", async () => {
        const silk = join(dir, "voice.silk");
        writeFileSync(silk, Buffer.concat([Buffer.from("#!SILK_V3"), Buffer.alloc(16)]));

        await expect(ensureSilk(silk)).resolves.toBe(silk);
        expect(encodePcmToSilkMock).not.toHaveBeenCalled();
    });

    it("非 silk（ogg）→ encodePcmToSilk 转码返回新路径", async () => {
        const ogg = join(dir, "voice.ogg");
        writeFileSync(ogg, Buffer.from("OggS........"));
        encodePcmToSilkMock.mockResolvedValue(join(dir, "voice.silk"));

        await expect(ensureSilk(ogg)).resolves.toBe(join(dir, "voice.silk"));
        expect(encodePcmToSilkMock).toHaveBeenCalledWith(ogg);
    });

    it("转码失败 → 回落原路径（不阻断发送）", async () => {
        const ogg = join(dir, "voice.ogg");
        writeFileSync(ogg, Buffer.from("OggS........"));
        encodePcmToSilkMock.mockRejectedValue(new Error("ffmpeg 不可用"));

        await expect(ensureSilk(ogg)).resolves.toBe(ogg);
    });

    it("ensureVoiceSilk：voice 元素转码，其他元素原样", async () => {
        const ogg = join(dir, "voice.ogg");
        writeFileSync(ogg, Buffer.from("OggS........"));
        encodePcmToSilkMock.mockResolvedValue(join(dir, "voice.silk"));

        const out = await ensureVoiceSilk([
            { type: "text", text: "hi" },
            { type: "voice", path: ogg },
        ]);

        expect(out[0]).toEqual({ type: "text", text: "hi" });
        expect(out[1]).toEqual({ type: "voice", path: join(dir, "voice.silk") });
    });
});

describe("materializeDataUrlImages", () => {
    it("将 Base64 图片 data URL 写入临时文件并在清理后删除", async () => {
        const source = "data:image/jpeg;base64,/9j/AA==";
        const materialized = await materializeDataUrlImages([{ type: "image", path: source }]);
        const path = (materialized.elements[0] as { path: string }).path;

        expect(path).not.toBe(source);
        expect(path).toMatch(/\.jpg$/);
        expect(readFileSync(path)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0x00]));

        await materialized.cleanup();
        expect(() => readFileSync(path)).toThrow();
    });
});
