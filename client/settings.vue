<!--
  settings.vue：NapukettoQQ 扫码登录面板（design.md §5.12）。

  挂在插件详情页（client/index.ts 的 plugin-details slot）。数据源：
  - store['napuketto-login-<uin>']：后端 DataService 推送（状态 + 二维码）
  - send('napuketto-login-<uin>/relogin')：触发重新登录（重启子进程登录流程）
  - send('napuketto-login-<uin>/refresh-qr')：手动刷新二维码（IPC 直达，不重启子进程）

  视觉参照 koishi-plugin-adapter-bilibili-dm（MIT，仅借鉴布局/样式模式）：
  白底卡片二维码 + 过期遮罩 + 图标按钮。纯展示 + 指令上行，零 HTTP 请求。
-->
<template>
  <div v-if="data" class="napuketto-settings">
    <k-comment :type="commentType">
      <!-- idle：未登录/子进程启动中 -->
      <template v-if="data.state === 'idle'">
        <p>{{ data.message || '正在启动登录…' }}</p>
        <k-progress indeterminate />
      </template>

      <!-- waiting_scan：扫码登录（二维码 + 手动刷新；kernel 过期自动推新码） -->
      <template v-else-if="data.state === 'waiting_scan'">
        <div v-if="data.image" class="qrcode-container">
          <img class="qrcode" :src="data.image" alt="NapukettoQQ 登录二维码" />
          <!-- 本地 2 分钟过期遮罩（kernel 过期会自动推新码，新码到达即复位） -->
          <div v-if="qrExpired" class="refresh-overlay">
            <p>二维码已过期</p>
            <k-button @click="refreshQr" :disabled="qrLoading">刷新二维码</k-button>
          </div>
        </div>
        <div v-else class="qrcode-loading">
          <k-icon name="loader" class="rotating" />
          <span>正在获取二维码…</span>
        </div>

        <div class="qrcode-instructions">
          <p>{{ data.message }}</p>
          <p v-if="data.image">请在两分钟内使用手机端扫描并确认登录</p>
        </div>

        <div class="qrcode-actions">
          <k-button @click="refreshQr" :disabled="qrLoading">
            <template v-if="qrLoading">
              <k-icon name="loader" class="rotating" />
              刷新中…
            </template>
            <template v-else>
              <k-icon name="refresh-cw" />
              刷新二维码
            </template>
          </k-button>
          <k-button v-if="data.qr" type="link" @click="openQrUrl">
            <k-icon name="external-link" />
            无法扫码？点此打开登录链接
          </k-button>
        </div>
      </template>

      <!-- scanned：已扫码，待手机确认 -->
      <template v-else-if="data.state === 'scanned'">
        <p>{{ data.message }}</p>
        <k-progress indeterminate />
      </template>

      <!-- logged_in：登录成功 -->
      <template v-else-if="data.state === 'logged_in'">
        <p>
          <k-icon name="check-circle" class="status-icon success" />
          {{ data.message }}
          <template v-if="data.self">：{{ data.self.nick }}（{{ data.self.uin }}）</template>
        </p>
        <k-button class="relogin-button" :disabled="qrLoading" @click="relogin">重新登录</k-button>
      </template>

      <!-- failed：登录失败 -->
      <template v-else-if="data.state === 'failed'">
        <p>{{ data.lastError || data.message }}</p>
        <k-button class="relogin-button" :disabled="qrLoading" @click="relogin">重新登录</k-button>
      </template>
    </k-comment>
  </div>
  <p v-else>登录状态加载中…</p>
</template>

<script setup lang="ts">
import { send, store } from '@koishijs/client';
import { computed, inject, onUnmounted, ref, watch } from 'vue';

/** 登录状态（对齐 kernel LoginState 与后端推送结构）。 */
type LoginState = 'idle' | 'waiting_scan' | 'scanned' | 'logged_in' | 'failed';

/** 后端推送的登录面板数据结构（store['napuketto-login-<uin>']）。 */
interface LoginPanelData {
  state: LoginState;
  message?: string;
  /** 二维码完整 data URI（waiting_scan 时有；直接 <img :src> 展示）。 */
  image?: string;
  /** state=waiting_scan 时有。 */
  qr?: { pngBase64: string; qrcodeUrl: string };
  /** state=logged_in 时有。 */
  self?: { nick: string; uin: string };
  lastError?: string;
}

/** 二维码有效期（毫秒，与提示文案「两分钟内」一致）。 */
const QR_EXPIRY_MS = 2 * 60 * 1000;

/** 插件名（package.json name，插件详情页校验用）。 */
const PLUGIN_NAME = 'koishi-plugin-adapter-napuketto';
/** DataService serviceId 前缀（与后端 src/console/provider.ts 对齐）。 */
const SERVICE_PREFIX = 'napuketto-login';

// ── 插件详情页上下文注入（识别当前查看的插件实例 + 配置） ──

const local = inject('manager.settings.local', ref({ name: '' }));
const config = inject('manager.settings.config', ref({}));
const current = inject('manager.settings.current', ref({}));

