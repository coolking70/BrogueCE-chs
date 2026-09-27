<script setup lang="ts">
// FE-1：紧凑模式的最近消息条（替代桌面侧栏日志的常驻部分）。
// 长按地图得到的格子描述（hoveredText）显示在首行。点击打开完整日志抽屉。
import { useGameHud } from '../ui/useGameHud';

const props = withDefaults(defineProps<{ lines?: number }>(), { lines: 3 });
const emit = defineEmits<{ (e: 'open-panel'): void }>();
const { logs, hoverText } = useGameHud(props.lines);
</script>

<template>
  <div class="message-strip" role="log" aria-live="polite" @click="emit('open-panel')">
    <div v-if="hoverText" class="strip-hover">{{ hoverText }}</div>
    <div v-for="(msg, index) in logs" :key="msg.id" class="strip-line" :class="{ latest: index === 0 }" :style="{ color: msg.color }">
      {{ msg.text }}<span v-if="msg.count > 1" class="strip-count">×{{ msg.count }}</span>
    </div>
  </div>
</template>

<style scoped>
.message-strip {
  box-sizing: border-box;
  padding: 4px max(10px, env(safe-area-inset-left));
  font-size: 0.85rem;
  line-height: 1.35;
  background: #0b0c10e6;
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
  opacity: 0.7;
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
