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
const omniscientDetails = computed(() => { pulse.value; return activeGame.replayOmniscientDetails; });
const toggleDetails = () => {
    activeGame.replayOmniscientDetails = !activeGame.replayOmniscientDetails;
    activeGame.inspectTarget = null;
};

const isPlaying = computed(() => { pulse.value; return activeGame.replayStatus === 'playing'; });

const currentCursor = computed(() => { pulse.value; return activeGame.replayCursor; });
const totalEvents = computed(() => { pulse.value; return activeGame.replayEvents.length; });
const replayError = computed(() => { pulse.value; return activeGame.replayErrorDisplay; });

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
    <label><input type="checkbox" :checked="omniscientDetails" @change="toggleDetails" />
      {{ t('replay.controls.omniscient_details', { defaultValue: 'Omniscient item details' }) }}
    </label>
    <input type="range" min="0" :max="totalEvents" :value="currentCursor" @input="onSeek" class="slider" />
  </div>
</template>

<style scoped>
.replay-error { color: var(--color-danger); font-weight: 700; margin-bottom: 6px; }
.replay-controls {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--panel-bg);
    border: 1px solid var(--panel-border);
    padding: 10px 20px;
    border-radius: var(--panel-radius);
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
    background: var(--btn-bg);
    border: 1px solid var(--btn-border);
    color: var(--text-primary);
    padding: 4px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
}

button:hover {
    background: var(--btn-bg-active);
}

.progress-text {
    color: var(--text-secondary);
    font-size: 14px;
    font-family: var(--font-mono);
    flex-grow: 1;
    text-align: right;
}

.slider {
    width: 100%;
    cursor: pointer;
}

/* FE-1：紧凑模式——贴底全宽（回放期间触控命令栏隐藏，由本条占位），按钮 44px */
@media (max-width: 1023px), (max-height: 599px) {
    .replay-controls {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        transform: none;
        min-width: 0;
        border-radius: 12px 12px 0 0;
        padding: 8px 12px max(8px, env(safe-area-inset-bottom));
    }
    button { min-height: 44px; min-width: 72px; }
    .slider { height: 32px; }
}
</style>
