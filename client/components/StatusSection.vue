<!--
  StatusSection.vue：登录状态信息面板（settings.vue 拆出，design.md §5.12）。

  展示非扫码状态（idle/scanned/logged_in/failed）的文案与操作：
  - idle：子进程启动中（进度条）
  - scanned：已扫码，待手机确认（进度条）
  - logged_in：登录成功（显示昵称/账号 + 重新登录）
  - failed：登录失败（显示错误 + 重新登录）
-->
<template>
  <!-- idle：未登录/子进程启动中 -->
  <template v-if="state === 'idle'">
    <p>{{ message || '正在启动登录…' }}</p>
    <k-progress indeterminate />
  </template>

  <!-- scanned：已扫码，待手机确认 -->
  <template v-else-if="state === 'scanned'">
    <p>{{ message }}</p>
    <k-progress indeterminate />
  </template>

  <!-- logged_in：登录成功 -->
  <template v-else-if="state === 'logged_in'">
    <p>
      <k-icon name="check-circle" class="status-icon success" />
      {{ message }}
      <template v-if="self">：{{ self.nick }}（{{ self.uin }}）</template>
    </p>
    <k-button class="relogin-button" :disabled="qrLoading" @click="emit('relogin')">
      重新登录
    </k-button>
  </template>

  <!-- failed：登录失败 -->
  <template v-else-if="state === 'failed'">
    <p>{{ lastError || message }}</p>
    <k-button class="relogin-button" :disabled="qrLoading" @click="emit('relogin')">
      重新登录
    </k-button>
  </template>
</template>

<script setup lang="ts">
/** 登录状态（对齐 kernel LoginState 与后端推送结构）。 */
type LoginState = 'idle' | 'waiting_scan' | 'scanned' | 'logged_in' | 'failed';

/** 登录账号信息（state=logged_in 时有）。 */
interface SelfInfo {
  nick: string;
  uin: string;
}

defineProps<{
  /** 登录状态（waiting_scan 由 QrCodePanel 处理，本组件不渲染）。 */
  state: LoginState;
  /** 状态提示文案。 */
  message?: string;
  /** 登录账号信息。 */
  self?: SelfInfo;
  /** 失败原因。 */
  lastError?: string;
  /** 重新登录按钮 loading（与二维码刷新共用，避免同时操作）。 */
  qrLoading: boolean;
}>();

const emit = defineEmits<{
  (e: 'relogin'): void;
}>();
</script>

<style lang="scss" scoped>
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
</style>
