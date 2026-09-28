/**
 * src/ui/useGameHud.ts — FE-1 紧凑状态条 / 消息条的只读轮询。
 *
 * 沿用 Sidebar.vue 的 100ms 轮询模式（引擎是纯 TS 单例，无响应式），
 * 只读取玩家可见的显示信息，不调用任何改状态的方法。
 */
import { onMounted, onUnmounted, ref } from 'vue';
import i18next from 'i18next';
import { activeGame } from '../engine/Core/Game';
import { logger, type LogMessage } from '../engine/Systems/Logger';
import { creatureStatusRows, isSidebarVisibleStatus } from '../engine/Status/statusConfig';
import { STOMACH_SIZE, HUNGER_THRESHOLD, WEAK_THRESHOLD, FAINT_THRESHOLD } from '../entities/Player';

/** 与 Sidebar.getNutritionStatus 同一档位（CE Rogue.h:1125-1127）。 */
export function nutritionStatus(nutrition: number): { text: string; color: string } {
    if (nutrition <= 0) return { text: i18next.t('sidebar.hunger.starved'), color: '#b91c1c' };
    if (nutrition <= FAINT_THRESHOLD) return { text: i18next.t('sidebar.hunger.faint'), color: '#ef4444' };
    if (nutrition <= WEAK_THRESHOLD) return { text: i18next.t('sidebar.hunger.weak'), color: '#f87171' };
    if (nutrition <= HUNGER_THRESHOLD) return { text: i18next.t('sidebar.hunger.hungry'), color: '#facc15' };
    return { text: i18next.t('sidebar.hunger.full'), color: '#4ade80' };
}

export function useGameHud(logCount = 3) {
    const hp = ref(0);
    const maxHp = ref(0);
    const depth = ref(1);
    const nutrition = ref(STOMACH_SIZE);
    const statuses = ref<ReturnType<typeof creatureStatusRows>>([]);
    const logs = ref<LogMessage[]>([]);
    const hoverText = ref('');
    const replayActive = ref(false);
    const targeting = ref<'none' | 'throw' | 'arcana'>('none');

    const poll = () => {
        const game = activeGame;
        if (!game?.player) return;
        hp.value = game.player.hp;
        maxHp.value = game.player.maxHp;
        depth.value = game.depth;
        nutrition.value = game.player.nutrition;
        statuses.value = creatureStatusRows(game.player, isSidebarVisibleStatus);
        const all = logger.messages;
        logs.value = all.slice(Math.max(0, all.length - logCount)).reverse();
        hoverText.value = game.hoveredText;
        replayActive.value = !!game.replayRecording;
        targeting.value = game.pendingArcana ? 'arcana' : game.isThrowing ? 'throw' : 'none';
    };

    let timer = 0;
    onMounted(() => {
        poll();
        timer = window.setInterval(poll, 100);
    });
    onUnmounted(() => window.clearInterval(timer));

    return { hp, maxHp, depth, nutrition, statuses, logs, hoverText, replayActive, targeting, poll };
}
