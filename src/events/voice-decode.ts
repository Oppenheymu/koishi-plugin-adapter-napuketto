/**
 * voice-decode.ts：收方向语音解码（2026-09-08 T6）。
 *
 * QQ 语音是 silk v3，canonical voice.path 是 NT 相对路径（nt_data/Ptt/…）——
 * 直接透传给 koishi h.audio 既不可解析也不可播放。此处：
 *  1. NT 相对路径按候选基准解析为本地 silk 文件（绝对路径直用；
 *     基准 = homedir/Documents/Tencent Files/nt_qq/global，与 kernel
 *     wrapper-loader 的数据根兜底同口径）
 *  2. decodeSilkToWav 解为 WAV 落 tmpdir（通用可播放格式）
 *  3. 全程 fail-soft：解析不到/解码失败原样透传（与现状等价，不阻塞消息）
 *
 * ⚠️ WAV 落 tmpdir（napuketto-voice/）不清理——消费方（koishi 平台适配器/控制台）
 * 拉取时机不确定，由 OS 临时目录机制兜底回收；高频语音场景的清理策略待后续。
 */
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { CanonicalElement } from "@napuketto/kernel";
import { decodeSilkToWav } from "@napuketto/media";

/** 收向语音 WAV 输出目录（tmpdir 下固定子目录，mkdirSync 保证存在）。 */
const VOICE_OUT_DIR = join(tmpdir(), "napuketto-voice");

/** NT 相对路径解析候选基准（QQ 用户数据根，kernel 兜底同口径）。 */
function ntBaseCandidates(): string[] {
    return [join(homedir(), "Documents", "Tencent Files", "nt_qq", "global")];
}

/** 解析 NT 相对/绝对路径到存在的本地文件（未命中返回 null）。 */
export function resolveNtFile(relPath: string): string | null {
    if (relPath === "") {
        return null;
    }
    if (existsSync(relPath)) {
        return relPath;
    }
    const normalized = relPath.replaceAll("\\", "/");
    for (const base of ntBaseCandidates()) {
        const joined = join(base, normalized);
        if (existsSync(joined)) {
            return joined;
        }
    }
    return null;
}

/** 单个 voice 元素 → 可播放 WAV 路径（fail-soft：任何失败原样返回）。 */
async function toPlayableVoice(path: string): Promise<string> {
    const silk = resolveNtFile(path);
    if (silk === null) {
        return path;
    }
    try {
        const { wavPath } = await decodeSilkToWav(silk, { outDir: VOICE_OUT_DIR });
        return wavPath;
    } catch {
        // 非 silk / 解码失败：原样透传
        return path;
    }
}

/**
 * 收方向元素富化：voice 元素的 NT silk 路径 → 本地 WAV（异步，bridge 派发前调用）。
 * 非 voice 元素与远程/空路径原样返回。
 */
export async function enrichReceiveVoice(
    elements: CanonicalElement[],
): Promise<CanonicalElement[]> {
    const out: CanonicalElement[] = [];
    for (const el of elements) {
        if (
            el.type === "voice" &&
            el.path !== "" &&
            !/^https?:\/\//i.test(el.path) &&
            !/^data:/i.test(el.path)
        ) {
            out.push({ ...el, path: await toPlayableVoice(el.path) });
            continue;
        }
        out.push(el);
    }
    return out;
}
