<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { activeGame } from '../engine/Core/Game';
import { inputManager } from '../engine/Input';
import type { DetailInfo } from '../engine/UI/DetailGenerator';

const visible = ref(false);
const detail = ref<DetailInfo | null>(null);

// Poll for inspect target changes
let pollTimer = 0;

function checkInspectTarget() {
    const game = activeGame;
    const target = game.inspectTarget;
    if (target) {
        detail.value = target;
        visible.value = true;
    }
}

function close() {
    visible.value = false;
    detail.value = null;
    activeGame.inspectTarget = null;
}

function onKeydown(e: KeyboardEvent) {
    if (visible.value && (e.key === 'Escape' || e.key === 'x')) {
        e.preventDefault();
        e.stopPropagation();
        close();
        if (e.key === 'x') {
            inputManager.triggerAction('auto_explore');
        }
    }
}

onMounted(() => {
    window.addEventListener('keydown', onKeydown, true);
    pollTimer = window.setInterval(checkInspectTarget, 100);
});

onUnmounted(() => {
    window.removeEventListener('keydown', onKeydown, true);
    if (pollTimer) window.clearInterval(pollTimer);
});

function colorToCSS(color: number): string {
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    return `rgb(${r}, ${g}, ${b})`;
}
</script>

<template>
    <Teleport to="body">
        <div v-if="visible && detail" class="detail-overlay" @click.self="close">
            <div class="detail-panel">
                <!-- Header -->
                <div class="detail-header">
                    <span class="detail-char" :style="{ color: colorToCSS(detail.color) }">{{ detail.char }}</span>
                    <span class="detail-name">{{ detail.name }}</span>
                    <button class="detail-close" @click="close" title="关闭 (Esc)">✕</button>
                </div>

                <!-- Sections -->
                <div class="detail-body">
                    <div v-for="(section, si) in detail.sections" :key="si" class="detail-section">
                        <div v-if="section.header" class="section-header">{{ section.header }}</div>
                        <div v-for="(line, li) in section.lines" :key="li"
                             class="section-line"
                             :style="{ color: line.color || '#cccccc' }">
                            {{ line.text }}
                        </div>
                    </div>
                </div>

                <div class="detail-footer">
                    <span class="footer-hint">按 Esc 或 x 关闭</span>
                </div>
            </div>
        </div>
    </Teleport>
</template>

<style scoped>
.detail-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 2000;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    justify-content: center;
    align-items: center;
    animation: fadeIn 0.15s ease-out;
}

@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.detail-panel {
    background: linear-gradient(135deg, rgba(15, 20, 45, 0.96), rgba(10, 15, 35, 0.98));
    border: 1px solid rgba(80, 100, 160, 0.5);
    border-radius: 8px;
    min-width: 320px;
    max-width: 480px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow:
        0 0 40px rgba(30, 50, 120, 0.4),
        0 4px 20px rgba(0, 0, 0, 0.6),
        inset 0 1px 0 rgba(100, 130, 200, 0.15);
    animation: slideUp 0.2s ease-out;
}

@keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
}

.detail-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px 10px;
    border-bottom: 1px solid rgba(80, 100, 160, 0.3);
    background: rgba(20, 30, 60, 0.5);
    border-radius: 8px 8px 0 0;
}

.detail-char {
    font-family: 'Courier New', monospace;
    font-size: 28px;
    font-weight: bold;
    text-shadow: 0 0 8px currentColor;
    min-width: 32px;
    text-align: center;
}

.detail-name {
    font-size: 18px;
    font-weight: 600;
    color: #e0e4f0;
    flex: 1;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}

.detail-close {
    width: 28px;
    height: 28px;
    border: 1px solid rgba(100, 120, 180, 0.3);
    border-radius: 4px;
    background: rgba(40, 50, 80, 0.6);
    color: #8899bb;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
}
.detail-close:hover {
    background: rgba(80, 60, 60, 0.8);
    color: #ff6666;
    border-color: rgba(200, 100, 100, 0.5);
}

.detail-body {
    padding: 12px 16px;
}

.detail-section {
    margin-bottom: 12px;
}
.detail-section:last-child {
    margin-bottom: 4px;
}

.section-header {
    font-size: 13px;
    font-weight: 600;
    color: rgba(140, 160, 220, 0.9);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 4px;
    padding-bottom: 3px;
    border-bottom: 1px solid rgba(60, 80, 130, 0.4);
}

.section-line {
    font-size: 14px;
    line-height: 1.6;
    padding: 1px 0;
}

.detail-footer {
    padding: 8px 16px;
    border-top: 1px solid rgba(60, 80, 130, 0.3);
    text-align: center;
}

.footer-hint {
    font-size: 11px;
    color: rgba(100, 120, 160, 0.6);
}

/* Scrollbar styling */
.detail-panel::-webkit-scrollbar {
    width: 6px;
}
.detail-panel::-webkit-scrollbar-track {
    background: rgba(10, 15, 30, 0.5);
}
.detail-panel::-webkit-scrollbar-thumb {
    background: rgba(60, 80, 140, 0.5);
    border-radius: 3px;
}
</style>
