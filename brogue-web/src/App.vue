<script lang="ts">
// UI-1 第 6 条：Game.onConfirmRequest（C-5 落下的钩子，Game.ts:408）的生产侧接线。
// 引擎的 requestConfirm 是**同步**契约（CE confirm() 在文本框里自旋等键，IO.c:2946-2975），
// 所以这里用浏览器原生 confirm()——它是 web 平台唯一能同步阻塞等答案的模态，
// 且按键语义与 CE 完全同构：Enter = OK = Yes（CE RETURN_KEY 挂在 Yes 钮，
// IO.c:2956）、Esc = Cancel = No（CE ESCAPE_KEY 挂在 No 钮，IO.c:2966；
// ACKNOWLEDGE_KEY = ' ' 同样映射 No，Rogue.h:1179）。
// 纯逻辑（回放旁路）拆成可单测的导出函数；测试见 ui_1_rendering.test.ts。
import type { Game } from './engine/Core/Game';

export function wireConfirmRequest(game: Game): void {
    game.onConfirmRequest = (message: string): boolean => {
        // CE IO.c:2944：autoPlayingLevel 是自动演示，不是旅行/探索。
        // 引擎在提问前停止自动行进；回放决策由 requestConfirm 消费。
        if (game.replayStatus === 'playing') return true;
        return window.confirm(message);
    };
}
</script>

<script setup lang="ts">
import { computed, ref, onMounted } from 'vue';
import { saveSnapshot, readSnapshot, readSaveSummary, deleteSnapshot, type SaveSummary } from './engine/Core/SaveStorage';
import i18next from 'i18next';
import GameCanvas from './components/GameCanvas.vue';
import Sidebar from './components/Sidebar.vue';
import MessageAcknowledgment from './components/MessageAcknowledgment.vue';
import InventoryOverlay from './components/InventoryOverlay.vue';
import GameEndOverlay from './components/GameEndOverlay.vue';
import MainMenu from './components/MainMenu.vue';
import ReplayControls from './components/ReplayControls.vue';
import AgentControls from './components/AgentControls.vue';
import DetailPanel from './components/DetailPanel.vue';
import ReferenceOverlay from './components/ReferenceOverlay.vue';
import MobileHud from './components/MobileHud.vue';
import MessageStrip from './components/MessageStrip.vue';
import MapZoomControls from './components/MapZoomControls.vue';
import SideDrawer from './components/SideDrawer.vue';
import CommandBar from './components/CommandBar.vue';
import DPad from './components/DPad.vue';
import TargetBar from './components/TargetBar.vue';
import { activeGame, type GameMode } from './engine/Core/Game';
import { logger } from './engine/Systems/Logger';
import { viewport, startViewportTracking } from './ui/layout';

const REPLAY_KEY = 'brogue-web-replay-v1';

// FE-1：布局模式（desktop / portrait / landscape）按视口尺寸判定，纯显示。
startViewportTracking();
const compact = computed(() => viewport.mode !== 'desktop');
const compactMode = computed(() => (viewport.mode === 'landscape' ? 'landscape' : 'portrait'));
/** 桌面尺寸的粗指针设备（大平板横屏等）也显示触控命令栏。 */
const touchUi = computed(() => !compact.value && viewport.coarsePointer);
const panelOpen = ref(false);
const replayTick = ref(0);
const replayActive = computed(() => { replayTick.value; return !!activeGame.replayRecording; });
onMounted(() => { window.setInterval(() => { replayTick.value++; }, 250); });
/** 触控命令栏 + 方向键：紧凑模式或粗指针设备显示；回放期间让位给录像控制条。 */
const showTouch = computed(() => (compact.value || touchUi.value) && !replayActive.value);

// UI-1 第 6 条：把引擎确认钩子接到本组件（headless/测试环境不挂载 App，
// 钩子保持 null → requestConfirm 按"确认"处理，与 C-5 申报一致）。
wireConfirmRequest(activeGame);

const gameStarted = ref(false);
const menuOpen = ref(true);
const storageTick = ref(0);

const saveInfo = ref<SaveSummary | null>(null);
const hasSave = computed(() => saveInfo.value !== null);
onMounted(async () => {
  try { saveInfo.value = await readSaveSummary(); } catch { saveInfo.value = null; }
});

const replayInfo = computed(() => {
  if (!activeGame.replayRecording) return null;
  return {
    status: activeGame.replayStatus,
    cursor: activeGame.replayCursor,
    total: activeGame.replayEvents.length
  };
});

const hasReplay = computed(() => {
  storageTick.value;
  try {
    return !!window.localStorage.getItem(REPLAY_KEY);
  } catch {
    return false;
  }
});

const startNewGame = (payload: { seed?: string; mode: GameMode }) => {
  activeGame.startNewGame({ seed: payload.seed, mode: payload.mode });
  logger.log(
    i18next.t('menu.log.started_game', {
      mode: i18next.t(`menu.mode.${payload.mode}`, { defaultValue: payload.mode }),
      seed: activeGame.currentSeed,
      defaultValue: 'Started {{mode}} game (seed {{seed}}).'
    }),
    '#88ccff'
  );
  gameStarted.value = true;
  menuOpen.value = false;
};

