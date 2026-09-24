<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { normalizeSeed } from '../engine/Seed';
import type { GameMode } from '../engine/Core/Game';
import { displaySettings, isMapScaleMode, isSidebarWidthMode } from '../engine/Settings';

defineProps<{
  hasSave: boolean;
  hasReplay: boolean;
  inGame: boolean;
  saveInfo: {
    depth: number;
    seed: string;
    mode: string;
    savedAt: number;
  } | null;
  replayInfo: {
    status: string;
    cursor: number;
    total: number;
  } | null;
}>();

const emit = defineEmits<{
  (e: 'new-game', payload: { seed?: string; mode: GameMode }): void;
  (e: 'continue-game'): void;
  (e: 'save-game'): void;
  (e: 'delete-save'): void;
  (e: 'save-replay'): void;
  (e: 'load-replay'): void;
  (e: 'delete-replay'): void;
  (e: 'replay-play'): void;
  (e: 'replay-pause'): void;
  (e: 'replay-step'): void;
  (e: 'replay-restart'): void;
  (e: 'replay-seek', payload: number): void;
  (e: 'export-replay-json'): void;
  (e: 'import-replay-json', payload: File): void;
  (e: 'close'): void;
}>();

const mode = ref<GameMode>('normal');
const seedInput = ref('');
const replaySeekInput = ref('');
const replayFileInput = ref<HTMLInputElement | null>(null);
const { t } = useTranslation();

const parsedSeed = computed(() => {
  const trimmed = seedInput.value.trim();
  if (!trimmed || mode.value === 'test') return undefined;
  try { return normalizeSeed(trimmed); } catch { return null; }
});

const startGame = () => {
  if (parsedSeed.value === null) return;
  emit('new-game', { seed: parsedSeed.value, mode: mode.value });
};

const modeLabel = (value: string) =>
  t(`menu.mode.${value}`, { defaultValue: value });

const triggerReplayImport = () => {
  replayFileInput.value?.click();
};

const onReplayFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  emit('import-replay-json', file);
  input.value = '';
};

const seekReplay = () => {
  const n = Number.parseInt(replaySeekInput.value.trim(), 10);
  if (!Number.isFinite(n)) return;
  emit('replay-seek', n);
};

watch(mode, (m) => {
  if (m === 'test') {
    seedInput.value = '';
  }
});

// P2-6 显示设置：直接读写全局响应式 store（Settings.ts 内自动持久化），
// 变更即时生效（GameCanvas 的 watch / Sidebar 的 computed 均会跟随），
// 无需事件冒泡到 App.vue，也无需刷新页面。select 产出 string，
// 经类型守卫收窄后再写入，避免非法值进 store。
const mapScaleModel = computed({
  get: () => displaySettings.mapScaleMode,
  set: (v: string) => {
    if (isMapScaleMode(v)) displaySettings.mapScaleMode = v;
  },
});

const sidebarWidthModel = computed({
  get: () => displaySettings.sidebarWidthMode,
  set: (v: string) => {
    if (isSidebarWidthMode(v)) displaySettings.sidebarWidthMode = v;
  },
});
</script>

