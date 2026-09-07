/**
 * voice-decode.test.ts：收方向语音解码单测（2026-09-08 T6）。
 *
 * resolveNtFile：绝对路径直用 / NT 基准候选命中 / 未命中 null。
 * enrichReceiveVoice：本地 silk → WAV（RIFF 头校验，silk 样本经
 * encodePcmToSilk 现场生成）；非 silk / http / 空路径原样透传。
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalElement } from "@napuketto/kernel";
import { encodePcmToSilk } from "@napuketto/media";
import { afterAll, describe, expect, it } from "vitest";
import { enrichReceiveVoice, resolveNtFile } from "../voice-decode.js";

const dirs: string[] = [];

function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), `napuketto-${prefix}-`));
    dirs.push(dir);
    return dir;
}

afterAll(() => {
    for (const dir of dirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

/** 生成最小 WAV（pcm_s16le 单声道 24000Hz，0.1s 静音）。 */
function makeWav(path: string): void {
    const sampleRate = 24000;
    const samples = sampleRate / 10;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0, "ascii");
    header.writeUInt32LE(36 + samples * 2, 4);
    header.write("WAVE", 8, "ascii");
    header.write("fmt ", 12, "ascii");
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36, "ascii");
    header.writeUInt32LE(samples * 2, 40);
    writeFileSync(path, Buffer.concat([header, Buffer.alloc(samples * 2)]));
}

describe("resolveNtFile", () => {
    it("绝对路径存在直用；未命中返回 null", () => {
        const dir = tempDir("nt");
        const file = join(dir, "a.silk");
        writeFileSync(file, "x");
        expect(resolveNtFile(file)).toBe(file);
        expect(resolveNtFile(join(dir, "nope.silk"))).toBeNull();
        expect(resolveNtFile("")).toBeNull();
    });
});

describe("enrichReceiveVoice", () => {
    it("本地 silk → WAV（RIFF 头 + 落 tmpdir napuketto-voice）", async () => {
        const dir = tempDir("silk");
        const wav = join(dir, "in.wav");
        makeWav(wav);
        const silk = await encodePcmToSilk(wav);
        const out = await enrichReceiveVoice([{ type: "voice", path: silk }]);
        expect(out[0]?.type).toBe("voice");
        const path = (out[0] as { path: string }).path;
        expect(path).not.toBe(silk);
        expect(path.toLowerCase().endsWith(".wav")).toBe(true);
        expect(existsSync(path)).toBe(true);
        // RIFF 头校验（WAV）
        const { readFileSync } = await import("node:fs");
        expect(readFileSync(path).subarray(0, 4).toString("ascii")).toBe("RIFF");
    });

    it("非 silk 本地文件 / http / 空路径原样透传", async () => {
        const dir = tempDir("notsilk");
        const file = join(dir, "not.txt");
        writeFileSync(file, "x");
        const input: CanonicalElement[] = [
            { type: "voice", path: file },
            { type: "voice", path: "https://x/a.silk" },
            { type: "voice", path: "" },
            { type: "text", text: "hi" },
        ];
        const out = await enrichReceiveVoice(input);
        expect(out).toEqual(input);
    });
});
