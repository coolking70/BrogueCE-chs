<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { inputManager } from '../engine/Input';
import { activeGame } from '../engine/Core/Game';
import { iterateCreatures } from '../engine/Core/MonsterLifecycle';
import { logger } from '../engine/Systems/Logger';
import { Direction } from '../types';

// FE-1：紧凑/触屏布局下由 TouchControls 提供可见的触控按钮，这里的
// 近乎隐形的浮动按钮会遮挡背包与日志，故只隐藏按钮区（ai-agent-state 照常输出）。
defineProps<{ hideControls?: boolean }>();

const act = (action: string, data?: any) => {
    inputManager.triggerAction(action, data);
};

const aiTick = ref(0);
let timer: any = null;

onMounted(() => {
    timer = setInterval(() => { aiTick.value++; }, 200);
});

onUnmounted(() => {
    if (timer) clearInterval(timer);
});

// Compute state to expose to AI Agent
const agentState = computed(() => {
    aiTick.value; // Force reactivity
    if (!activeGame || !activeGame.player || activeGame.isGameOver) return null;
    return {
        depth: activeGame.depth,
        hp: activeGame.player.hp,
        maxHp: activeGame.player.maxHp,
        x: activeGame.player.loc.x,
        y: activeGame.player.loc.y,
        statuses: Object.keys(activeGame.player.statusDurations || {}).join(', '),
        monsters: [...iterateCreatures(activeGame.monsters)].map(m => ({
            name: m.name,
            hp: m.hp,
            maxHp: m.maxHp,
            x: m.loc.x,
            y: m.loc.y,
            dist: Math.max(Math.abs(m.loc.x - activeGame.player.loc.x), Math.abs(m.loc.y - activeGame.player.loc.y))
        })).filter(m => m.dist <= 15) // Only nearby monsters
    };
});

const recentLogs = computed(() => {
    return logger.messages.slice(-5).map(m => m.text);
});
</script>

<template>
  <div>
    <!-- Invisible AI State Data -->
    <div id="ai-agent-state" class="sr-only" v-if="agentState">
        <div data-agent-depth :content="String(agentState.depth)">Depth: {{ agentState.depth }}</div>
        <div data-agent-hp :content="String(agentState.hp)">HP: {{ agentState.hp }}</div>
        <div data-agent-max-hp :content="String(agentState.maxHp)">Max HP: {{ agentState.maxHp }}</div>
        <div data-agent-pos-x :content="String(agentState.x)">X: {{ agentState.x }}</div>
        <div data-agent-pos-y :content="String(agentState.y)">Y: {{ agentState.y }}</div>
        <div data-agent-statuses :content="agentState.statuses">Statuses: {{ agentState.statuses }}</div>
        
        <div id="ai-agent-monsters">
            <div v-for="(m, i) in agentState.monsters" :key="i" class="ai-monster"
                 :data-name="m.name" :data-hp="m.hp" :data-x="m.x" :data-y="m.y" :data-dist="m.dist">
                 {{ m.name }} (HP: {{m.hp}}/{{m.maxHp}}) at {{m.x}},{{m.y}} (Dist: {{m.dist}})
            </div>
        </div>
        
        <div id="ai-agent-logs">
            <div v-for="(log, i) in recentLogs" :key="i" class="ai-log" :data-log="log">{{ log }}</div>
        </div>
    </div>

    <div v-if="!hideControls" class="agent-controls" :aria-label="$t('controls.title')">
      <div class="d-pad">
        <button @click="act('move', Direction.UPLEFT)" :aria-label="$t('controls.up_left')">↖</button>
        <button @click="act('move', Direction.UP)" :aria-label="$t('controls.up')">↑</button>
        <button @click="act('move', Direction.UPRIGHT)" :aria-label="$t('controls.up_right')">↗</button>
        
        <button @click="act('move', Direction.LEFT)" :aria-label="$t('controls.left')">←</button>
        <button @click="act('wait_or_stairs_down')" :aria-label="$t('controls.wait')">⏱</button>
        <button @click="act('move', Direction.RIGHT)" :aria-label="$t('controls.right')">→</button>
        
        <button @click="act('move', Direction.DOWNLEFT)" :aria-label="$t('controls.down_left')">↙</button>
        <button @click="act('move', Direction.DOWN)" :aria-label="$t('controls.down')">↓</button>
        <button @click="act('move', Direction.DOWNRIGHT)" :aria-label="$t('controls.down_right')">↘</button>
      </div>
      
      <div class="action-buttons">
        <button @click="act('toggle_inventory')" :aria-label="$t('controls.inventory')">🎒 {{ $t('controls.inventory') }}</button>
        <button @click="act('pickup')" :aria-label="$t('controls.pickup')">🖐 {{ $t('controls.pickup') }}</button>
        <button @click="act('auto_explore')" :aria-label="$t('controls.explore')">🗺 {{ $t('controls.explore') }}</button>
        <button @click="act('escape')" :aria-label="$t('controls.cancel')">❌ {{ $t('controls.cancel') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
/* FE-1 D：原先 right: 20px 会盖住桌面侧栏的行动日志（审查 P-6）。改放地图区左下角——
   桌面等比模式下地图上下都有留白，这里不遮挡任何内容；DOM 与可点击性不变。 */
.agent-controls {
  position: absolute;
  bottom: 20px;
  left: 20px;
  z-index: 5000;
  display: flex;
  flex-direction: column;
  gap: 10px;
  opacity: 0.15; /* Almost invisible to humans but fully visible to DOM/Agents */
  transition: opacity 0.3s;
}
@media (max-width: 600px) {
  .agent-controls { bottom: calc(48vh + 8px); left: 8px; }
}

.agent-controls:hover, .agent-controls:focus-within {
  opacity: 1; /* Reveals fully if hovered or focused */
}

.d-pad {
  display: grid;
  grid-template-columns: repeat(3, 40px);
  grid-template-rows: repeat(3, 40px);
  gap: 4px;
}

.d-pad button {
  background: var(--btn-bg);
  color: var(--text-primary);
  border: 1px solid var(--btn-border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 1.2rem;
  display: flex;
  align-items: center;
  justify-content: center;
}

.d-pad button:hover {
  background: var(--btn-bg-active);
}

.action-buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.action-buttons button {
  background: var(--btn-bg);
  color: var(--text-primary);
  border: 1px solid var(--btn-border);
  border-radius: 6px;
  cursor: pointer;
  padding: 6px;
  font-size: 0.8rem;
}

.action-buttons button:hover {
  background: var(--btn-bg-active);
}
</style>
