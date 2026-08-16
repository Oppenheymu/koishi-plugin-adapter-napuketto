import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';
import tsParser from '@typescript-eslint/parser';

/**
 * eslint.config.mjs —— 仅针对控制台前端 client/**​/*.vue。
 *
 * 背景：项目用 biome 做 ts/js 的 lint/format，但 biome 不解析 .vue；本配置
 * 用 eslint-plugin-vue 补上 .vue 的模板/组件语义检查，与 biome 零重叠
 * （biome includes 只到 src/**）。核心是 vue/no-undef-components——
 * 根治「组件名大小写写错（<qrcode-panel> vs QrCodePanel）→ 未定义组件」。
 *
 * k-*（k-comment/k-button/k-icon）是 Koishi 控制台全局组件，用 ignorePatterns 放行。
 * 本配置不做类型感知（不接 tsconfig project），保持轻量、稳定。
 */
export default [
  {
    name: 'napuketto/vue',
    files: ['client/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tsParser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: { vue: pluginVue },
    rules: {
      // ── 组件引用 / 未定义（根治大小写坑）──
      'vue/no-undef-components': ['error', { ignorePatterns: ['^K'] }],
      'vue/no-unused-components': 'error',

      // ── 模板指令合法性 ──
      'vue/valid-template-root': 'error',
      'vue/valid-v-bind': 'error',
      'vue/valid-v-cloak': 'error',
      'vue/valid-v-else': 'error',
      'vue/valid-v-else-if': 'error',
      'vue/valid-v-for': 'error',
      'vue/valid-v-html': 'error',
      'vue/valid-v-if': 'error',
      'vue/valid-v-model': 'error',
      'vue/valid-v-on': 'error',
      'vue/valid-v-once': 'error',
      'vue/valid-v-pre': 'error',
      'vue/valid-v-show': 'error',
      'vue/valid-v-slot': 'error',
      'vue/valid-v-text': 'error',

      // ── 编译宏正确性 ──
      'vue/valid-define-props': 'error',
      'vue/valid-define-emits': 'error',
      'vue/valid-define-options': 'error',

      // ── 常见坑 ──
      'vue/no-mutating-props': 'error',
      'vue/no-async-in-computed-properties': 'error',
      'vue/no-side-effects-in-computed-properties': 'error',
      'vue/no-ref-as-operand': 'error',
      'vue/no-use-v-if-with-v-for': 'error',
      'vue/require-v-for-key': 'error',
      'vue/no-dupe-keys': 'error',
      'vue/no-export-in-script-setup': 'error',
    },
  },
];
