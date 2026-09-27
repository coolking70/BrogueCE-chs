<script setup lang="ts">
// FE-1：触屏常用命令栏。每个按钮 = 一个键盘命令，经 ui/commands.dispatch
// （inputManager.triggerAction → game.handlePlayerAction）进入录制边界。
import { computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { dispatch } from '../ui/commands';

defineProps<{ mode: 'portrait' | 'landscape' | 'desktop' }>();

// key：与 Input.ts 同一动作名；label：i18n 键；glyph：CE 的按键字符，作为图标提示
const { t } = useTranslation();
// i18n 键必须是字面量（p1_30 扫描器要求首参可静态解析）
const commands = computed(() => [
  { action: 'search', label: t('mobile.cmd.search'), glyph: 's' },
  { action: 'wait', label: t('mobile.cmd.rest'), glyph: '' },
  { action: 'pickup', label: t('mobile.cmd.pickup'), glyph: 'g' },
  { action: 'toggle_inventory', label: t('mobile.cmd.inventory'), glyph: 'i' },
  { action: 'throw_item', label: t('mobile.cmd.throw'), glyph: 't' },
  { action: 'auto_explore', label: t('mobile.cmd.explore'), glyph: 'X' },
  { action: 'stairs_up', label: t('mobile.cmd.stairs_up'), glyph: '<' },
  { action: 'stairs_down', label: t('mobile.cmd.stairs_down'), glyph: '>' },
  { action: 'examine', label: t('mobile.cmd.examine'), glyph: 'x' },
  { action: 'discoveries', label: t('mobile.cmd.discoveries'), glyph: 'D' },
  { action: 'help', label: t('mobile.cmd.help'), glyph: '?' },
  { action: 'escape', label: t('mobile.cmd.cancel'), glyph: 'Esc' },
]);
</script>

<template>
  <nav class="command-bar" :class="`cmd-${mode}`" :aria-label="$t('controls.title')">
    <button v-for="cmd in commands" :key="cmd.action" class="cmd-btn" :data-action="cmd.action"
            @click="dispatch(cmd.action)">
      <span class="cmd-label">{{ cmd.label }}</span>
      <kbd v-if="cmd.glyph" class="cmd-key" aria-hidden="true">{{ cmd.glyph }}</kbd>
    </button>
  </nav>
</template>

<style scoped>
.command-bar {
  display: grid;
  gap: 6px;
  padding: 6px;
  box-sizing: border-box;
  background: var(--panel-bg-strong, #0f1115f2);
}
.cmd-portrait {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  padding-left: max(6px, env(safe-area-inset-left));
  padding-bottom: max(6px, env(safe-area-inset-bottom));
  align-content: center;
}
.cmd-landscape {
  grid-template-columns: repeat(2, 58px);
  grid-auto-rows: minmax(40px, 1fr);
  align-content: center;
  padding-left: max(6px, env(safe-area-inset-left));
  border-right: 1px solid var(--panel-border, #ffffff1f);
  overflow-y: auto;
}
.cmd-desktop {
  grid-template-columns: repeat(6, 64px);
  margin: 0 0 12px 12px;
  border-radius: 12px;
  border: 1px solid var(--panel-border, #ffffff1f);
  background: #0f1115cc;
  z-index: 12;
}
.cmd-btn {
  position: relative;
  min-height: 44px;
  min-width: 0;
  padding: 2px 4px;
  border-radius: 10px;
  border: 1px solid var(--panel-border, #ffffff26);
  background: var(--btn-bg, #1f2430);
  color: var(--text-primary);
  font-family: var(--font-main);
  font-size: 0.85rem;
  line-height: 1.1;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-user-select: none;
  user-select: none;
}
.cmd-landscape .cmd-btn { min-height: 40px; font-size: 0.8rem; }
.cmd-btn:active { background: var(--btn-bg-active, #2d3445); transform: translateY(1px); }
.cmd-label { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cmd-key {
  position: absolute;
  top: 2px;
  right: 4px;
  font-family: var(--font-mono);
  font-size: 0.6rem;
  color: var(--text-secondary);
  opacity: 0.8;
}
</style>
