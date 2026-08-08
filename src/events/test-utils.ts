/**
 * test-utils.ts：事件桥测试共享设施——内存 mock h() 工厂。
 *
 * koishi 主包 import 会初始化 loader（vitest 环境崩溃），因此测试用 mock h：
 * 产出 { type, attrs, children, toString } 形状，验证元素映射正确。
 */
import type { HFn } from "./elements.js";

/** 内存 h() 工厂（koishi h 的宽松替代）。 */
export function mockH(): HFn {
    return (type, attrs = {}, ...children) => {
        const attrsStr = Object.entries(attrs)
            .map(([key, value]) => ` ${key}="${String(value)}"`)
            .join("");
        const content = children.map((child) => String(child)).join("");
        return {
            type,
            attrs,
            toString: () => `<${type}${attrsStr}>${content}</${type}>`,
        };
    };
}
