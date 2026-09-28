<script setup lang="ts">
// FE-1：小屏地图缩放/回中按钮（纯显示状态；只在跟随模式下出现）。
import { cameraState, zoomBy, recenterCamera } from '../ui/mapCamera';
</script>

<template>
  <div v-if="cameraState.follow" class="map-zoom">
    <button :aria-label="$t('mobile.zoom_in')" :title="$t('mobile.zoom_in')" @click="zoomBy(1.25)">+</button>
    <button :aria-label="$t('mobile.zoom_out')" :title="$t('mobile.zoom_out')" @click="zoomBy(1 / 1.25)">−</button>
    <button :aria-label="$t('mobile.recenter')" :title="$t('mobile.recenter')" @click="recenterCamera()">◎</button>
  </div>
</template>

<style scoped>
.map-zoom {
  position: absolute;
  top: 8px;
  right: max(8px, env(safe-area-inset-right));
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 15;
}
button {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  border: 1px solid var(--panel-border, #ffffff26);
  background: color-mix(in srgb, var(--btn-bg) 85%, transparent);
  color: var(--text-primary);
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  touch-action: manipulation;
}
button:active { background: var(--btn-bg-active, #2d3445); }
</style>