const saveGame = async () => {
  if (!gameStarted.value) return;
  try {
    saveInfo.value = await saveSnapshot(activeGame.toSnapshot());
    storageTick.value++;
    logger.log(i18next.t('menu.log.game_saved', { defaultValue: 'Game saved.' }), '#88ff88');
  } catch {
    logger.log(i18next.t('menu.log.save_failed', { defaultValue: 'Save failed.' }), '#ff6666');
  }
};

const continueGame = async () => {
  try {
    const snapshot = await readSnapshot();
    if (!snapshot) return;
    if (!activeGame.loadSnapshot(snapshot)) {
      logger.log(i18next.t('menu.log.save_format_not_supported', { defaultValue: 'Save format not supported.' }), '#ff6666');
      return;
    }
    logger.log(i18next.t('menu.log.save_loaded', { defaultValue: 'Save loaded.' }), '#88ff88');
    storageTick.value++;
    gameStarted.value = true;
    menuOpen.value = false;
  } catch {
    logger.log(i18next.t('menu.log.failed_load_save', { defaultValue: 'Failed to load save.' }), '#ff6666');
  }
};

const deleteSave = async () => {
  try {
    await deleteSnapshot();
    saveInfo.value = null;
    storageTick.value++;
    logger.log(i18next.t('menu.log.save_deleted', { defaultValue: 'Save deleted.' }), '#ffaa88');
  } catch {
    logger.log(i18next.t('menu.log.failed_delete_save', { defaultValue: 'Failed to delete save.' }), '#ff6666');
  }
};

const saveReplay = () => {
  if (!gameStarted.value) return;
  try {
    window.localStorage.setItem(REPLAY_KEY, JSON.stringify(activeGame.exportRecording()));
    storageTick.value++;
    logger.log(i18next.t('menu.log.replay_saved', { defaultValue: 'Replay saved.' }), '#88ff88');
  } catch (error) {
    logger.log(error instanceof Error ? error.message : i18next.t('menu.log.replay_save_failed', { defaultValue: 'Replay save failed.' }), '#ff6666');
  }
};

const loadReplay = () => {
  try {
    const raw = window.localStorage.getItem(REPLAY_KEY);
    if (!raw) return;
    const recording = JSON.parse(raw);
    if (!activeGame.loadReplay(recording)) {
      logger.log(i18next.t('menu.log.replay_load_failed', { defaultValue: 'Replay load failed.' }), '#ff6666');
      return;
    }
    gameStarted.value = true;
    menuOpen.value = false;
    logger.log(i18next.t('menu.log.replay_loaded', { defaultValue: 'Replay loaded.' }), '#88ccff');
  } catch {
    logger.log(i18next.t('menu.log.replay_load_failed', { defaultValue: 'Replay load failed.' }), '#ff6666');
  }
};

const deleteReplay = () => {
  try {
    window.localStorage.removeItem(REPLAY_KEY);
    storageTick.value++;
    activeGame.clearReplay();
    logger.log(i18next.t('menu.log.replay_deleted', { defaultValue: 'Replay deleted.' }), '#ffaa88');
  } catch {
    logger.log(i18next.t('menu.log.replay_delete_failed', { defaultValue: 'Replay delete failed.' }), '#ff6666');
  }
};

const replayPlay = () => {
  activeGame.replayPlay();
};

const replayPause = () => {
  activeGame.replayPause();
};

const replayStep = () => {
  activeGame.replayStep();
};

const replayRestart = () => {
  activeGame.replayRestart();
};

const replaySeek = (index: number) => {
  activeGame.replaySeek(index);
};

