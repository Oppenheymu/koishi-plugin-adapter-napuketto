/**
 * index.ts：数据库操作集中管理（design.md §5.13）。
 *
 * 背景：插件此前无自有数据库操作——channel/user 落库全在 koishi 框架内部
 * （Session.getChannel）。而 koishi 的 getChannel 是 check-then-act：先 SELECT，
 * 未命中才 createChannel（INSERT）。多条消息同 tick dispatch（QQ 批量推送 + 群通知
 * 高频事件）时，各 session 的 SELECT 全部先于首个 INSERT 完成 → 多个 INSERT 撞
 * (id, platform) 唯一键（2026-08-09 实测：同批 4 条消息 → 1 成功 + 3 次
 * `UNIQUE constraint failed: channel.id, channel.platform`）。过滤系统占位消息
 * （senderUin="0"）只能消除系统场景，真实消息批量到达仍会触发。
 *
 * 本模块在 dispatch 前原子预热 channel：命中直接返回；未命中走 minato upsert
 * （INSERT ... ON CONFLICT DO UPDATE，并发安全幂等不抛错）。预热后 koishi 的
 * getChannel SELECT 必命中，永远走不到 createChannel——从根上消除竞态。
 * 预热失败只单次告警不阻断消息（koishi get-or-create 兜底）。
 *
 * ⚠️ 框架侧根因已上报：koishijs/koishi#1545（getChannel check-then-act 无原子性）；
 * 本模块为插件侧临时规避（根治待框架修复，届时本模块可降级/移除）。
 */

import type { Context } from "koishi";

/** channel 预热字段（dispatch 前 session 字段子集）。 */
export interface EnsureChannelData {
    platform: string;
    id: string;
    /** 群号（群聊 channel 有；私聊/临时会话可缺省）。 */
    guildId?: string;
    /** 受理人（autoAssign 语义下为 selfId；缺省不写）。 */
    assignee?: string;
}

/** 数据库操作集中管理（无全局单例，每 bot 实例一份）。 */
export class NapukettoDatabase {
    /** per-channel 串行链（key = `platform:id`；不同 channel 并行）。 */
    private readonly chains = new Map<string, Promise<void>>();
    /** 降级/失败告警已打标记（每实例只打一次，防刷屏）。 */
    private warned = false;

    constructor(private readonly ctx: Context) {}

    /**
     * 原子预热 channel（dispatch 前调用）。
     *
     * 同 channel 串行排队（保证消息 dispatch 顺序与预热顺序一致），不同 channel
     * 并行。返回 promise 在预热完成（或降级跳过）后 resolve，绝不 reject。
     */
    ensureChannel(data: EnsureChannelData): Promise<void> {
        const key = `${data.platform}:${data.id}`;
        const prev = this.chains.get(key) ?? Promise.resolve();
        // 前序失败（理论上不会 reject，防御兜底）不阻塞后续排队
        const next = prev.catch(() => undefined).then(() => this.runEnsure(data));
        this.chains.set(key, next);
        // 链尾完成后清理（无新任务排队时删除引用，防 Map 无限增长）
        void next.finally(() => {
            if (this.chains.get(key) === next) {
                this.chains.delete(key);
            }
        });
        return next;
    }

    /** 实际预热：命中即返回；未命中 upsert（幂等，并发安全）。 */
    private async runEnsure(data: EnsureChannelData): Promise<void> {
        const db = this.ctx.database;
        if (db === undefined) {
            this.warnOnce("ctx.database 不可用，跳过 channel 预热（koishi 兜底）");
            return;
        }
        try {
            const existing = await db.get("channel", { id: data.id, platform: data.platform }, [
                "id",
            ]);
            if (existing.length > 0) {
                return; // 已存在：koishi getChannel 必命中，无需写入
            }
            await db.upsert(
                "channel",
                [
                    {
                        id: data.id,
                        platform: data.platform,
                        // exactOptionalPropertyTypes：可选字段条件展开
                        ...(data.guildId !== undefined ? { guildId: data.guildId } : {}),
                        ...(data.assignee !== undefined ? { assignee: data.assignee } : {}),
                        // createdAt 只随新行携带；已存在行 upsert 只 merge 业务字段
                        createdAt: new Date(),
                    },
                ],
                ["id", "platform"],
            );
        } catch (error) {
            // 预热失败不阻断消息（koishi get-or-create 兜底）；单次告警防刷屏
            this.warnOnce(
                `channel 预热失败（${data.platform}:${data.id}）: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
    }

    /** 单次告警（防同因刷屏；失败原因变化时不再重复提示，可接受）。 */
    private warnOnce(message: string): void {
        if (this.warned) {
            return;
        }
        this.warned = true;
        // 无 logger 实例：走 ctx.logger（koishi 统一日志）
        this.ctx.logger("napuketto").warn(message);
    }
}
