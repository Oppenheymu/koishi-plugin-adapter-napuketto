/**
 * constants.ts：协议共享常量（napcat 同构约定）。
 *
 * 全模块共用（bot/actions/events 均从此 import，消除各处重复定义）：
 *  - PRIVATE_PREFIX：私聊 channelId 前缀（`private:<uin>`，napcat 同构）
 *  - BOT_STATUS：koishi Bot 状态数值常量（Status：CONNECT=2 / DISCONNECT=3）
 */
export const PRIVATE_PREFIX = "private:";

/** Status：CONNECT=2 / DISCONNECT=3（koishi Bot.status）。 */
export const BOT_STATUS = { CONNECT: 2, DISCONNECT: 3 } as const;
