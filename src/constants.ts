/**
 * constants.ts：协议共享常量（napcat 同构约定）。
 *
 * 全模块共用（bot/actions/events 均从此 import，消除各处重复定义）：
 *  - PRIVATE_PREFIX：私聊 channelId 前缀（`private:<uin>`，napcat 同构）
 *  - CHANNEL_TYPE / BOT_STATUS：koishi Universal 协议数值常量
 *    （const enum 被 verbatimModuleSyntax 禁止直接访问，改显式对象）
 */
export const PRIVATE_PREFIX = "private:";

/** Channel.Type：TEXT=0 / DIRECT=1（protocol Channel.Type）。 */
export const CHANNEL_TYPE = { TEXT: 0, DIRECT: 1 } as const;

/** Status：CONNECT=2 / DISCONNECT=3（koishi Bot.status）。 */
export const BOT_STATUS = { CONNECT: 2, DISCONNECT: 3 } as const;
