<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import i18next from 'i18next';
import { activeGame } from '../engine/Core/Game';
import { getDiscoveries } from '../engine/UI/Discoveries';

const screen = ref<'discoveries' | 'help' | null>(null);
const groups = computed(() => { screen.value; return getDiscoveries(); });
const columns = computed(() => [[groups.value[0], groups.value[1]], [groups.value[2]], [groups.value[3], groups.value[4]]]);
const zh = computed(() => i18next.language?.startsWith('zh'));
const title = computed(() => screen.value === 'help' ? (zh.value ? '命令帮助' : 'Commands') : (zh.value ? '发现物品' : 'Discovered items'));
const labels: Record<string, [string, string]> = {
  scrolls: ['卷轴', 'Scrolls'], rings: ['戒指', 'Rings'], potions: ['药水', 'Potions'],
  staffs: ['法杖', 'Staffs'], wands: ['魔杖', 'Wands'],
};
const commands = [
  ['h j k l y u b n / ↑ ↓ ← →', '移动或攻击', 'Move or attack'],
  ['i / I', '背包', 'Inventory'], ['a', '使用物品（打开背包）', 'Apply item (open inventory)'],
  ['t', '投掷（打开背包）', 'Throw (open inventory)'], ['g', '拾取', 'Pick up'],
  ['s / S', '搜索', 'Search'], ['. / 。', '等待或下楼', 'Rest or descend'],
  ['< / ,', '上楼', 'Ascend'], ['>', '下楼', 'Descend'],
  ['x', '查看', 'Examine'], ['X', '自动探索', 'Auto explore'],
  ['D', '发现物品', 'Discovered items'], ['?', '命令帮助', 'Help'],
  ['Esc', '取消或关闭', 'Cancel or close'],
];
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
        <header><h2>{{ title }}</h2><button @click="close" :aria-label="zh ? '关闭' : 'Close'">×</button></header>
        <div v-if="screen === 'discoveries'" class="discovery-grid">
          <div v-for="(column, index) in columns" :key="index" class="discovery-column"><section v-for="group in column" :key="group!.label" class="discovery-group">
            <h3>{{ labels[group!.label]?.[zh ? 0 : 1] }}</h3>
            <div v-for="row in group!.rows" :key="row.id" class="discovery-row" :class="{ known: row.known }">
              <span class="sigil" :class="{ good: row.suffix === 1, bad: row.suffix === -1 }">{{ row.suffix === 1 ? '⧳' : row.suffix === -1 ? '⧲' : row.known ? ({ scrolls: '?', rings: '=', potions: '!', staffs: '/', wands: '-' }[group!.label]) : ' ' }}</span>
              <span>{{ row.name }}<small v-if="row.percentage !== undefined"> ({{ row.percentage }}%)</small></span>
            </div>
          </section></div>
        </div>
        <div v-else class="help-list"><div v-for="command in commands" :key="command[0]"><kbd>{{ command[0] }}</kbd><span>{{ command[zh ? 1 : 2] }}</span></div></div>
        <footer>{{ zh ? '按任意键或点击空白处关闭' : 'Press any key or click outside to close' }}</footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.reference-backdrop{position:fixed;inset:0;z-index:1900;background:#000c;display:grid;place-items:center;padding:12px}
.reference-panel{width:min(920px,100%);max-height:calc(100dvh - 24px);overflow:auto;background:#101827;color:#ddd;border:1px solid #64748b;border-radius:8px;padding:16px;box-sizing:border-box}
header{display:flex;justify-content:space-between;align-items:center}h2{margin:0 0 12px}button{background:none;border:1px solid #64748b;color:#fff;font-size:24px;cursor:pointer}h3{color:#c4b5fd;margin:8px 0}.discovery-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;align-items:start}.discovery-column,.discovery-group{min-width:0}.discovery-group+.discovery-group{margin-top:20px}.discovery-row{display:flex;gap:8px;color:#6b7280;padding:3px 0;overflow-wrap:anywhere}.discovery-row.known{color:white}.sigil{width:1.2em;flex:none;color:#d8c9a1}.sigil.good{color:#59c987}.sigil.bad{color:#db7878}.help-list{display:grid;grid-template-columns:1fr 1fr;gap:8px}.help-list>div{display:flex;gap:12px}.help-list kbd{color:#facc15;min-width:90px}footer{text-align:center;color:#94a3b8;margin-top:16px}@media(max-width:650px){.discovery-grid,.help-list{grid-template-columns:1fr}.reference-panel{font-size:14px}}
</style>
