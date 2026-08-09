/**
 * elements.ts：koishi 元素 → canonical 元素（纯函数，design.md §5.10）。
 *
 * 与 events/elements.ts（canonical → koishi）对称的反向映射。koishi h() 元素
 * 宽松结构 { type, attrs, children }（不 import koishi 主包）：
 *  - text → { type: "text", text }（attrs.content 优先，children join 兜底）
 *  - br → { type: "text", text: "\n" }
 *  - at → { type: "at", target: attrs.id }（id="all" 原样）
 *  - img/image → { type: "image", path: attrs.src }（koishi 标准元素是 img；本地路径；URL 降级 text）
 *  - face → { type: "face", id: attrs.id }
 *  - audio → { type: "voice", path: attrs.src }（本地路径；URL 降级 text）
 *  - quote → { type: "reply", messageId: attrs.id }
 *  - 其他 → 降级 { type: "text", text: toString() }（保内容不丢）
 * 字符串 content（koishi 允许 sendMessage(channelId, "纯文本")）→ 单 text 元素。
 */
import { fileURLToPath } from "node:url";
import type { CanonicalElement } from "@napuketto/kernel";

/** koishi 元素宽松结构（h() 元素，不 import koishi 主包）。 */
interface LooseElement {
    type: string;
    attrs?: Record<string, unknown>;
    children?: unknown[];
    toString(): string;
}

/** http(s) URL 判断（远程资源需下载后发送，本轮降级 text）。 */
function isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
}

/** file: 协议判断（本地文件 URL，redposter 等用 pathToFileURL 生成）。 */
function isFileUrl(value: string): boolean {
    return /^file:\/\//i.test(value);
}

/** 元素内容 → canonical 数组（数组/单元素/字符串兼容）。 */
export function toCanonicalElements(content: unknown): CanonicalElement[] {
    if (typeof content === "string") {
        return content === "" ? [] : [{ type: "text", text: content }];
    }
    if (Array.isArray(content)) {
        return content.flatMap((item): CanonicalElement[] => toCanonicalElements(item));
    }
    if (isLooseElement(content)) {
        return [toCanonicalElement(content)];
    }
    if (content === undefined || content === null) {
        return [];
    }
    return [{ type: "text", text: String(content) }];
}

/** 宽松结构判断。 */
function isLooseElement(value: unknown): value is LooseElement {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as LooseElement).type === "string"
    );
}

/** attrs.id 取值；空 → null（调用方降级原样文本）。 */
function takeId(attrs: Record<string, unknown>): string | null {
    const id = String(attrs["id"] ?? "");
    return id === "" ? null : id;
}

/** 本地文件路径规范化：Windows 反斜杠 → 正斜杠（NT rich media 契约）。 */
function normalizeMediaPath(path: string): string {
    return path.replace(/\\/g, "/");
}

/** 媒体元素（img/image/audio）：src 空 → 原样文本；URL → 占位文本；本地路径 → canonical 媒体。 */
function mediaElement(
    element: LooseElement,
    attrs: Record<string, unknown>,
    label: "图片" | "语音",
    kind: "image" | "voice",
): CanonicalElement {
    const src = String(attrs["src"] ?? "");
    if (src === "") {
        return { type: "text", text: element.toString() };
    }
    // file:// URL → 转真实本地路径（fileURLToPath），避免带协议前缀透传给
    // wrapper.node 导致 rich media transfer failed（redposter 实证）
    if (isFileUrl(src)) {
        const local = normalizeMediaPath(fileURLToPath(src));
        return kind === "image" ? { type: "image", path: local } : { type: "voice", path: local };
    }
    if (isHttpUrl(src)) {
        return { type: "text", text: `[${label}: ${src}]` };
    }
    // 普通本地路径同样规范化（2026-08-09：redposter 实证 file:// 转路径后仍
    // rich media transfer failed——Windows 反斜杠路径透传给 NT 读不到，
    // 需统一转正斜杠；Electron/Chromium 内部按 URL 语义处理路径）
    const local = normalizeMediaPath(src);
    return kind === "image" ? { type: "image", path: local } : { type: "voice", path: local };
}

/** 元素类型 → 处理器（判别式映射表；未收录类型走默认降级 text）。 */
const elementHandlers: Record<
    string,
    (element: LooseElement, attrs: Record<string, unknown>) => CanonicalElement
> = {
    text: (element, attrs) => {
        // koishi text 元素内容在 attrs.content（napcat 实证），children 兜底
        const content = String(attrs["content"] ?? "");
        const childrenText = element.children?.map(String).join("") ?? "";
        return { type: "text", text: content !== "" ? content : childrenText };
    },
    br: () => ({ type: "text", text: "\n" }),
    at: (element, attrs) => {
        const id = takeId(attrs);
        return id === null
            ? { type: "text", text: element.toString() }
            : { type: "at", target: id };
    },
    img: (element, attrs) => mediaElement(element, attrs, "图片", "image"),
    // koishi 标准图片元素是 img（h("img", ...)），兼容旧 image 写法
    image: (element, attrs) => mediaElement(element, attrs, "图片", "image"),
    face: (element, attrs) => {
        const id = takeId(attrs);
        return id === null ? { type: "text", text: element.toString() } : { type: "face", id };
    },
    audio: (element, attrs) => mediaElement(element, attrs, "语音", "voice"),
    quote: (element, attrs) => {
        const id = takeId(attrs);
        return id === null
            ? { type: "text", text: element.toString() }
            : { type: "reply", messageId: id };
    },
};

/** 单个 koishi 元素 → canonical。 */
function toCanonicalElement(element: LooseElement): CanonicalElement {
    const attrs = element.attrs ?? {};
    // 未识别类型（p/video/file/…）：降级 text（保内容不丢，后续扩充）
    return (
        elementHandlers[element.type]?.(element, attrs) ?? {
            type: "text",
            text: element.toString(),
        }
    );
}
