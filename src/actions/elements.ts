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
import type { CanonicalElement } from "@napuketto/kernel";

/** koishi 元素宽松结构（h() 元素，不 import koishi 主包）。 */
export interface LooseElement {
    type: string;
    attrs?: Record<string, unknown>;
    children?: unknown[];
    toString(): string;
}

/** http(s) URL 判断（远程资源需下载后发送，本轮降级 text）。 */
function isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
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

/** 单个 koishi 元素 → canonical。 */
function toCanonicalElement(element: LooseElement): CanonicalElement {
    const attrs = element.attrs ?? {};
    switch (element.type) {
        case "text": {
            // koishi text 元素内容在 attrs.content（napcat 实证），children 兜底
            const content = String(attrs["content"] ?? "");
            const childrenText = element.children?.map(String).join("") ?? "";
            const text = content !== "" ? content : childrenText;
            return { type: "text", text };
        }
        case "br":
            return { type: "text", text: "\n" };
        case "at": {
            const id = String(attrs["id"] ?? "");
            return id === ""
                ? { type: "text", text: element.toString() }
                : { type: "at", target: id };
        }
        case "img":
        case "image": {
            // koishi 标准图片元素是 img（h("img", ...)），兼容旧 image 写法
            const src = String(attrs["src"] ?? "");
            if (src === "") {
                return { type: "text", text: element.toString() };
            }
            return isHttpUrl(src)
                ? { type: "text", text: `[图片: ${src}]` } // URL 需下载后发送（后续轮次）
                : { type: "image", path: src };
        }
        case "face": {
            const id = String(attrs["id"] ?? "");
            return id === "" ? { type: "text", text: element.toString() } : { type: "face", id };
        }
        case "audio": {
            const src = String(attrs["src"] ?? "");
            if (src === "") {
                return { type: "text", text: element.toString() };
            }
            return isHttpUrl(src)
                ? { type: "text", text: `[语音: ${src}]` }
                : { type: "voice", path: src };
        }
        case "quote": {
            const id = String(attrs["id"] ?? "");
            return id === ""
                ? { type: "text", text: element.toString() }
                : { type: "reply", messageId: id };
        }
        default:
            // p/br/video/file/…：降级 text（保内容不丢，后续扩充）
            return { type: "text", text: element.toString() };
    }
}