/** 后端推送的登录面板数据（store['napuketto-login-<uin>']，Vue 响应式）。 */
const data = computed<LoginPanelData | null>(() =>
{
  // 1. 校验当前插件名称匹配
  if (!local.value || local.value.name !== PLUGIN_NAME) return null;
  // 2. 禁用实例不显示（disabled 在 manager.settings.current 上，config 里拿不到）
  if ((current.value as { disabled?: boolean })?.disabled === true) return null;
  // 3. 从配置拿 selfId（多账号隔离：serviceId 按 uin 区分）
  const selfId = (config.value as { selfId?: string })?.selfId;
  if (!selfId) return null;
  // 4. 从全局 store 按 serviceId 取后端推送的数据
  const serviceData = (store as Record<string, unknown>)[`${SERVICE_PREFIX}-${selfId}`];
  return serviceData !== undefined && typeof serviceData === 'object'
    ? (serviceData as LoginPanelData)
    : null;
});

/** 刷新二维码按钮 loading 态。 */
const qrLoading = ref(false);
/** 二维码过期遮罩（本地计时，kernel 自动推新码即复位）。 */
const qrExpired = ref(false);
/** 过期计时器。 */
let qrTimer: number | null = null;

/** 面板提示色（k-comment type）。 */
const commentType = computed(() =>
{
  const state = data.value?.state;
  if (state === 'logged_in') return 'success';
  if (state === 'failed') return 'error';
  return 'info';
});

// ── 二维码过期计时（B站模板同款：2 分钟遮罩；kernel 过期自动推新码即复位） ──

function startQrExpiryTimer(): void
{
  clearQrExpiryTimer();
  qrExpired.value = false;
  qrTimer = window.setTimeout(() =>
  {
    qrExpired.value = true;
  }, QR_EXPIRY_MS) as unknown as number;
}

function clearQrExpiryTimer(): void
{
  if (qrTimer !== null) {
    window.clearTimeout(qrTimer);
    qrTimer = null;
  }
}

onUnmounted(() =>
{
  clearQrExpiryTimer();
});

// 进入 waiting_scan：复位 loading + 启动过期计时
watch(
  () => data.value?.state,
  (state) =>
  {
    if (state === 'waiting_scan') {
      qrLoading.value = false;
      startQrExpiryTimer();
    } else {
      clearQrExpiryTimer();
      qrExpired.value = false;
    }
  },
  { immediate: true },
);

// 新二维码到达（首次 / 手动刷新 / kernel 过期自动推新码）→ 复位 loading + 重启计时
watch(
  () => data.value?.qr?.pngBase64,
  () =>
  {
    qrLoading.value = false;
    if (data.value?.state === 'waiting_scan') {
      startQrExpiryTimer();
    }
  },
);

// ── 指令上行：重新登录 / 刷新二维码 ──

function currentSelfId(): string
{
  return (config.value as { selfId?: string })?.selfId ?? '';
}

function relogin(): void
{
  const selfId = currentSelfId();
  if (!selfId) return;
  qrLoading.value = true;
  // 后端 NapukettoLoginProvider 注册的 console 事件（WebSocket）
  send(`${SERVICE_PREFIX}-${selfId}/relogin`, { selfId });
}

function refreshQr(): void
{
  const selfId = currentSelfId();
  if (!selfId) return;
  qrLoading.value = true;
  qrExpired.value = false;
  // 后端 NapukettoLoginProvider 注册的 refresh-qr 事件 → IPC login.refreshQr（不重启子进程）
  send(`${SERVICE_PREFIX}-${selfId}/refresh-qr`, { selfId });
  // 兜底：刷新失败 / 无新二维码时 3s 后复位 loading
  setTimeout(() =>
  {
    qrLoading.value = false;
  }, 3000);
}

/** 新窗口打开登录链接（无法扫码时兜底）。 */
function openQrUrl(): void
{
  const url = data.value?.qr?.qrcodeUrl;
  if (url) {
    window.open(url, '_blank', 'noopener');
  }
}
</script>

<style lang="scss" scoped>
.napuketto-settings
{
  padding: 0;
  margin-top: -1rem; // 顶部间距
  margin-bottom: -1rem; // 底部间距

  .qrcode-container
  {
    position: relative;
    display: inline-block;
    margin: 0.5rem 0 0.35rem;
    border: 1px solid #eee;
    padding: 10px;
    border-radius: 8px;
    background-color: white;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .qrcode
  {
    display: block;
    max-width: 200px;
    image-rendering: pixelated;
  }

  .qrcode-loading
  {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0.5rem 0;

    .rotating
    {
      font-size: 1.2rem;
    }
  }

  .refresh-overlay
  {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.7);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    color: white;
    border-radius: 8px;

    p
    {
      margin: 0 0 0.5rem;
    }
  }

  .qrcode-instructions
  {
    margin-bottom: 0.75rem;

    p
    {
      margin: 0.25rem 0;
    }
  }

  .qrcode-actions
  {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .status-icon
  {
    margin-right: 0.25rem;

    &.success
    {
      color: #52c41a;
    }
  }

  .relogin-button
  {
    border-width: 2px;
    margin-top: 0.5rem;
  }

  .k-progress
  {
    margin-top: 1rem;
  }

  .rotating
  {
    animation: rotate 1s linear infinite;
  }

  @keyframes rotate
  {
    from
    {
      transform: rotate(0deg);
    }

    to
    {
      transform: rotate(360deg);
    }
  }
}
</style>
