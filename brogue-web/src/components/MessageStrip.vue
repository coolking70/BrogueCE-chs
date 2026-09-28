<script setup lang="ts">
// FE-1：紧凑模式的最近消息条（替代桌面侧栏日志的常驻部分）。
// 首行优先显示长按描述，否则显示玩家位置描述（均不进入日志）。点击打开日志抽屉。
import { useGameHud } from '../ui/useGameHud';

const props = withDefaults(defineProps<{ lines?: number }>(), { lines: 3 });
const emit = defineEmits<{ (e: 'open-panel'): void }>();
const { logs, hoverText } = useGameHud(props.lines);
</script>

<template>
  <div class="message-strip" role="log" aria-live="polite" @click="emit('open-panel')">
    <div v-if="hoverText" class="strip-hover">{{ hoverText }}</div>
    <div v-for="(msg, index) in logs" :key="msg.id" class="strip-line" :class="{ latest: index === 0, acknowledge: msg.acknowledge }" :style="{ color: msg.color }">
      {{ msg.text }}<span v-if="msg.count > 1" class="strip-count">×{{ msg.count }}</span>
    </div>
  </div>
</template>

<style scoped>
.strip-line.acknowledge { border-left: 2px solid #facc15; padding-left: 6px; font-weight: 600; }
.message-strip {
  box-sizing: border-box;
  padding: 4px max(10px, env(safe-area-inset-left));
  font-size: 0.85rem;
  line-height: 1.35;
  background: var(--panel-bg-strong);
  overflow: hidden;
  cursor: pointer;
}
.strip-hover {
  color: #bae6fd;
  border-left: 2px solid var(--color-accent);
  padding-left: 6px;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.strip-line {
  /* FE-1 D：0.7 会把本就偏暗的日志色（如 #8888aa）压到对比度 < 4.5:1，暗环境下难读 */
  opacity: 0.85;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.strip-line.latest { opacity: 1; }
.strip-count {
  margin-left: 6px;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: #e4e4e7;
}
</style>
