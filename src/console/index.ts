/**
 * index.ts：控制台登录面板出口（barrel）。
 *
 * 只 re-export 有外部消费者的符号（bot.ts 使用）——2026-08-14 收窄：
 * LOGIN_SERVICE_PREFIX/RELOGIN_EVENT_SUFFIX/REFRESH_QR_EVENT_SUFFIX 与
 * reloginEventName/refreshQrEventName/LoginPanelOptions 仅内部使用
 * （fallow dead-code 清理，去 export 保内部引用）。
 */
export { toLoginPanelPayload } from "./payload.js";
export { loginServiceId, NapukettoLoginProvider } from "./provider.js";
