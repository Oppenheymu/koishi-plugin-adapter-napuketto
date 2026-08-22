/**
 * media.ts：语音格式归一化（design.md §5.10）
 *
 * koishi 发语音（h.audio → canonical voice）前统一转 QQ 语音格式（silk v3）：
 * 非 silk 输入（ogg/mp3/wav 等，经 @napuketto/media 的 encodePcmToSilk 归一化）
 * 转 silk；已是 silk（#!SILK 头）原样返回；转码失败原样返回（kernel 发送兜底）。
 *
 * 2026-08-23 修复：此前 koishi 路径不做转码，ogg/mp3 原样上传，QQ 播放器
 * 无法解码（线上实证：语音发送成功但收件人无法播放，Ptt\Ori 落盘的是
 * OggS 魔数原样内容）。
 */
import { open } from "node:fs/promises";
import type { CanonicalElement } from "@napuketto/kernel";
import { encodePcmToSilk } from "@napuketto/media";

/** 读文件头 8 字节（判断 silk 魔数）。 */
async function readFileHead(path: string): Promise<string> {
    const handle = await open(path, "r");
    try {
        const buf = Buffer.alloc(8);
        await handle.read(buf, 0, 8, 0);
        return buf.toString("utf8");
    } finally {
        await handle.close();
    }
}

/** 语音转码：非 silk → silk（@napuketto/media 归一化）；已是 silk 原样；失败回落原路径。 */
export async function ensureSilk(path: string): Promise<string> {
    try {
        const header = await readFileHead(path);
        if (header.startsWith("#!SILK")) {
            return path;
        }
        return await encodePcmToSilk(path);
    } catch {
        return path;
    }
}

/** canonical 元素数组中的语音统一转 silk（非 voice 元素原样）。 */
export async function ensureVoiceSilk(elements: CanonicalElement[]): Promise<CanonicalElement[]> {
    const out: CanonicalElement[] = [];
    for (const el of elements) {
        out.push(el.type === "voice" ? { ...el, path: await ensureSilk(el.path) } : el);
    }
    return out;
}
