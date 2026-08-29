/**
 * index.ts：事件桥出口（barrel）。
 */
export { adaptRawMessage } from "./adapt.js";
export { NapukettoEventBridge } from "./bridge.js";
export { toKoishiElements } from "./elements.js";
export type {
    EventBridge,
    EventBridgeOptions,
    NapukettoSessionFields,
    Ob11EventPayload,
} from "./types.js";
