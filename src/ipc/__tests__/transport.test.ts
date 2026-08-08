/**
 * transport.test.ts：BaseLineTransport 单测。
 *
 * 用最小子类 TestTransport 覆盖基类职责：dispatchLine 分发、
 * onLine/onClose 订阅与退订、close 幂等、closed 状态屏蔽、
 * onClosed 钩子（一次）。write 属子类职责（抽象方法），不在基类测试范围。
 */
import { describe, expect, it } from "vitest";
import { BaseLineTransport } from "../transport.js";

/** 最小测试子类：暴露 dispatchLine 钩子 + 记录 onClosed 调用。 */
class TestTransport extends BaseLineTransport {
    readonly written: string[] = [];
    closedHookCalls = 0;

    write(line: string): void {
        this.written.push(line);
    }

    /** 测试辅助：模拟数据源收到一行。 */
    receive(line: string): void {
        this.dispatchLine(line);
    }

    protected override onClosed(): void {
        this.closedHookCalls += 1;
    }
}

describe("BaseLineTransport", () => {
    it("onLine 订阅 → dispatchLine 分发", () => {
        const transport = new TestTransport();
        const received: string[] = [];
        transport.onLine((line) => {
            received.push(line);
        });
        transport.receive("a");
        transport.receive("b");
        expect(received).toEqual(["a", "b"]);
    });

    it("onLine 退订后不再收到", () => {
        const transport = new TestTransport();
        const received: string[] = [];
        const unsubscribe = transport.onLine((line) => {
            received.push(line);
        });
        transport.receive("a");
        unsubscribe();
        transport.receive("b");
        expect(received).toEqual(["a"]);
    });

    it("onClose 订阅 → close 时通知", () => {
        const transport = new TestTransport();
        let closed = 0;
        transport.onClose(() => {
            closed += 1;
        });
        transport.close();
        expect(closed).toBe(1);
    });

    it("close 幂等：第二次 close 不重复触发 onClose / onClosed", () => {
        const transport = new TestTransport();
        let closed = 0;
        transport.onClose(() => {
            closed += 1;
        });
        transport.close();
        transport.close(); // 第二次应为 no-op
        expect(closed).toBe(1);
        expect(transport.closedHookCalls).toBe(1);
    });

    it("close 后 dispatchLine 忽略（不再通知 onLine 订阅者）", () => {
        const transport = new TestTransport();
        const received: string[] = [];
        transport.onLine((line) => {
            received.push(line);
        });
        transport.receive("a");
        transport.close();
        transport.receive("b"); // closed 后应被丢弃
        expect(received).toEqual(["a"]);
    });

    it("onClosed 钩子在 close 时调用一次（资源清理）", () => {
        const transport = new TestTransport();
        expect(transport.closedHookCalls).toBe(0);
        transport.close();
        expect(transport.closedHookCalls).toBe(1);
    });

    it("write 直达子类实现（基类不拦截）", () => {
        const transport = new TestTransport();
        transport.write("line1");
        transport.write("line2");
        expect(transport.written).toEqual(["line1", "line2"]);
    });
});
