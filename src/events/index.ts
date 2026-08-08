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
} from "./types.js";
