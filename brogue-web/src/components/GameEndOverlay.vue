<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { activeGame } from '../engine/Core/Game';

const isGameOver = ref(false);
const won = ref(false);
const reason = ref('');
const stats = ref({
    kills: 0,
    gold: 0,
    turns: 0,
    maxDepth: 1
});
const score = ref(0);
const inventory = ref<Array<{ name: string; category: number; enchantment: number; color: number }>>([]);

let timer: number;

onMounted(() => {
    // Polling is fine here since game over is a rare, one-time boundary event
    timer = window.setInterval(() => {
        if (activeGame.isGameOver && !isGameOver.value) {
            isGameOver.value = true;
            won.value = activeGame.gameOverWon;
            reason.value = activeGame.gameOverReason;
            stats.value = { ...activeGame.stats };
            score.value = activeGame.gameOverScore;
            inventory.value = [...activeGame.gameOverInventory];
        } else if (!activeGame.isGameOver && isGameOver.value) {
            isGameOver.value = false;
        }
    }, 200);
});

onUnmounted(() => clearInterval(timer));

const emit = defineEmits(['return-to-title']);

const handleReturn = () => {
    isGameOver.value = false;
    emit('return-to-title');
};

function itemColorStyle(color: number) {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    return { color: `rgb(${r}, ${g}, ${b})` };
}

function enchantLabel(ench: number): string {
    if (ench > 0) return `+${ench}`;
    if (ench < 0) return `${ench}`;
    return '';
}
</script>

<template>
    <div v-if="isGameOver" class="game-end-overlay">
        <div class="end-panel">
            <h1 :class="won ? 'title-win' : 'title-loss'">
                {{ won
                    ? $t('endgame.victory', { defaultValue: 'VICTORY' })
                    : $t('endgame.defeat', { defaultValue: 'GAME OVER' })
                }}
            </h1>

            <p class="reason">{{ reason }}</p>

            <div class="score-display">
                <span class="score-label">{{ $t('endgame.score', { defaultValue: 'Score' }) }}</span>
                <span class="score-value">{{ score.toLocaleString() }}</span>
            </div>

            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-label">{{ $t('endgame.stats_depth', { defaultValue: 'Max Depth' }) }}</div>
                    <div class="stat-value">{{ stats.maxDepth }}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">{{ $t('endgame.stats_kills', { defaultValue: 'Monsters Defeated' }) }}</div>
                    <div class="stat-value">{{ stats.kills }}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">{{ $t('endgame.stats_gold', { defaultValue: 'Gold Collected' }) }}</div>
                    <div class="stat-value">{{ stats.gold }}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">{{ $t('endgame.stats_turns', { defaultValue: 'Turns' }) }}</div>
                    <div class="stat-value">{{ stats.turns }}</div>
                </div>
            </div>

            <div v-if="inventory.length > 0" class="inventory-section">
                <div class="inventory-title">{{ $t('endgame.inventory', { defaultValue: 'Inventory' }) }}</div>
                <div class="inventory-list">
                    <div v-for="(item, idx) in inventory" :key="idx" class="inventory-item">
                        <span class="item-name" :style="itemColorStyle(item.color)">{{ item.name }}</span>
                        <span v-if="item.enchantment !== 0" class="item-enchant" :class="item.enchantment > 0 ? 'enchant-pos' : 'enchant-neg'">
                            {{ enchantLabel(item.enchantment) }}
                        </span>
                    </div>
                </div>
            </div>

            <button class="return-btn" @click="handleReturn">
                {{ $t('endgame.return', { defaultValue: 'Return to Title' }) }}
            </button>
        </div>
    </div>
</template>

<style scoped>
.game-end-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.85);
    z-index: 9999;
    display: flex;
    justify-content: center;
    align-items: center;
    user-select: none;
    overflow-y: auto;
}

.end-panel {
    background: #111;
    border: 2px solid #444;
    border-radius: 8px;
    padding: 32px 40px;
    min-width: 400px;
    max-width: 600px;
    text-align: center;
    box-shadow: 0 10px 40px rgba(0,0,0,0.8);
    margin: 20px;
}

.title-win {
    color: #44ff44;
    font-size: 2.5rem;
    margin-top: 0;
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 2px;
}

.title-loss {
    color: #ff4444;
    font-size: 2.5rem;
    margin-top: 0;
    margin-bottom: 12px;
    text-transform: uppercase;
    letter-spacing: 2px;
}

.reason {
    color: #ccc;
    font-size: 1.1rem;
    margin-bottom: 20px;
    font-style: italic;
}

.score-display {
    display: flex;
    justify-content: center;
    align-items: baseline;
    gap: 12px;
    margin-bottom: 20px;
}

.score-label {
    color: #888;
    font-size: 1rem;
    text-transform: uppercase;
}

.score-value {
    color: #ffd700;
    font-size: 2rem;
    font-weight: bold;
}

.stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 20px;
    background: #1a1a1a;
    padding: 16px;
    border-radius: 6px;
    border: 1px solid #333;
}

.stat-item {
    display: flex;
    flex-direction: column;
}

.stat-label {
    color: #888;
    font-size: 0.8rem;
    text-transform: uppercase;
    margin-bottom: 4px;
}

.stat-value {
    color: #ffd700;
    font-size: 1.3rem;
    font-weight: bold;
}

.inventory-section {
    margin-bottom: 24px;
    text-align: left;
}

.inventory-title {
    color: #888;
    font-size: 0.8rem;
    text-transform: uppercase;
    margin-bottom: 8px;
    text-align: center;
}

.inventory-list {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 8px 12px;
    max-height: 200px;
    overflow-y: auto;
}

.inventory-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 3px 0;
    font-size: 0.9rem;
    border-bottom: 1px solid #222;
}

.inventory-item:last-child {
    border-bottom: none;
}

.item-name {
    font-family: monospace;
}

.item-enchant {
    font-size: 0.8rem;
    font-weight: bold;
    margin-left: 8px;
}

.enchant-pos {
    color: #44ff44;
}

.enchant-neg {
    color: #ff4444;
}

.return-btn {
    background: #333;
    color: #fff;
    border: 1px solid #555;
    padding: 12px 24px;
    font-size: 1.1rem;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
}

.return-btn:hover {
    background: #444;
    border-color: #777;
}
</style>
