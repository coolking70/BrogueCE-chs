<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { activeGame } from '../engine/Core/Game';
import { logger } from '../engine/Systems/Logger';
import type { LogMessage } from '../engine/Systems/Logger';
import { STATUS_CONFIG } from '../engine/Status/statusConfig';
import { STOMACH_SIZE, HUNGER_THRESHOLD, WEAK_THRESHOLD, FAINT_THRESHOLD } from '../entities/Player';

const playerHp = ref(0);
const playerMaxHp = ref(0);
const playerDepth = ref(1);
const playerNutrition = ref(STOMACH_SIZE);
const logs = ref<LogMessage[]>([]);
const hoverText = ref('');
const playerStatuses = ref<string[]>([]);

// Tiers mirror Player.computeHungerState: thresholds are CE Rogue.h:1125-1127
const getNutritionStatus = (nutrition: number) => {
    if (nutrition <= 0) return { text: '饿死', color: '#b91c1c' };
    if (nutrition <= FAINT_THRESHOLD) return { text: '昏厥', color: '#ef4444' };
    if (nutrition <= WEAK_THRESHOLD) return { text: '虚弱', color: '#f87171' };
    if (nutrition <= HUNGER_THRESHOLD) return { text: '饥饿', color: '#facc15' };
    return { text: '饱食', color: '#4ade80' };
};

let pollInterval: number;

onMounted(() => {
  // Poll state because the engine is pure TS
  pollInterval = window.setInterval(() => {
    if (activeGame && activeGame.player) {
      playerHp.value = activeGame.player.hp;
      playerMaxHp.value = activeGame.player.maxHp;
      playerDepth.value = activeGame.depth;
      playerNutrition.value = activeGame.player.nutrition;
      hoverText.value = activeGame.hoveredText;
      playerStatuses.value = Object.entries(activeGame.player.statusDurations)
        .filter(([, turns]) => (turns ?? 0) > 0)
        .map(([id, turns]) => {
          const meta = (STATUS_CONFIG as Record<string, { label: string; color: string }>)[id] ?? { label: id, color: '#dbeafe' };
          return `${meta.label}|${turns}|${meta.color}`;
        });
    }
    // Clone array for Vue reactivity
    logs.value = [...logger.messages].reverse(); 
  }, 100);
});

onUnmounted(() => {
  clearInterval(pollInterval);
});
</script>

<template>
  <div class="sidebar glass-panel">
    
    <!-- Title Area -->
    <div class="brand-header">
      <h1 class="game-title">BROGUE <span class="edition">JS</span></h1>
      <div class="depth-indicator">深度: {{ playerDepth }}</div>
    </div>

    <!-- Essential Stats Card -->
    <div class="stats-card">
      <div class="stat-row">
        <span class="stat-label">生命</span>
        <div class="hp-bar-container">
          <div 
            class="hp-bar" 
            :style="{ width: `${Math.max(0, (playerHp / Math.max(1, playerMaxHp)) * 100)}%` }"
            :class="{ 'low-hp': (playerHp / Math.max(1, playerMaxHp)) < 0.3 }"
          ></div>
        </div>
        <span class="stat-value">{{ playerHp }}/{{ playerMaxHp }}</span>
      </div>
      
      <div class="stat-row" style="margin-top: 12px;">
        <span class="stat-label">食物</span>
        <div class="nutrition-status" :style="{ color: getNutritionStatus(playerNutrition).color }">
            {{ getNutritionStatus(playerNutrition).text }}
        </div>
      </div>

      <div class="status-panel" v-if="playerStatuses.length > 0">
        <span class="status-title">状态</span>
        <div class="status-tags">
          <span
            v-for="status in playerStatuses"
            :key="status"
            class="status-tag"
            :style="{ borderColor: `${status.split('|')[2]}66`, color: status.split('|')[2], background: `${status.split('|')[2]}22` }"
          >
            {{ status.split('|')[0] }}({{ status.split('|')[1] }})
          </span>
        </div>
      </div>
    </div>
    
    <!-- Inspect Info -->
    <div v-if="hoverText" class="inspect-panel">
        <span class="inspect-icon">👁</span> {{ hoverText }}
    </div>

    <!-- Message Log / Audit Trail -->
    <div class="log-panel-container">
      <div class="log-header">行动日志</div>
      <div class="log-panel">
        <div 
          v-for="(msg, index) in logs" 
          :key="msg.id" 
          class="log-message"
          :class="{ 'log-latest': index === 0 }"
          :style="{ color: msg.color }"
        >
          <span class="log-bullet">›</span> 
          {{ msg.text }} 
          <span v-if="msg.count > 1" class="log-count">x{{ msg.count }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  width: 340px;
  min-width: 340px;
  max-width: 340px;
  height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 1.5rem;
  box-sizing: border-box;
  border-left: 1px solid var(--border-color);
  background: linear-gradient(180deg, rgba(20,20,24,0.95) 0%, rgba(10,10,12,0.98) 100%);
  z-index: 10;
}

