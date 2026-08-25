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
import { randomUUID } from "node:crypto";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalElement } from "@napuketto/kernel";
import { encodePcmToSilk } from "@napuketto/media";

const IMAGE_EXTENSIONS: Record<string, string> = {
    "image/avif": ".avif",
    "image/gif": ".gif",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
};

interface MaterializedImages {
    elements: CanonicalElement[];
    cleanup: () => Promise<void>;
}

/** data URL 图片落盘，供 IPC 子进程中的 wrapper.node 按文件路径读取。 */
export async function materializeDataUrlImages(
    elements: CanonicalElement[],
): Promise<MaterializedImages> {
    const imageElements = elements.filter(
        (element): element is Extract<CanonicalElement, { type: "image" }> =>
            element.type === "image" && /^data:image\//i.test(element.path),
    );
    if (imageElements.length === 0) {
        return { elements, cleanup: async () => undefined };
    }

    const directory = await mkdtemp(join(tmpdir(), "napuketto-image-"));
    try {
        const replacements = new Map<string, string>();
        for (const element of imageElements) {
            if (replacements.has(element.path)) {
                continue;
            }
            const match = /^data:([^;,]+)(;base64)?,(.*)$/is.exec(element.path);
            const mimeType = match?.[1];
            const payload = match?.[3];
            if (mimeType === undefined || !mimeType.startsWith("image/") || payload === undefined) {
                throw new Error("图片 data URL 格式无效");
            }
            const isBase64 = match?.[2] === ";base64";
            const bytes = isBase64
                ? Buffer.from(payload.replace(/\s/g, ""), "base64")
                : Buffer.from(decodeURIComponent(payload), "utf8");
            if (bytes.length === 0) {
                throw new Error("图片 data URL 内容为空");
            }
            const extension = IMAGE_EXTENSIONS[mimeType.toLowerCase()] ?? ".bin";
            const path = join(directory, `${randomUUID()}${extension}`);
            await writeFile(path, bytes);
            replacements.set(element.path, path);
        }
        return {
            elements: elements.map((element) =>
                element.type === "image" && replacements.has(element.path)
                    ? { ...element, path: replacements.get(element.path) as string }
                    : element,
            ),
            cleanup: async () => {
                await rm(directory, { recursive: true, force: true });
            },
        };
    } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
    }
}

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
