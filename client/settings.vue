<!--
  settings.vue：NapukettoQQ 扫码登录面板（design.md §5.12）。

  挂在插件详情页（client/index.ts 的 plugin-details slot）。数据源：
  - store['napuketto-login-<uin>']：后端 DataService 推送（状态 + 二维码）
  - send('napuketto-login-<uin>/relogin')：触发重新登录（重启子进程登录流程）
  - send('napuketto-login-<uin>/refresh-qr')：手动刷新二维码（IPC 直达，不重启子进程）

  纯展示 + 指令上行，零 HTTP 请求（koishi console WebSocket 通道）。
-->
<template>
  <k-comment v-if="data" :type="commentType">
    <!-- idle：未登录/子进程启动中 -->
    <template v-if="data.state === 'idle'">
      <p>{{ data.message || '正在启动登录…' }}</p>
      <k-progress indeterminate />
    </template>

    <!-- waiting_scan：扫码登录（二维码 + 手动刷新；kernel 过期自动推新码） -->
    <template v-else-if="data.state === 'waiting_scan'">
      <p>{{ data.message }}</p>
      <div v-if="data.qr" class="qrcode-container">
        <img class="qrcode" :src="qrSrc" alt="NapukettoQQ 登录二维码" />
      </div>
      <p v-else>正在获取二维码…</p>
      <p v-if="data.qr" class="hint">请在两分钟内使用手机端扫描并确认登录</p>
      <k-button :disabled="qrLoading" @click="refreshQr">刷新二维码</k-button>
      <p v-if="data.qr" class="hint">
        <a :href="data.qr.qrcodeUrl" target="_blank" rel="noopener">无法扫码？点此打开登录链接</a>
      </p>
    </template>

    <!-- scanned：已扫码，待手机确认 -->
    <template v-else-if="data.state === 'scanned'">
      <p>{{ data.message }}</p>
      <k-progress indeterminate />
    </template>

    <!-- logged_in：登录成功 -->
    <template v-else-if="data.state === 'logged_in'">
      <p>
        {{ data.message }}
        <template v-if="data.self">：{{ data.self.nick }}（{{ data.self.uin }}）</template>
      </p>
    </template>

    <!-- failed：登录失败 -->
    <template v-else-if="data.state === 'failed'">
      <p>{{ data.lastError || data.message }}</p>
      <k-button :disabled="qrLoading" @click="relogin">重新登录</k-button>
    </template>
  </k-comment>
  <p v-else>登录状态加载中…</p>
</template>

<script setup lang="ts">
import { send, store } from '@koishijs/client';
import { computed, inject, ref, watch } from 'vue';

/** 登录状态（对齐 kernel LoginState 与后端推送结构）。 */
type LoginState = 'idle' | 'waiting_scan' | 'scanned' | 'logged_in' | 'failed';

/** 后端推送的登录面板数据结构（store['napuketto-login-<uin>']）。 */
interface LoginPanelData {
  state: LoginState;
  message?: string;
  /** state=waiting_scan 时有。 */
  qr?: { pngBase64: string; qrcodeUrl: string };
  /** state=logged_in 时有。 */
  self?: { nick: string; uin: string };
  lastError?: string;
}

/** 插件名（package.json name，插件详情页校验用）。 */
const PLUGIN_NAME = 'koishi-plugin-adapter-napuketto';
/** DataService serviceId 前缀（与后端 src/console/provider.ts 对齐）。 */
const SERVICE_PREFIX = 'napuketto-login';

// ── 插件详情页上下文注入（识别当前查看的插件实例 + 配置） ──

const local = inject('manager.settings.local', ref({ name: '' }));
const config = inject('manager.settings.config', ref({}));

/** 后端推送的登录面板数据（store['napuketto-login-<uin>']，Vue 响应式）。 */
const data = computed<LoginPanelData | null>(() =>
{
  // 1. 校验当前插件名称匹配
  if (!local.value || local.value.name !== PLUGIN_NAME) return null;
  // 2. 禁用实例不显示
  if ((config.value as { disabled?: boolean })?.disabled === true) return null;
  // 3. 从配置拿 selfId（多账号隔离：serviceId 按 uin 区分）
  const selfId = (config.value as { selfId?: string })?.selfId;
  if (!selfId) return null;
  // 4. 从全局 store 按 serviceId 取后端推送的数据
  const serviceData = (store as Record<string, unknown>)[`${SERVICE_PREFIX}-${selfId}`];
  return serviceData !== undefined && typeof serviceData === 'object'
    ? (serviceData as LoginPanelData)
    : null;
});

/** 二维码 data URI（pngBase64 → data:image/png;base64,...）。 */
const qrSrc = computed(() =>
{
  const pngBase64 = data.value?.qr?.pngBase64;
  if (!pngBase64) return '';
  return `data:image/png;base64,${pngBase64}`;
});

/** 刷新二维码按钮 loading 态。 */
const qrLoading = ref(false);

/** 面板提示色（k-comment type）。 */
const commentType = computed(() =>
{
  const state = data.value?.state;
  if (state === 'logged_in') return 'success';
  if (state === 'failed') return 'error';
  return 'info';
});

// ── 状态监听：进入 waiting_scan 复位刷新 loading；新二维码到达复位 loading ──

watch(
  () => data.value?.state,
  (state) =>
  {
    if (state === 'waiting_scan') {
      qrLoading.value = false;
    }
  },
  { immediate: true },
);

// 新二维码到达（首次 / 手动刷新 / kernel 过期自动推新码）→ 复位刷新 loading
watch(
  () => data.value?.qr?.pngBase64,
  () =>
  {
    qrLoading.value = false;
  },
);

// ── 指令上行：重新登录 / 刷新二维码 ──

function relogin(): void
{
  const selfId = (config.value as { selfId?: string })?.selfId;
  if (!selfId) return;
  qrLoading.value = true;
  // 后端 NapukettoLoginProvider 注册的 console 事件（WebSocket）
  send(`${SERVICE_PREFIX}-${selfId}/relogin`, { selfId });
}

function refreshQr(): void
{
  const selfId = (config.value as { selfId?: string })?.selfId;
  if (!selfId) return;
  qrLoading.value = true;
  // 后端 NapukettoLoginProvider 注册的 refresh-qr 事件 → IPC login.refreshQr（不重启子进程）
  send(`${SERVICE_PREFIX}-${selfId}/refresh-qr`, { selfId });
  // 兜底：刷新失败 / 无新二维码时 3s 后复位 loading
  setTimeout(() =>
  {
    qrLoading.value = false;
  }, 3000);
}
</script>

<style scoped>
.qrcode-container
{
  position: relative;
  display: inline-block;
  margin: 8px 0;
}

.qrcode
{
  width: 200px;
  height: 200px;
  border-radius: 8px;
  background: #fff;
}

.hint
{
  font-size: 12px;
  opacity: 0.6;
  margin-top: 4px;
}
</style>