const exportReplayJson = () => {
  try {
    const raw = window.localStorage.getItem(REPLAY_KEY);
    if (!raw) return;
    const blob = new Blob([raw], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brogue-web-replay-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    logger.log(i18next.t('menu.log.replay_exported', { defaultValue: 'Replay JSON exported.' }), '#88ccff');
  } catch {
    logger.log(i18next.t('menu.log.replay_export_failed', { defaultValue: 'Replay JSON export failed.' }), '#ff6666');
  }
};

const importReplayJson = async (file: File) => {
  try {
    const text = await file.text();
    const recording = JSON.parse(text);
    if (!activeGame.loadReplay(recording)) {
      logger.log(i18next.t('menu.log.replay_import_failed', { defaultValue: 'Replay JSON import failed.' }), '#ff6666');
      return;
    }
    window.localStorage.setItem(REPLAY_KEY, JSON.stringify(recording));
    storageTick.value++;
    gameStarted.value = true;
    menuOpen.value = false;
    logger.log(i18next.t('menu.log.replay_imported', { defaultValue: 'Replay JSON imported.' }), '#88ff88');
  } catch {
    logger.log(i18next.t('menu.log.replay_import_failed', { defaultValue: 'Replay JSON import failed.' }), '#ff6666');
  }
};

const handleReturnToTitle = async () => {
    // Return to menu logic
    activeGame.isGameOver = false;
    gameStarted.value = false;
    menuOpen.value = true;
    
    // Clear save if player was killed/won to prevent infinite loops of death
    try {
        await deleteSnapshot();
        saveInfo.value = null;
    } catch {}
    storageTick.value++;
};
</script>

<template>
  <div class="app-layout" :class="[`layout-${viewport.mode}`, { 'is-replaying': replayActive }]">
    <template v-if="gameStarted">
      <!-- FE-1：GameCanvas 始终是同一位置的同一实例（旋转屏幕不重建 Pixi），
           其余部件按布局模式挂载，用 CSS grid 区域摆放。 -->
      <MobileHud v-if="compact" class="area-hud" :mode="compactMode" @menu="menuOpen = true" @open-panel="panelOpen = true" />
      <div class="map-area">
        <GameCanvas class="game-view" />
        <MapZoomControls v-if="compact" />
      </div>
      <TargetBar class="area-target" />
      <CommandBar v-if="showTouch" class="area-cmd" :mode="viewport.mode" />
      <DPad v-if="showTouch" class="area-pad" :mode="viewport.mode" />
      <MessageStrip v-if="compact" class="area-strip" :lines="viewport.mode === 'landscape' ? 2 : 3" @open-panel="panelOpen = true" />
      <Sidebar v-if="!compact" />
      <SideDrawer v-if="compact" :open="panelOpen" @close="panelOpen = false">
        <Sidebar variant="drawer" />
      </SideDrawer>
      <InventoryOverlay />
      <GameEndOverlay @return-to-title="handleReturnToTitle" />
      <ReplayControls />
      <AgentControls class="agent-root" :hide-controls="compact || touchUi" />
      <DetailPanel />
      <ReferenceOverlay />
      <button v-if="!compact" class="menu-btn" @click="menuOpen = true">{{ $t('menu.actions.menu', { defaultValue: 'Menu' }) }}</button>
    </template>
    <div v-else class="blank-stage"></div>

    <MessageAcknowledgment />
    <MainMenu
      v-if="menuOpen"
      :has-save="hasSave"
      :has-replay="hasReplay"
      :in-game="gameStarted"
      :save-info="saveInfo"
      :replay-info="replayInfo"
      @new-game="startNewGame"
      @continue-game="continueGame"
      @save-game="saveGame"
      @delete-save="deleteSave"
      @save-replay="saveReplay"
      @load-replay="loadReplay"
      @delete-replay="deleteReplay"
      @replay-play="replayPlay"
      @replay-pause="replayPause"
      @replay-step="replayStep"
      @replay-restart="replayRestart"
      @replay-seek="replaySeek"
      @export-replay-json="exportReplayJson"
      @import-replay-json="importReplayJson"
      @close="menuOpen = false"
    />
  </div>
</template>

<style scoped>
.app-layout {
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  margin: 0;
  padding: 0;
  background-color: #000;
  color: #fff;
  display: grid;
  overflow: hidden;
}

/* 桌面：地图 + 右侧侧栏（与 v0.1.0 一致） */
.layout-desktop {
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: minmax(0, 1fr);
  grid-template-areas: "map side";
}

/* 竖屏：状态条 / 地图 / 消息 / 命令栏 + 方向键 */
.layout-portrait {
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  grid-template-areas:
    "hud hud"
    "map map"
    "strip strip"
    "cmd pad";
}

/* 横屏：左侧命令栏；右侧状态条 + 地图，消息与方向键浮在地图上 */
.layout-landscape {
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
  grid-template-areas:
    "cmd hud"
    "cmd map";
}

.map-area {
  grid-area: map;
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.game-view {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.area-hud { grid-area: hud; }
.area-strip { grid-area: strip; min-width: 0; }
.layout-landscape .area-strip {
  grid-area: map;
  align-self: end;
  justify-self: start;
  max-width: min(60%, 520px);
  z-index: 12;
  border-top-right-radius: 10px;
  pointer-events: auto;
}

/* 触控命令栏 / 方向键 / 目标选择条的网格落位 */
.area-cmd { grid-area: cmd; min-width: 0; }
.area-pad { grid-area: pad; }
.area-target {
  grid-area: map;
  align-self: end;
  justify-self: center;
}
.layout-landscape .area-target { align-self: start; }
.layout-landscape .area-pad {
  grid-area: map;
  align-self: end;
  justify-self: end;
}
.layout-desktop .area-cmd {
  grid-area: map;
  align-self: end;
  justify-self: start;
}
.layout-desktop .area-pad {
  grid-area: map;
  align-self: end;
  justify-self: end;
}

/* AgentControls 根节点不占网格单元（子元素本就绝对定位） */
.agent-root { display: contents; }

.blank-stage {
  grid-column: 1 / -1;
}

.menu-btn {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 1200;
  height: 30px;
  border: 1px solid var(--btn-border);
  background: var(--btn-bg);
  color: #e5e7eb;
  border-radius: 6px;
  padding: 0 10px;
  cursor: pointer;
}
</style>
