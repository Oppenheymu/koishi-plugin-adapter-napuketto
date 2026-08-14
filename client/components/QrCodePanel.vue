<!--
  QrCodePanel.vue：扫码登录二维码面板（settings.vue 拆出，design.md §5.12）。

  仅负责 waiting_scan 状态展示：二维码 + 过期遮罩 + 刷新/打开链接操作。
  过期计时（qrExpired）与刷新 loading（qrLoading）由父组件管理（settings.vue
  持有共享状态），本组件纯展示 + 事件上行。
-->
<template>
  <div>
    <div v-if="image" class="qrcode-container">
      <img class="qrcode" :src="image" alt="NapukettoQQ 登录二维码" />
      <!-- 本地 2 分钟过期遮罩（kernel 过期会自动推新码，新码到达即复位） -->
      <div v-if="qrExpired" class="refresh-overlay">
        <p>二维码已过期</p>
        <k-button @click="emit('refresh-qr')" :disabled="qrLoading">刷新二维码</k-button>
      </div>
    </div>
    <div v-else class="qrcode-loading">
      <k-icon name="loader" class="rotating" />
      <span>正在获取二维码…</span>
    </div>

    <div class="qrcode-instructions">
      <p>{{ message }}</p>
      <p v-if="image">请在两分钟内使用手机端扫描并确认登录</p>
    </div>

    <div class="qrcode-actions">
      <k-button @click="emit('refresh-qr')" :disabled="qrLoading">
        <template v-if="qrLoading">
          <k-icon name="loader" class="rotating" />
          刷新中…
        </template>
        <template v-else>
          <k-icon name="refresh-cw" />
          刷新二维码
        </template>
      </k-button>
      <k-button v-if="qr?.qrcodeUrl" type="link" @click="emit('open-qr-url')">
        <k-icon name="external-link" />
        无法扫码？点此打开登录链接
      </k-button>
    </div>
  </div>
</template>

<script setup lang="ts">
/** 二维码信息（state=waiting_scan 时有）。 */
interface QrInfo {
  pngBase64: string;
  qrcodeUrl: string;
}

defineProps<{
  /** 二维码完整 data URI（直接 <img :src> 展示）。 */
  image?: string;
  /** 登录提示文案。 */
  message?: string;
  /** 二维码信息（打开登录链接用）。 */
  qr?: QrInfo;
  /** 本地过期遮罩（父组件计时）。 */
  qrExpired: boolean;
  /** 刷新按钮 loading。 */
  qrLoading: boolean;
}>();

const emit = defineEmits<{
  (e: 'refresh-qr'): void;
  (e: 'open-qr-url'): void;
}>();
</script>

<style lang="scss" scoped>
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
</style>
