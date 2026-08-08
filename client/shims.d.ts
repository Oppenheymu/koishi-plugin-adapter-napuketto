/**
 * shims.d.ts：前端模块声明补丁。
 *
 * 上游 @koishijs/client 的 global.d.ts（包根目录，含 *.vue 等模块声明）因
 * 5.30.11 exports 映射 bug（"./global" 指向不存在的 ./client/global.d.ts）无法
 * 通过 `types: ["@koishijs/client/global"]` 引用，这里等价自持一份核心声明。
 */
declare module '*.vue' {
    import type { Component } from 'vue';

    const component: Component;
    export default component;
}

declare module '*.yaml' {
    const content: Record<string, unknown>;
    export default content;
}

declare module '*.yml' {
    const content: Record<string, unknown>;
    export default content;
}
