/**
 * subscribers.ts：通用订阅集合（transport / test-utils 共享）。
 *
 * transport.ts（ChildProcessIpcTransport）与 test-utils.ts（MemoryLinePair）
 * 的 onLine/onClose/close 处理逻辑完全同构——提取本类消除重复：
 *  - add 返回退订函数（幂等删除）
 *  - dispatch 快照遍历（回调内增删订阅不影响本次通知）
 *  - clear 清空全部订阅
 */
export class SubscriberSet<T extends unknown[]> {
    private readonly handlers = new Set<(...args: T) => void>();

    /** 订阅；返回退订函数。 */
    add(handler: (...args: T) => void): () => void {
        this.handlers.add(handler);
        return () => {
            this.handlers.delete(handler);
        };
    }

    /** 通知全部订阅者（快照遍历，允许回调内退订）。 */
    dispatch(...args: T): void {
        for (const handler of [...this.handlers]) {
            handler(...args);
        }
    }

    /** 清空订阅。 */
    clear(): void {
        this.handlers.clear();
    }
}
