<script setup lang="ts">
// FE-1：虚拟八方向键。按下立即发一次 move，按住 350ms 后每 140ms 重复一次
// （每次都是一条独立的录制命令，与连按键盘 hjkl 等价）。中心键 = 休息一回合。
// 目标选择期间，引擎把 move 解释为移动瞄准光标（与键盘同一语义）。
import { computed, onUnmounted } from 'vue';
import { useTranslation } from 'i18next-vue';
import { Direction } from '../types';
import { dispatch } from '../ui/commands';

defineProps<{ mode: 'portrait' | 'landscape' | 'desktop' }>();

const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 140;
let delayTimer = 0;
let repeatTimer = 0;

const stop = () => {
  window.clearTimeout(delayTimer);
  window.clearInterval(repeatTimer);
  delayTimer = 0;
  repeatTimer = 0;
};

const fire = (dir: Direction | null) => {
  if (dir === null) dispatch('wait');
  else dispatch('move', dir);
};

const press = (e: PointerEvent, dir: Direction | null) => {
  e.preventDefault();
  stop();
  fire(dir);
  if (dir === null) return; // 休息不自动重复，避免误触连休
  delayTimer = window.setTimeout(() => {
    repeatTimer = window.setInterval(() => fire(dir), REPEAT_INTERVAL_MS);
  }, REPEAT_DELAY_MS);
};

// 键盘/读屏用户：click 事件（pointer 事件已 preventDefault 时 detail>0 的 click 不再重复触发）
const keyActivate = (e: MouseEvent, dir: Direction | null) => {
  if (e.detail === 0) fire(dir);
};

onUnmounted(stop);

const { t } = useTranslation();
const keys = computed(() => [
  { dir: Direction.UPLEFT, glyph: '↖', label: t('controls.up_left') },
  { dir: Direction.UP, glyph: '↑', label: t('controls.up') },
  { dir: Direction.UPRIGHT, glyph: '↗', label: t('controls.up_right') },
  { dir: Direction.LEFT, glyph: '←', label: t('controls.left') },
  { dir: null, glyph: '·', label: t('mobile.cmd.rest') },
  { dir: Direction.RIGHT, glyph: '→', label: t('controls.right') },
  { dir: Direction.DOWNLEFT, glyph: '↙', label: t('controls.down_left') },
  { dir: Direction.DOWN, glyph: '↓', label: t('controls.down') },
  { dir: Direction.DOWNRIGHT, glyph: '↘', label: t('controls.down_right') },
]);
</script>

<template>
  <div class="dpad" :class="`pad-${mode}`" role="group" :aria-label="$t('mobile.dpad')">
    <button v-for="key in keys" :key="key.glyph" class="pad-btn" :class="{ center: key.dir === null }"
            :aria-label="key.label"
            @pointerdown="press($event, key.dir)" @pointerup="stop" @pointercancel="stop" @pointerleave="stop"
            @click="keyActivate($event, key.dir)" @contextmenu.prevent>
      {{ key.glyph }}
    </button>
  </div>
</template>

<style scoped>
.dpad {
  display: grid;
  grid-template-columns: repeat(3, 46px);
  grid-template-rows: repeat(3, 46px);
  gap: 4px;
  padding: 6px;
  padding-right: max(6px, env(safe-area-inset-right));
  padding-bottom: max(6px, env(safe-area-inset-bottom));
  box-sizing: border-box;
  align-content: center;
  background: var(--panel-bg-strong, #0f1115f2);
}
.pad-landscape, .pad-desktop {
  background: transparent;
  z-index: 12;
  opacity: 0.88;
}
.pad-desktop { margin: 0 12px 12px 0; }
.pad-btn {
  border-radius: 10px;
  border: 1px solid var(--panel-border, #ffffff26);
  background: #1f2430e6;
  color: var(--text-primary);
  font-size: 1.25rem;
  line-height: 1;
  cursor: pointer;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
}
.pad-btn.center { color: var(--text-secondary); font-size: 1.5rem; }
.pad-btn:active { background: var(--btn-bg-active, #2d3445); }
</style>
