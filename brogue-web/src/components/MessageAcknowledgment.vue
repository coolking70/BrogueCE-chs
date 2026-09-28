<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { activeGame } from '../engine/Core/Game';
import { logger, type LogMessage } from '../engine/Systems/Logger';
import { acknowledgmentKeys } from '../ui/messageAcknowledgment';

const pending = ref<LogMessage>();
const keys = acknowledgmentKeys();
let timer = 0;
const poll = () => { pending.value = logger.pendingAcknowledgment; };
const acknowledge = () => { logger.acknowledgeNext(); poll(); };
onMounted(() => {
    logger.presentAcknowledgments(() => !activeGame.replayRecording);
    window.addEventListener('keydown', keys.keydown, true);
    window.addEventListener('keyup', keys.keyup, true);
    timer = window.setInterval(poll, 50);
});
onUnmounted(() => {
    window.clearInterval(timer);
    window.removeEventListener('keydown', keys.keydown, true);
    window.removeEventListener('keyup', keys.keyup, true);
    logger.presentAcknowledgments(null);
});
</script>

<template>
  <div v-if="pending" class="message-ack-backdrop" @pointerdown.stop @pointerup.stop @click.stop>
    <div class="message-ack" role="alertdialog" aria-modal="true" aria-describedby="ack-message">
      <p id="ack-message">{{ pending.text }}</p>
      <button type="button" @click.stop="acknowledge">{{ $t('messages.more', { defaultValue: '--MORE--' }) }}</button>
      <small>{{ $t('messages.acknowledge_hint', { defaultValue: 'Click or press a key to continue.' }) }}</small>
    </div>
  </div>
</template>

<style scoped>
.message-ack-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: grid;
  place-items: center;
  padding: max(16px, env(safe-area-inset-top)) 16px;
  background: #0009;
  touch-action: none;
}
.message-ack {
  box-sizing: border-box;
  width: min(100%, 560px);
  max-height: 90dvh;
  overflow: auto;
  border: 2px solid #facc15;
  border-radius: 10px;
  padding: 22px;
  background: #18181b;
  color: #fef3c7;
  box-shadow: 0 12px 48px #000b;
  text-align: center;
}
p { margin: 0 0 18px; line-height: 1.6; overflow-wrap: anywhere; }
button { min-height: 44px; padding: 8px 24px; border: 0; border-radius: 5px; background: #facc15; color: #18181b; font-weight: bold; cursor: pointer; }
small { display: block; margin-top: 12px; color: #e4e4e7; }
</style>
