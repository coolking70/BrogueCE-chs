<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { activeGame } from '../engine/Core/Game';
import { getDiscoveries } from '../engine/UI/Discoveries';

// FE-1：原先标题/分组名/帮助条目以 `zh ? '中文' : 'English'` 硬编码在脚本里，
// 现全部迁入 zh_CN.json（审查 P-22），并补充触屏操作说明。
const { t } = useTranslation();
const screen = ref<'discoveries' | 'help' | null>(null);
const groups = computed(() => { screen.value; return getDiscoveries(); });
const columns = computed(() => [[groups.value[0], groups.value[1]], [groups.value[2]], [groups.value[3], groups.value[4]]]);
const title = computed(() => screen.value === 'help' ? t('reference.help_title') : t('reference.discoveries_title'));
const labels = computed<Record<string, string>>(() => ({
  scrolls: t('reference.group.scrolls'), rings: t('reference.group.rings'), potions: t('reference.group.potions'),
  staffs: t('reference.group.staffs'), wands: t('reference.group.wands'),
}));
const commands = computed(() => [
  ['h j k l y u b n / ↑ ↓ ← →', t('reference.cmd.move')],
  ['i / I', t('reference.cmd.inventory')], ['a', t('reference.cmd.apply')],
  ['t', t('reference.cmd.throw')], ['g', t('reference.cmd.pickup')],
  ['s / S', t('reference.cmd.search')], ['. / 。', t('reference.cmd.rest_or_descend')],
  ['< / ,', t('reference.cmd.ascend')], ['>', t('reference.cmd.descend')],
  ['x', t('reference.cmd.examine')], ['X', t('reference.cmd.explore')],
  ['D', t('reference.cmd.discoveries')], ['?', t('reference.cmd.help')],
  ['Esc', t('reference.cmd.cancel')],
]);
const touchCommands = computed(() => [
  [t('reference.touch.tap_key'), t('reference.touch.tap')],
  [t('reference.touch.long_press_key'), t('reference.touch.long_press')],
  [t('reference.touch.drag_key'), t('reference.touch.drag')],
  [t('reference.touch.pinch_key'), t('reference.touch.pinch')],
  [t('reference.touch.dpad_key'), t('reference.touch.dpad')],
  [t('reference.touch.target_key'), t('reference.touch.target')],
]);
let timer = 0;
function close() {
  activeGame.executeCommand('escape');
  screen.value = activeGame.referenceScreen;
}
function onKey(e: KeyboardEvent) {
  if (!screen.value) return;
  e.preventDefault(); e.stopImmediatePropagation(); close();
}
onMounted(() => {
  timer = window.setInterval(() => { screen.value = activeGame.referenceScreen; }, 100);
  window.addEventListener('keydown', onKey, true);
});
onUnmounted(() => { window.clearInterval(timer); window.removeEventListener('keydown', onKey, true); });
</script>

<template>
  <Teleport to="body">
    <div v-if="screen" class="reference-backdrop" @click.self="close">
      <section class="reference-panel" role="dialog" :aria-label="title">
        <header><h2>{{ title }}</h2><button @click="close" :aria-label="$t('mobile.close')">×</button></header>
        <div v-if="screen === 'discoveries'" class="discovery-grid">
          <div v-for="(column, index) in columns" :key="index" class="discovery-column"><section v-for="group in column" :key="group!.label" class="discovery-group">
            <h3>{{ labels[group!.label] }}</h3>
            <div v-for="row in group!.rows" :key="row.id" class="discovery-row" :class="{ known: row.known }">
              <span class="sigil" :class="{ good: row.suffix === 1, bad: row.suffix === -1 }">{{ row.suffix === 1 ? '⧳' : row.suffix === -1 ? '⧲' : row.known ? ({ scrolls: '?', rings: '=', potions: '!', staffs: '/', wands: '-' }[group!.label]) : ' ' }}</span>
              <span>{{ row.name }}<small v-if="row.percentage !== undefined"> ({{ row.percentage }}%)</small></span>
            </div>
          </section></div>
        </div>
        <template v-else>
          <div class="help-list"><div v-for="command in commands" :key="command[0]"><kbd>{{ command[0] }}</kbd><span>{{ command[1] }}</span></div></div>
          <h3 class="help-subtitle">{{ $t('reference.touch.title') }}</h3>
          <div class="help-list"><div v-for="command in touchCommands" :key="command[0]"><kbd>{{ command[0] }}</kbd><span>{{ command[1] }}</span></div></div>
        </template>
        <footer>{{ $t('reference.close_hint') }}</footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.reference-backdrop{position:fixed;inset:0;z-index:1900;background:#000c;display:grid;place-items:center;padding:12px}
.reference-panel{width:min(920px,100%);max-height:calc(100dvh - 24px);overflow:auto;background:#101827;color:#ddd;border:1px solid #64748b;border-radius:8px;padding:16px;box-sizing:border-box}
header{display:flex;justify-content:space-between;align-items:center}h2{margin:0 0 12px}button{background:none;border:1px solid #64748b;color:#fff;font-size:24px;cursor:pointer}h3{color:#c4b5fd;margin:8px 0}.discovery-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:start}.discovery-column,.discovery-group{min-width:0}.discovery-group+.discovery-group{margin-top:20px}.discovery-row{display:flex;gap:8px;color:#6b7280;padding:3px 0;overflow-wrap:anywhere}.discovery-row.known{color:white}.sigil{width:1.2em;flex:none;color:#d8c9a1}.sigil.good{color:#59c987}.sigil.bad{color:#db7878}.help-list{display:grid;grid-template-columns:1fr 1fr;gap:8px}.help-list>div{display:flex;gap:12px}.help-list kbd{color:#facc15;min-width:90px}footer{text-align:center;color:#94a3b8;margin-top:16px}@media(max-width:650px){.discovery-grid,.help-list{grid-template-columns:1fr}.reference-panel{font-size:14px}}
/* FE-1：紧凑模式——全屏面板、关闭钮 44px、尊重安全区 */
@media (max-width: 1023px), (max-height: 599px) {
  .reference-backdrop{padding:0}
  .reference-panel{width:100%;max-height:100dvh;height:100dvh;border-radius:0;border:none;padding:max(12px,env(safe-area-inset-top)) max(14px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left))}
  header button{width:44px;height:44px;border-radius:10px}
}
@media (max-height: 599px) and (min-width: 651px){.discovery-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
</style>
