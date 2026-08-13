/**
 * index.ts：控制台登录面板出口（barrel）。
 */
export { loginStateMessage, toLoginPanelPayload } from "./payload.js";
export type { LoginPanelOptions } from "./provider.js";
export {
    LOGIN_SERVICE_PREFIX,
    loginServiceId,
    NapukettoLoginProvider,
    REFRESH_QR_EVENT_SUFFIX,
    RELOGIN_EVENT_SUFFIX,
    refreshQrEventName,
    reloginEventName,
} from "./provider.js";
export type { LoginPanelPayload } from "./types.js";
