import { isKernelError, KernelError } from "@napuketto/kernel";
import { type Context, Schema } from "koishi";

export const name = "adapter-napuketto";

export const usage = `
<div style="border-radius: 10px; border: 1px solid #ddd; padding: 16px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
  <h2 style="margin-top: 0; color: #4a6ee0;">🖥️ NapukettoQQ 适配器</h2>
  <p>自研 QQ NT <strong>wrapper.node</strong> 协议层，无需 NapCat。</p>
  <p>当前为骨架阶段，正式对接层（loader 自建宿主 + 事件翻译）开发中。</p>
</div>
`;

/** 插件配置（骨架占位）：正式对接层落地后扩展（loader 子进程 + IPC 桥 + 事件翻译）。 */
export interface Config {
    /** QQ 号（数据目录账号隔离，ADR-016）。 */
    selfId?: string;
    /** 数据根目录；缺省走 kernel 默认解析（resolveDataRoot）。 */
    dataDir?: string;
}

export const Config: Schema<Config> = Schema.object({
    selfId: Schema.string().description("QQ 号（数据目录账号隔离）"),
    dataDir: Schema.string().description("数据根目录（缺省自动解析）"),
});

/**
 * 插件入口（骨架阶段）：
 * 验证 koishi 能加载「bundle 了 @napuketto/* 的 CJS 产物」——这是嵌入式
 * 链路的地基。正式对接层（loader 自建宿主子进程 + IPC 桥 + adapter core
 * 事件翻译）在骨架验证通过后铺设。
 */
export function apply(ctx: Context, config: Config): void {
    ctx.logger.info(
        "[adapter-napuketto] 插件已加载（骨架），selfId=%s",
        config.selfId ?? "(未配置)",
    );

    // 链路验证：@napuketto/kernel 已被 bundle 进产物且符号可调用
    const error = new KernelError("skeleton: kernel 已成功 bundle 进插件产物");
    ctx.logger.debug(
        "[adapter-napuketto] kernel 符号可用：%s（isKernelError=%s）",
        error.message,
        isKernelError(error),
    );
}
