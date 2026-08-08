/**
 * index.ts：koishi-plugin-adapter-napuketto 插件入口。
 *
 * 默认导出 NapukettoBot（koishi Bot 子类）——koishi 自动 `ctx.platform('napuketto', ...)`
 * 注册平台，按用户 bots 配置（`bots: { 'napuketto:<uin>': {...} }`）实例化；
 * Bot 构造自动注册 `ctx.on('ready', () => this.start())` → start() spawn 自建宿主
 * 子进程（driver → IPC）→ 登录 → 事件桥/动作桥装配。
 *
 * 运行时 import koishi（Session 声明扩展）——本文件不进单测（HANDOVER §7 坑 1）。
 */
import { NapukettoBot } from "./bot/index.js";
import { napukettoConfigSchema as Config } from "./config.js";

export * from "./actions/index.js";
export * from "./bot/index.js";
export * from "./events/index.js";

/** 插件名。 */
export const name = "adapter-napuketto";

export const usage = `
<div style="border-radius: 10px; border: 1px solid #ddd; padding: 16px; margin-bottom: 20px; box-shadow: 0 2px 5px rgba(0,0,0,0.1);">
  <h2 style="margin-top: 0; color: #4a6ee0;">🖥️ NapukettoQQ 适配器</h2>
  <p>自研 QQ NT <strong>wrapper.node</strong> 协议层，无需 NapCat。</p>
  <p>每个 <code>bots</code> 配置项启动一个自建宿主子进程（dlopen wrapper.node + stub
  QQNT.dll），经 IPC 与 koishi 通信。配置 <code>selfId</code> 为登录 QQ 号即可。</p>
</div>
`;

// NapukettoBot 经 export * from "./bot/index.js" 已导出；这里只补 Config
// （bot.ts namespace 声明合并成员，不走 barrel 链）。
export { Config };

export default NapukettoBot;
