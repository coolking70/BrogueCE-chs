<script setup lang="ts">
// FE-1：目标选择条（投掷 / 法杖 / 魔杖 / 护符瞄准期间出现，桌面与触屏通用）。
// 确认/下一个/取消都经 ui/commands（录制边界）；瞄准格本身是纯 UI 状态。
import { computed, ref, watch } from 'vue';
import { useTranslation } from 'i18next-vue';
import { activeGame } from '../engine/Core/Game';
import { useGameHud } from '../ui/useGameHud';
import { dispatch, travelTo } from '../ui/commands';
import { clearAim, targetingState } from '../ui/targeting';

const { t } = useTranslation();
const { targeting } = useGameHud();
const itemName = ref('');
const cancelUnsupported = ref(false);

watch(targeting, (mode) => {
  itemName.value = mode === 'arcana'
    ? activeGame.pendingArcana?.item.displayName ?? ''
    : mode === 'throw' ? activeGame.throwItemTarget?.displayName ?? '' : '';
  if (mode !== 'throw') {
    clearAim();
    cancelUnsupported.value = false;
  }
}, { immediate: true });

const prompt = computed(() => {
  if (targeting.value === 'arcana') return t('mobile.target.arcana_prompt', { name: itemName.value, interpolation: { escapeValue: false } });
  if (cancelUnsupported.value) return t('mobile.target.throw_cancel_unsupported');
  return targetingState.aim
    ? t('mobile.target.throw_confirm_prompt', { name: itemName.value, interpolation: { escapeValue: false } })
    : t('mobile.target.throw_prompt', { name: itemName.value, interpolation: { escapeValue: false } });
});

const canConfirm = computed(() => targeting.value === 'arcana' || !!targetingState.aim);

const confirm = () => {
  if (targeting.value === 'arcana') {
    dispatch('confirm_target');
    return;
  }
  const aim = targetingState.aim;
  if (!aim) return;
  clearAim();
  travelTo(aim.x, aim.y);
};

const next = () => dispatch('cycle_target', 1);

const cancel = () => {
  const wasThrow = targeting.value === 'throw';
  clearAim();
  dispatch('escape');
  // 引擎目前没有取消投掷模式的命令（isThrowing 只在投出后清零，桌面 Esc 同样无效），
  // 见 fe-1 报告"引擎接口需求 #1"。这里如实提示，不在 UI 层伪造取消。
  if (wasThrow && activeGame.isThrowing) cancelUnsupported.value = true;
};
</script>

<template>
  <div v-if="targeting !== 'none'" class="target-bar" role="toolbar" :aria-label="$t('mobile.target.title')">
    <div class="target-prompt">{{ prompt }}</div>
    <div class="target-actions">
      <button class="tb-btn primary" :disabled="!canConfirm" @click="confirm">{{ $t('mobile.target.confirm') }}</button>
      <button v-if="targeting === 'arcana'" class="tb-btn" @click="next">{{ $t('mobile.target.next') }}</button>
      <button class="tb-btn danger" @click="cancel">{{ $t('mobile.target.cancel') }}</button>
    </div>
  </div>
</template>

<style scoped>
.target-bar {
  box-sizing: border-box;
  width: min(94%, 520px);
  margin: 8px;
  padding: 8px 10px;
  border-radius: 12px;
  border: 1px solid #ffcc4466;
  background: #14120cf0;
  box-shadow: 0 8px 24px #000a;
  z-index: 14;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.target-prompt {
  color: #fde68a;
  font-size: 0.9rem;
  line-height: 1.35;
}
.target-actions { display: flex; gap: 8px; }
.tb-btn {
  flex: 1;
  min-height: 44px;
  border-radius: 10px;
  border: 1px solid var(--panel-border, #ffffff26);
  background: var(--btn-bg, #1f2430);
  color: var(--text-primary);
  font-size: 0.95rem;
  cursor: pointer;
  touch-action: manipulation;
}
.tb-btn.primary { background: #3b3212; border-color: #ffcc4488; color: #fde68a; }
.tb-btn.danger { background: #3f1313; border-color: #ef444466; color: #fca5a5; }
.tb-btn:disabled { opacity: 0.45; border-style: dashed; cursor: not-allowed; }
</style>
