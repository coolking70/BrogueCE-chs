<script setup lang="ts">
// FE-1：紧凑模式下的侧栏抽屉（右侧滑出），承载完整 Sidebar（可见生物 + 日志）。
defineProps<{ open: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="drawer-backdrop" @click.self="emit('close')">
        <aside class="drawer-panel" role="dialog" :aria-label="$t('mobile.open_panel')">
          <button class="drawer-close" :aria-label="$t('mobile.close')" @click="emit('close')">×</button>
          <slot />
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1500;
  background: #000a;
  display: flex;
  justify-content: flex-end;
}
.drawer-panel {
  position: relative;
  width: min(380px, 90vw);
  height: 100dvh;
  box-sizing: border-box;
  padding-right: env(safe-area-inset-right);
  box-shadow: -12px 0 32px #0009;
}
.drawer-close {
  position: absolute;
  top: max(8px, env(safe-area-inset-top));
  right: max(8px, env(safe-area-inset-right));
  z-index: 30;
  width: 44px;
  height: 44px;
  border-radius: 10px;
  border: 1px solid var(--panel-border, #ffffff26);
  background: #1f2430;
  color: var(--text-primary);
  font-size: 1.5rem;
  cursor: pointer;
}
.drawer-enter-active, .drawer-leave-active { transition: opacity 0.18s; }
.drawer-enter-active .drawer-panel, .drawer-leave-active .drawer-panel { transition: transform 0.18s; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .drawer-panel, .drawer-leave-to .drawer-panel { transform: translateX(100%); }
</style>
