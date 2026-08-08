/**
 * elements.ts：canonical 元素 → koishi 元素（纯函数，design.md §5.9）。
 *
 * 元素映射（canonical → koishi）：
 *  - text → h.text
 *  - at → h.at（target "all" 原样）
 *  - image → h.image（url 优先，path 兜底）
 *  - face → h("face", { id })
 *  - voice → h.audio（url 优先，path 兜底）
 *  - reply → h.quote
 *  - 其他 → h.text("[type]") 占位
 *
 * h 依赖注入：生产环境 apply() 传 koishi 的 `h`；单测传内存 mock
 * （koishi 主包 import 会初始化 loader，单测环境崩溃）。
 */
import type { CanonicalElement } from "@napuketto/kernel";

/** koishi h() 工厂最小面（type/attrs → 元素；单测用 mock 实现）。 */
export type HFn = (
    type: string,
    attrs?: Record<string, unknown>,
    ...children: unknown[]
) => { type: string; attrs: Record<string, unknown>; toString(): string };

/** canonical 元素 → koishi 元素（数组）。 */
export function toKoishiElements(elements: CanonicalElement[], h: HFn): unknown[] {
    return elements.map((element) => toKoishiElement(element, h));
}

/** 单个 canonical 元素 → koishi 元素。 */
function toKoishiElement(element: CanonicalElement, h: HFn): unknown {
    switch (element.type) {
        case "text":
            return h("text", {}, element.text);
        case "at":
            return h("at", { id: element.target });
        case "image":
            return h("image", { src: element.url ?? element.path });
        case "face":
            return h("face", { id: element.id });
        case "voice":
            return h("audio", { src: element.url ?? element.path });
        case "reply":
            return h("quote", { id: element.messageId });
        default:
            // video/file/forward/json/xml/unknown：占位（后续扩充）
            return h("text", {}, `[${element.type}]`);
    }
}

/** koishi h() 工厂适配（apply() 层用：koishi 的 `h` 包一层）。 */
export function bindKoishiH(
    koishiH: (type: unknown, attrs?: unknown, ...children: unknown[]) => unknown,
): HFn {
    return (type, attrs, ...children) => {
        const element = koishiH(type, attrs, ...children) as {
            type: string;
            attrs: Record<string, unknown>;
            toString(): string;
        };
        return element;
    };
}
