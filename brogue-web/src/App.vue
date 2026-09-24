<script lang="ts">
// UI-1 第 6 条：Game.onConfirmRequest（C-5 落下的钩子，Game.ts:408）的生产侧接线。
// 引擎的 requestConfirm 是**同步**契约（CE confirm() 在文本框里自旋等键，IO.c:2946-2975），
// 所以这里用浏览器原生 confirm()——它是 web 平台唯一能同步阻塞等答案的模态，
// 且按键语义与 CE 完全同构：Enter = OK = Yes（CE RETURN_KEY 挂在 Yes 钮，
// IO.c:2956）、Esc = Cancel = No（CE ESCAPE_KEY 挂在 No 钮，IO.c:2966；
// ACKNOWLEDGE_KEY = ' ' 同样映射 No，Rogue.h:1179）。
// 纯逻辑（回放/自动寻路旁路）拆成可单测的导出函数；测试见 ui_1_rendering.test.ts。
import type { Game } from './engine/Core/Game';

export function wireConfirmRequest(game: Game): void {
    game.onConfirmRequest = (message: string): boolean => {
        // CE IO.c:2941-2943：回放/自动演示期间 confirm 一律放行（"oh yes he did"），
        // 否则回放会在对话框上卡死、自动化会被阻塞。
        if (game.replayStatus === 'playing' || game.isAutoTraveling()) return true;
        return window.confirm(message);
    };
}
</script>

<script setup lang="ts">
import { computed, ref } from 'vue';
import i18next from 'i18next';
import GameCanvas from './components/GameCanvas.vue';
import Sidebar from './components/Sidebar.vue';
import InventoryOverlay from './components/InventoryOverlay.vue';
import GameEndOverlay from './components/GameEndOverlay.vue';
import MainMenu from './components/MainMenu.vue';
import ReplayControls from './components/ReplayControls.vue';
import AgentControls from './components/AgentControls.vue';
import DetailPanel from './components/DetailPanel.vue';
import ReferenceOverlay from './components/ReferenceOverlay.vue';
import { activeGame, type GameMode } from './engine/Core/Game';
import { logger } from './engine/Systems/Logger';

const SAVE_KEY = 'brogue-web-save-v1';
const REPLAY_KEY = 'brogue-web-replay-v1';

// UI-1 第 6 条：把引擎确认钩子接到本组件（headless/测试环境不挂载 App，
// 钩子保持 null → requestConfirm 按"确认"处理，与 C-5 申报一致）。
wireConfirmRequest(activeGame);

const gameStarted = ref(false);
const menuOpen = ref(true);
const storageTick = ref(0);

const saveInfo = computed(() => {
  storageTick.value;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const snapshot = JSON.parse(raw);
    if (!snapshot || snapshot.version !== 1) return null;
    return {
      depth: snapshot.depth,
      seed: snapshot.seed,
      mode: snapshot.mode,
      savedAt: snapshot.savedAt ?? 0
    };
  } catch {
    return null;
  }
});

const hasSave = computed(() => {
  storageTick.value;
  try {
    return !!window.localStorage.getItem(SAVE_KEY);
  } catch {
    return false;
  }
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

const startNewGame = (payload: { seed?: number; mode: GameMode }) => {
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

const saveGame = () => {
  if (!gameStarted.value) return;
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(activeGame.toSnapshot()));
    storageTick.value++;
    logger.log(i18next.t('menu.log.game_saved', { defaultValue: 'Game saved.' }), '#88ff88');
  } catch {
    logger.log(i18next.t('menu.log.save_failed', { defaultValue: 'Save failed.' }), '#ff6666');
  }
};

const continueGame = () => {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return;
    const snapshot = JSON.parse(raw);
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

const deleteSave = () => {
  try {
    window.localStorage.removeItem(SAVE_KEY);
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
  } catch {
    logger.log(i18next.t('menu.log.replay_save_failed', { defaultValue: 'Replay save failed.' }), '#ff6666');
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

const handleReturnToTitle = () => {
    // Return to menu logic
    activeGame.isGameOver = false;
    gameStarted.value = false;
    menuOpen.value = true;
    
    // Clear save if player was killed/won to prevent infinite loops of death
    try {
        window.localStorage.removeItem(SAVE_KEY);
    } catch {}
    storageTick.value++;
};
</script>

<template>
  <div class="app-layout">
    <template v-if="gameStarted">
      <GameCanvas class="game-view" />
      <Sidebar />
      <InventoryOverlay />
      <GameEndOverlay @return-to-title="handleReturnToTitle" />
      <ReplayControls />
      <AgentControls />
      <DetailPanel />
      <ReferenceOverlay />
      <button class="menu-btn" @click="menuOpen = true">{{ $t('menu.actions.menu', { defaultValue: 'Menu' }) }}</button>
    </template>
    <div v-else class="blank-stage"></div>

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
  margin: 0;
  padding: 0;
  background-color: #000;
  color: #fff;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}

.game-view {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.blank-stage {
  flex: 1;
}

.menu-btn {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 1200;
  height: 30px;
  border: 1px solid #4b5563;
  background: #111827cc;
  color: #e5e7eb;
  border-radius: 6px;
  padding: 0 10px;
  cursor: pointer;
}
</style>
