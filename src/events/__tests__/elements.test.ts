/**
 * elements.test.ts：canonical 元素 → koishi 元素映射单测。
 */

import type { CanonicalElement } from "@napuketto/kernel";
import { describe, expect, it } from "vitest";
import { toKoishiElements } from "../elements.js";
import { mockH } from "../test-utils.js";

describe("toKoishiElements", () => {
    const h = mockH();

    it("text → h.text", () => {
        const elements = toKoishiElements([{ type: "text", text: "你好" }], h);
        expect(String(elements[0])).toContain("你好");
    });

    it("at → h.at（target 原样，all 原样）", () => {
        const at = toKoishiElements([{ type: "at", target: "u_123" }], h);
        expect(String(at[0])).toContain('id="u_123"');

        const all = toKoishiElements([{ type: "at", target: "all" }], h);
        expect(String(all[0])).toContain('id="all"');
    });

    it("image → h('img')（koishi 标准元素；url 优先，path 兜底）", () => {
        const withUrl = toKoishiElements(
            [{ type: "image", path: "/local/1.png", url: "https://x/1.png" }],
            h,
        );
        expect(String(withUrl[0])).toContain("https://x/1.png");
        expect(String(withUrl[0])).toContain("<img");

        const pathOnly = toKoishiElements([{ type: "image", path: "/local/2.png" }], h);
        expect(String(pathOnly[0])).toContain("/local/2.png");
        expect(String(pathOnly[0])).toContain("<img");
    });

    it("face → h('face', { id })", () => {
        const face = toKoishiElements([{ type: "face", id: "178" }], h);
        expect(String(face[0])).toContain('id="178"');
    });

    it("voice → h.audio", () => {
        const voice = toKoishiElements(
            [{ type: "voice", path: "/a.silk", url: "https://x/a.silk" }],
            h,
        );
        expect(String(voice[0])).toContain("https://x/a.silk");
    });

    it("reply → h.quote", () => {
        const reply = toKoishiElements([{ type: "reply", messageId: "12345" }], h);
        expect(String(reply[0])).toContain("12345");
    });

    it("未知元素 → h.text('[type]') 占位", () => {
        const unknown = toKoishiElements([{ type: "unknown", raw: {} } as CanonicalElement], h);
        expect(String(unknown[0])).toContain("[unknown]");
    });

    it("混合元素顺序保留", () => {
        const elements = toKoishiElements(
            [
                { type: "text", text: "早上好" },
                { type: "at", target: "u_1" },
                { type: "text", text: "！" },
            ],
            h,
        );
        const joined = elements.map(String).join("");
        // 顺序保留：text → at → text
        const atIndex = joined.indexOf('<at id="u_1"');
        expect(atIndex).toBeGreaterThan(0);
        expect(atIndex).toBeLessThan(joined.indexOf("<text>！</text>"));
    });
});
