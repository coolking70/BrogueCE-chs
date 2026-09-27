<script setup lang="ts">
// FE-1：紧凑状态条（竖屏/横屏模式替代桌面侧栏的常驻部分）。只读显示 +
// 纯 UI 动作（菜单、抽屉、地图缩放），不发任何游戏命令。
import { computed } from 'vue';
import { useGameHud, nutritionStatus } from '../ui/useGameHud';

defineProps<{ mode: 'portrait' | 'landscape' }>();
const emit = defineEmits<{ (e: 'menu'): void; (e: 'open-panel'): void }>();

const { hp, maxHp, depth, nutrition, statuses } = useGameHud();
const hpFraction = computed(() => Math.max(0, Math.min(1, hp.value / Math.max(1, maxHp.value))));
const food = computed(() => nutritionStatus(nutrition.value));
</script>

<template>
  <header class="mobile-hud" :class="`hud-${mode}`">
    <div class="hud-row">
      <button class="hud-btn" @click="emit('menu')">{{ $t('menu.actions.menu') }}</button>
      <span class="hud-depth">{{ $t('sidebar.depth', { depth }) }}</span>
      <div class="hud-hp" :aria-label="$t('sidebar.health')">
        <div class="hud-hp-track"><div class="hud-hp-fill" :class="{ low: hpFraction < 0.3 }" :style="{ width: `${hpFraction * 100}%` }"></div></div>
        <span class="hud-hp-text">{{ hp }}/{{ maxHp }}</span>
      </div>
      <span class="hud-food" :style="{ color: food.color }">{{ food.text }}</span>
      <div class="hud-tools">
        <button class="hud-btn" @click="emit('open-panel')">{{ $t('mobile.open_panel') }}</button>
      </div>
    </div>
    <div v-if="statuses.length" class="hud-statuses">
      <span v-for="status in statuses" :key="status.id" class="hud-status"
            :style="{ color: status.color, borderColor: `${status.color}66` }">{{ status.label }} {{ status.value }}</span>
    </div>
  </header>
</template>

<style scoped>
.mobile-hud {
  box-sizing: border-box;
  padding: 6px max(8px, env(safe-area-inset-right)) 6px max(8px, env(safe-area-inset-left));
  padding-top: max(6px, env(safe-area-inset-top));
  background: var(--panel-bg-strong, #0f1115f2);
  border-bottom: 1px solid var(--panel-border, #ffffff1f);
  font-family: var(--font-main);
  color: var(--text-primary);
  z-index: 20;
}
.hud-landscape {
  padding-top: max(4px, env(safe-area-inset-top));
  padding-bottom: 4px;
}
.hud-landscape .hud-btn { min-height: 36px; }
.hud-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.hud-depth {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--color-gold);
  white-space: nowrap;
}
.hud-hp {
  flex: 1;
  min-width: 60px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.hud-hp-track {
  flex: 1;
  height: 10px;
  border-radius: 5px;
  background: var(--color-hp-bg);
  overflow: hidden;
}
.hud-hp-fill {
  height: 100%;
  background: linear-gradient(90deg, #b91c1c, #ef4444);
  transition: width 0.3s;
}
.hud-hp-fill.low { background: #7f1d1d; animation: hud-pulse 1.5s infinite; }
@keyframes hud-pulse { 50% { opacity: 0.55; } }
.hud-hp-text {
  font-family: var(--font-mono);
  font-size: 0.8rem;
  white-space: nowrap;
}
.hud-food { font-size: 0.8rem; white-space: nowrap; }
.hud-tools { display: flex; gap: 4px; }
.hud-btn {
  min-height: 40px;
  min-width: 40px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--panel-border, #ffffff26);
  background: var(--btn-bg, #1f2430);
  color: var(--text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
  touch-action: manipulation;
}
.hud-btn:active { background: var(--btn-bg-active, #2d3445); }
.hud-statuses {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.hud-status {
  font-size: 0.7rem;
  border: 1px solid;
  border-radius: 999px;
  padding: 0 6px;
}
@media (max-width: 420px) {
  .hud-row { gap: 5px; }
  .hud-btn { padding: 0 8px; }
}
</style>