<template>
  <div class="menu-overlay">
    <div class="menu-card">
      <h1>{{ t('menu.title', { defaultValue: 'Brogue Web' }) }}</h1>
      <p class="subtitle">{{ t('menu.subtitle', { defaultValue: 'Stage 1 launcher: new game, seed, mode, and save/continue.' }) }}</p>

      <label class="field">
        <span>{{ t('menu.mode.label', { defaultValue: 'Mode' }) }}</span>
        <select v-model="mode">
          <option value="normal">{{ t('menu.mode.normal', { defaultValue: 'Normal' }) }}</option>
          <option value="easy">{{ t('menu.mode.easy', { defaultValue: 'Easy' }) }}</option>
          <option value="wizard">{{ t('menu.mode.wizard', { defaultValue: 'Wizard' }) }}</option>
          <option value="test">{{ t('menu.mode.test', { defaultValue: 'Test' }) }}</option>
        </select>
      </label>

      <label class="field">
        <span>{{ t('menu.seed.label', { defaultValue: 'Seed (optional)' }) }}</span>
        <input
          v-model="seedInput"
          type="text"
          inputmode="numeric"
          :aria-invalid="parsedSeed === null"
          aria-describedby="seed-hint"
          :disabled="mode === 'test'"
          :placeholder="mode === 'test'
            ? t('menu.seed.disabled_for_test', { defaultValue: 'Disabled in test mode' })
            : t('menu.seed.placeholder', { defaultValue: 'e.g. 18451615' })"
        />
      </label>

      <p id="seed-hint" :role="parsedSeed === null ? 'alert' : undefined">
        {{ $t('menu.seed.range', { defaultValue: '0–18446744073709551615; blank or 0 uses a random seed.' }) }}
      </p>

      <div class="actions">
        <button :disabled="parsedSeed === null" @click="startGame">{{ t('menu.actions.new_game', { defaultValue: 'New Game' }) }}</button>
        <button :disabled="!hasSave" @click="emit('continue-game')">{{ t('menu.actions.continue', { defaultValue: 'Continue' }) }}</button>
        <button v-if="inGame" @click="emit('save-game')">{{ t('menu.actions.save', { defaultValue: 'Save' }) }}</button>
        <button v-if="hasSave" class="danger-btn" @click="emit('delete-save')">{{ t('menu.actions.delete_save', { defaultValue: 'Delete Save' }) }}</button>
        <button v-if="inGame" @click="emit('close')">{{ t('menu.actions.back', { defaultValue: 'Back to Game' }) }}</button>
      </div>

      <div class="actions">
        <button v-if="inGame" @click="emit('save-replay')">{{ t('menu.replay.save', { defaultValue: 'Save Replay' }) }}</button>
        <button :disabled="!hasReplay" @click="emit('load-replay')">{{ t('menu.replay.load', { defaultValue: 'Load Replay' }) }}</button>
        <button :disabled="!hasReplay" @click="emit('export-replay-json')">{{ t('menu.replay.export_json', { defaultValue: 'Export JSON' }) }}</button>
        <button @click="triggerReplayImport">{{ t('menu.replay.import_json', { defaultValue: 'Import JSON' }) }}</button>
        <button v-if="hasReplay" class="danger-btn" @click="emit('delete-replay')">{{ t('menu.replay.delete', { defaultValue: 'Delete Replay' }) }}</button>
      </div>

      <!-- P2-6 显示设置：等比 = web 现状（方格正方形、留黑边）；
           拉伸铺满 / 按比例 = CE 口径（tiles.c:782-803、侧栏恒占 20%）。 -->
      <div class="display-group">
        <label class="field">
          <span>{{ t('menu.display.map_scale', { defaultValue: '地图缩放' }) }}</span>
          <select v-model="mapScaleModel">
            <option value="uniform">{{ t('menu.display.map_scale.uniform', { defaultValue: '等比' }) }}</option>
            <option value="stretch">{{ t('menu.display.map_scale.stretch', { defaultValue: '拉伸铺满' }) }}</option>
          </select>
        </label>
        <label class="field">
          <span>{{ t('menu.display.sidebar_width', { defaultValue: '侧栏宽度' }) }}</span>
          <select v-model="sidebarWidthModel">
            <option value="fixed">{{ t('menu.display.sidebar_width.fixed', { defaultValue: '固定' }) }}</option>
            <option value="proportional">{{ t('menu.display.sidebar_width.proportional', { defaultValue: '按比例' }) }}</option>
          </select>
        </label>
      </div>
      <input
        ref="replayFileInput"
        type="file"
        accept="application/json,.json"
        class="file-input"
        @change="onReplayFileChange"
      />

      <div v-if="replayInfo" class="save-meta">
        <div><strong>{{ t('menu.replay.title', { defaultValue: 'Replay' }) }}</strong></div>
        <div>{{ t('menu.replay.status', { defaultValue: 'Status' }) }}: {{ t(`menu.replay.status_${replayInfo.status}`, { defaultValue: replayInfo.status }) }}</div>
        <div>{{ t('menu.replay.progress', { defaultValue: 'Progress' }) }}: {{ replayInfo.cursor }} / {{ replayInfo.total }}</div>
        <div class="actions">
          <button @click="emit('replay-play')">{{ t('menu.replay.play', { defaultValue: 'Play' }) }}</button>
          <button @click="emit('replay-pause')">{{ t('menu.replay.pause', { defaultValue: 'Pause' }) }}</button>
          <button @click="emit('replay-step')">{{ t('menu.replay.step', { defaultValue: 'Step' }) }}</button>
          <button @click="emit('replay-restart')">{{ t('menu.replay.restart', { defaultValue: 'Restart' }) }}</button>
        </div>
        <div class="actions">
          <input
            v-model="replaySeekInput"
            type="number"
            min="0"
            :max="Math.max(0, replayInfo.total)"
            :placeholder="t('menu.replay.seek_placeholder', { defaultValue: 'Event index' })"
          />
          <button @click="seekReplay">{{ t('menu.replay.seek', { defaultValue: 'Seek' }) }}</button>
        </div>
      </div>

      <div v-if="saveInfo" class="save-meta">
        <div><strong>{{ t('menu.save_meta.title', { defaultValue: 'Save' }) }}</strong></div>
        <div>{{ t('menu.save_meta.depth', { defaultValue: 'Depth' }) }}: {{ saveInfo.depth }}</div>
        <div>{{ t('menu.save_meta.mode', { defaultValue: 'Mode' }) }}: {{ modeLabel(saveInfo.mode) }}</div>
        <div>{{ t('menu.save_meta.seed', { defaultValue: 'Seed' }) }}: {{ saveInfo.seed }}</div>
        <div>{{ t('menu.save_meta.saved_at', { defaultValue: 'Saved' }) }}: {{ new Date(saveInfo.savedAt).toLocaleString() }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.menu-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.72);
  z-index: 2000;
}

.menu-card {
  width: min(480px, 92vw);
  background: #101214;
  border: 1px solid #2b2f33;
  border-radius: 10px;
  padding: 20px;
}

h1 {
  margin: 0 0 6px;
  font-size: 24px;
}

.subtitle {
  margin: 0 0 16px;
  color: #9ba3af;
  font-size: 13px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.field span {
  color: #c8d0dc;
  font-size: 13px;
}

select,
input {
  height: 36px;
  border: 1px solid #3a4048;
  background: #1a1f24;
  color: #f5f7fa;
  border-radius: 6px;
  padding: 0 10px;
}

.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}

.display-group {
  display: flex;
  gap: 12px;
  margin-top: 12px;
}

.display-group .field {
  flex: 1;
  margin-bottom: 0;
}

button {
  height: 34px;
  border: 1px solid #4b5563;
  background: #1f2937;
  color: #e5e7eb;
  border-radius: 6px;
  padding: 0 12px;
  cursor: pointer;
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.danger-btn {
  border-color: #7f1d1d;
  background: #3f1313;
}

.save-meta {
  margin-top: 14px;
  padding: 10px;
  border: 1px solid #2b2f33;
  border-radius: 6px;
  font-size: 13px;
  color: #c5ced9;
  display: grid;
  gap: 4px;
}

.file-input {
  display: none;
}
</style>