/* Brand Header */
.brand-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.game-title {
  margin: 0;
  font-family: var(--font-main);
  font-weight: 700;
  font-size: 1.5rem;
  letter-spacing: 2px;
  color: #fff;
}

.edition {
  color: var(--color-accent);
  font-weight: 300;
}

.depth-indicator {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--color-gold);
  background: rgba(251, 191, 36, 0.1);
  padding: 4px 10px;
  border-radius: 4px;
  border: 1px solid rgba(251, 191, 36, 0.2);
}

/* Stats Card */
.stats-card {
  background: rgba(0,0,0,0.4);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  border: 1px solid rgba(255,255,255,0.03);
}

.stat-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.stat-label {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: var(--text-secondary);
  font-weight: 600;
  width: 20px;
}

.hp-bar-container {
  flex: 1;
  height: 14px;
  background-color: var(--color-hp-bg);
  border-radius: 7px;
  overflow: hidden;
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.5);
  position: relative;
}

.hp-bar {
  height: 100%;
  background: linear-gradient(90deg, #b91c1c 0%, #ef4444 100%);
  border-radius: 7px;
  transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 0 10px rgba(239, 68, 68, 0.5);
}

.hp-bar.low-hp {
  animation: pulse 1.5s infinite;
  background: linear-gradient(90deg, #7f1d1d 0%, #b91c1c 100%);
}

@keyframes pulse {
  0% { opacity: 1; }
  50% { opacity: 0.6; }
  100% { opacity: 1; }
}

.stat-value {
  font-family: var(--font-mono);
  font-size: 0.9rem;
  color: #fff;
  min-width: 45px;
  text-align: right;
}

.status-panel {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-title {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-secondary);
  letter-spacing: 1px;
}

.status-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.status-tag {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: #dbeafe;
  background: rgba(59, 130, 246, 0.18);
  border: 1px solid rgba(147, 197, 253, 0.35);
  border-radius: 999px;
  padding: 2px 8px;
}

/* Inspect Panel */
.inspect-panel {
  background: rgba(56, 189, 248, 0.05);
  border-left: 3px solid var(--color-accent);
  padding: 0.75rem 1rem;
  border-radius: 0 4px 4px 0;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: #e0f2fe;
  margin-bottom: 1.5rem;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.inspect-icon {
  opacity: 0.7;
  font-size: 1rem;
}

/* Log Panel */
.log-panel-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: rgba(0,0,0,0.3);
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.03);
}

.log-header {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--text-secondary);
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  background: rgba(255,255,255,0.02);
}

.log-panel {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.log-message {
  font-family: var(--font-main);
  font-size: 0.9rem;
  line-height: 1.4;
  opacity: 0.7;
  transition: opacity 0.2s ease;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.log-latest {
  opacity: 1;
  font-weight: 500;
  text-shadow: 0 0 8px rgba(255,255,255,0.2);
}

.log-bullet {
  color: rgba(255,255,255,0.2);
  font-family: var(--font-mono);
  margin-top: -1px;
}

.log-count {
  display: inline-block;
  background: rgba(255,255,255,0.1);
  color: #fff;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  padding: 1px 6px;
  border-radius: 10px;
  margin-left: 6px;
  vertical-align: middle;
}
</style>
