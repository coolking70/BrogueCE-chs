<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useTranslation } from 'i18next-vue';
import { activeGame } from '../engine/Core/Game';

const { t } = useTranslation();
const pulse = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => { timer = setInterval(() => { pulse.value++; }, 100); });
onUnmounted(() => { if (timer) clearInterval(timer); });

const isReplayActive = computed(() => { pulse.value; return !!activeGame.replayRecording; });
const isPlaying = computed(() => { pulse.value; return activeGame.replayStatus === 'playing'; });

const currentCursor = computed(() => { pulse.value; return activeGame.replayCursor; });
const totalEvents = computed(() => { pulse.value; return activeGame.replayEvents.length; });
const replayError = computed(() => { pulse.value; return activeGame.replayError; });

const togglePlay = () => {
  if (isPlaying.value) {
    activeGame.replayPause();
  } else {
    if (activeGame.replayStatus === 'finished') {
        activeGame.replaySeek(0);
    }
    activeGame.replayPlay();
  }
};

const stepPlay = () => {
    if (activeGame.replayStatus === 'playing') {
        activeGame.replayPause();
    }
    activeGame.replayStep();
};

const onSeek = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const value = parseInt(input.value, 10);
    activeGame.replaySeek(value);
};

</script>

<template>
  <div v-if="isReplayActive" class="replay-controls">
    <div v-if="replayError" role="alert" class="replay-error">{{ replayError }}</div>
    <div class="controls-row">
        <button @click="togglePlay" class="play-btn" :disabled="!!replayError">
            {{ isPlaying ? t('replay.controls.pause', { defaultValue: 'Pause' }) : t('replay.controls.play', { defaultValue: 'Play' }) }}
        </button>
        <button @click="stepPlay" class="step-btn" :disabled="!!replayError">
            {{ t('replay.controls.step', { defaultValue: 'Step' }) }}
        </button>
        <div class="progress-text">
            {{ currentCursor }} / {{ totalEvents }}
        </div>
    </div>
    <input type="range" min="0" :max="totalEvents" :value="currentCursor" @input="onSeek" class="slider" />
  </div>
</template>

<style scoped>
.replay-error { color: #ff7777; font-weight: 700; margin-bottom: 6px; }
.replay-controls {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(16, 18, 20, 0.9);
    border: 1px solid #3a4048;
    padding: 10px 20px;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 1000;
    min-width: 300px;
}

.controls-row {
    display: flex;
    align-items: center;
    gap: 10px;
}

button {
    background: #1f2937;
    border: 1px solid #4b5563;
    color: #e5e7eb;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
}

button:hover {
    background: #374151;
}

.progress-text {
    color: #9ba3af;
    font-size: 14px;
    font-family: monospace;
    flex-grow: 1;
    text-align: right;
}

.slider {
    width: 100%;
    cursor: pointer;
}
</style>
