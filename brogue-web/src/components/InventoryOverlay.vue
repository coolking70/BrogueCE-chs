<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { useTranslation } from 'i18next-vue';
import { activeGame } from '../engine/Core/Game';
import { ItemCategory } from '../engine/Items/Item';
import type { Item } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { logger } from '../engine/Systems/Logger';
import { generateItemDetail } from '../engine/UI/DetailGenerator';

// Local reactive state for the inventory visibility
const isVisible = ref(false);
const inventoryItems = ref<Item[]>([]);
const selectedItem = ref<Item | null>(null);
// B-1b：鉴定目标待选态与 call 输入态（引擎态是普通单例，沿用本组件 100ms
// 轮询的既有模式镜像进 ref）
const pendingIdentify = ref(false);
const callTarget = ref<Item | null>(null);
const callText = ref('');

const updateInventoryState = () => {
    isVisible.value = activeGame.isInventoryOpen;
    pendingIdentify.value = activeGame.pendingIdentify;
    if (isVisible.value) {
        inventoryItems.value = [...activeGame.player.inventory.items];
    }
};

onMounted(() => {
    // We'll set up a simple tick or event listener to sync state
    const interval = setInterval(updateInventoryState, 100);
    
    // Cleanup
    onUnmounted(() => {
        clearInterval(interval);
    });
});

const closeInventory = () => {
    activeGame.isInventoryOpen = false;
    selectedItem.value = null;
    updateInventoryState();
};

const { t } = useTranslation();

// Group items into categories
const groupedItems = computed(() => {
    const groups: Record<string, { letter: string, item: Item }[]> = {
        '-- WEAPONS --': [],
        '-- ARMOR --': [],
        '-- POTIONS --': [],
        '-- SCROLLS --': [],
        '-- WANDS --': [],
        '-- STAFFS --': [],
        '-- RINGS --': [],
        '-- CHARMS --': [],
        '-- KEYS --': [],
        '-- AMULETS --': [],
        '-- FOOD --': [],
        '-- GOLD --': [],
        '-- OTHER --': []
    };

    // Assign letters a-z
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    
    inventoryItems.value.forEach((item, index) => {
        const letter = alphabet[index] || '?';
        const entry = { letter, item };
        
        switch (item.category) {
            case ItemCategory.WEAPON: groups['-- WEAPONS --']!.push(entry); break;
            case ItemCategory.ARMOR: groups['-- ARMOR --']!.push(entry); break;
            case ItemCategory.POTION: groups['-- POTIONS --']!.push(entry); break;
            case ItemCategory.SCROLL: groups['-- SCROLLS --']!.push(entry); break;
            case ItemCategory.WAND: groups['-- WANDS --']!.push(entry); break;
            case ItemCategory.STAFF: groups['-- STAFFS --']!.push(entry); break;
            case ItemCategory.RING: groups['-- RINGS --']!.push(entry); break;
            case ItemCategory.CHARM: groups['-- CHARMS --']!.push(entry); break;
            case ItemCategory.KEY: groups['-- KEYS --']!.push(entry); break;
            case ItemCategory.AMULET: groups['-- AMULETS --']!.push(entry); break;
            case ItemCategory.FOOD: groups['-- FOOD --']!.push(entry); break;
            case ItemCategory.GOLD: groups['-- GOLD --']!.push(entry); break;
            default: groups['-- OTHER --']!.push(entry); break;
        }
    });

    // Remove empty groups
    return Object.fromEntries(Object.entries(groups).filter(([_, items]) => items.length > 0));
});

// Helper to translate names using i18n
// Note: displayName already handles identification status, so we use it directly
const getLocalizedName = (name: string) => {
    // displayName already returns the correct name (with identification respect)
    // Just return it directly without further translation attempts
    return name;
};

const colorToCss = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

const isEquippable = (item: Item) => {
    return item.category === ItemCategory.WEAPON || item.category === ItemCategory.ARMOR || item.category === ItemCategory.RING;
};

const isEquipped = (item: Item) => {
    return activeGame.player.equippedWeapon?.id === item.id
        || activeGame.player.equippedArmor?.id === item.id
        || activeGame.player.ringLeft?.id === item.id
        || activeGame.player.ringRight?.id === item.id;
};

const isPotion = (item: Item) => item.category === ItemCategory.POTION;
const isScroll = (item: Item) => item.category === ItemCategory.SCROLL;
const isFood = (item: Item) => item.category === ItemCategory.FOOD;
const isArcanaUsable = (item: Item) =>
    item.category === ItemCategory.WAND || item.category === ItemCategory.STAFF || item.category === ItemCategory.CHARM;

// B-1b：call 只对五张风味种类表开放（CE call() Items.c:1423-1425 的
// tableForItemCategory 判定）；已识别种类与 CE 转题字的类别（武器/护甲/
// 护符等）不出现 Call 按钮（web 无题字功能，登记报告）。
const FLAVORED_CATEGORIES = new Set([
    ItemCategory.POTION, ItemCategory.SCROLL, ItemCategory.WAND, ItemCategory.STAFF, ItemCategory.RING,
]);
const kindIdOf = (item: Item): string | undefined =>
    (item as unknown as { consumableId?: string }).consumableId
    ?? (item as unknown as { identityId?: string }).identityId;
const isCallable = (item: Item) => {
    const kindId = kindIdOf(item);
    return !!kindId && FLAVORED_CATEGORIES.has(item.category)
        && !ItemLoader.identifiedItems.has(kindId);
};

const selectItem = (item: Item) => {
    selectedItem.value = selectedItem.value?.id === item.id ? null : item;
};

// B-1b：鉴定卷轴目标选择模式——行点击被拦截为"指定目标"，只有
// canBeIdentified 的物品可选中（CE promptForItemOfType 只列合法目标）。
const selectItemOrIdentify = (item: Item) => {
    if (pendingIdentify.value) {
        if (item.canBeIdentified) performIdentifySelect(item);
        return;
    }
    selectItem(item);
};

const performInspect = (item: Item) => {
    activeGame.inspectTarget = generateItemDetail(item, activeGame.player.strength);
};

const performEquip = (item: Item) => {
    activeGame.equipItem(item);
    closeInventory();
};

const performUnequip = (item: Item) => {
    if (item.isCursed) {
        logger.log(t('item.cannot_unequip_cursed', { defaultValue: 'You cannot unequip a cursed item!' }), '#ff4444');
        // Flash visual error logic could be here if we want it modal-centric
        return;
    }
    activeGame.unequipItem(item);
    closeInventory();
};

const performDrop = (item: Item) => {
    activeGame.dropItem(item);
    closeInventory();
};

const performQuaff = (item: Item) => {
    activeGame.quaffItem(item);
    closeInventory();
};

const performRead = (item: Item) => {
    activeGame.readItem(item);
    closeInventory();
};

const performThrow = (item: Item) => {
    activeGame.enterThrowMode(item);
    closeInventory();
};

const performEat = (item: Item) => {
    activeGame.eatItem(item);
    closeInventory();
};

const performUse = (item: Item) => {
    activeGame.useArcanaItem(item);
    closeInventory();
};

// ── B-1b：鉴定卷轴目标指定与 call 绰号 ─────────────────────────────
const performIdentifySelect = (item: Item) => {
    activeGame.chooseIdentifyTarget(item);
    updateInventoryState();
};

const openCallInput = (item: Item) => {
    callTarget.value = item;
    callText.value = ItemLoader.callTitles.get(kindIdOf(item) ?? '') ?? '';
};

const cancelCall = () => {
    callTarget.value = null;
    callText.value = '';
};

const confirmCall = () => {
    if (!callTarget.value) return;
    activeGame.callItem(callTarget.value, callText.value);
    cancelCall();
    updateInventoryState();
};
</script>

<template>
  <div v-if="isVisible" class="inventory-overlay" @click.self="closeInventory">
    <div class="inventory-modal">
      <div class="modal-header">
        <h2>{{ t('Your Inventory') || 'Your Inventory' }}</h2>
        <button class="close-btn" @click="closeInventory">×</button>
      </div>
      
      <div class="modal-content">
        <div v-if="pendingIdentify" class="identify-banner">
          {{ t('Identify what? (choose a highlighted item)') || 'Identify what? (choose a highlighted item)' }}
        </div>
        <div v-if="inventoryItems.length > 0">
           <div v-for="(items, category) in groupedItems" :key="category" class="category-block">
              <h3 class="category-title">{{ t(category) || category }}</h3>
              <ul class="item-list">
                <li v-for="entry in items" :key="entry.letter" class="item-wrapper">
                  <div class="item-row" @click="selectItemOrIdentify(entry.item)"
                       :class="{ 'selected-row': selectedItem?.id === entry.item.id,
                                 'identify-candidate': pendingIdentify && entry.item.canBeIdentified }">
                    <span class="item-letter">{{ entry.letter }})</span>
                    <span class="item-char" :style="{ color: colorToCss(entry.item.color) }">{{ entry.item.char }}</span>
                    <span class="item-name">
                       {{ getLocalizedName(entry.item.displayName) }}
                       <span v-if="isEquipped(entry.item)" class="equipped-tag">{{ t('(equipped)') || '(equipped)' }}</span>
                       <span v-if="entry.item.strengthRequired && activeGame.player.strength < entry.item.strengthRequired" class="strength-warning">
                           {{ t('[Req Str:') || '[Req Str:' }} {{ entry.item.strengthRequired }}]
                       </span>
                    </span>
                  </div>
                  <div v-if="selectedItem?.id === entry.item.id && !pendingIdentify" class="item-actions">
                     <button @click="performInspect(entry.item)" class="action-btn">{{ t('item.inspect', { defaultValue: '查看详情' }) }}</button>
                     <button v-if="isEquippable(entry.item) && !isEquipped(entry.item)" @click="performEquip(entry.item)" class="action-btn">{{ t('Equip') || 'Equip' }}</button>
                     <button v-if="isEquippable(entry.item) && isEquipped(entry.item)" @click="performUnequip(entry.item)" class="action-btn">{{ t('Unequip') || 'Unequip' }}</button>

                     <button v-if="isPotion(entry.item)" @click="performQuaff(entry.item)" class="action-btn">{{ t('Quaff') || 'Quaff' }}</button>
                     <button v-if="isScroll(entry.item)" @click="performRead(entry.item)" class="action-btn">{{ t('Read') || 'Read' }}</button>
                     <button v-if="isFood(entry.item)" @click="performEat(entry.item)" class="action-btn">{{ t('Eat') || 'Eat' }}</button>
                     <button v-if="isArcanaUsable(entry.item)" @click="performUse(entry.item)" class="action-btn">{{ t('Use') || 'Use' }}</button>

                     <button v-if="isCallable(entry.item)" @click="openCallInput(entry.item)" class="action-btn">{{ t('Call') || 'Call' }}</button>

                     <button @click="performThrow(entry.item)" class="action-btn">{{ t('Throw') || 'Throw' }}</button>
                     <button @click="performDrop(entry.item)" class="action-btn danger">{{ t('Drop') || 'Drop' }}</button>
                  </div>
                  <!-- B-1b：call 绰号输入（CE getInputTextString，Items.c:1423） -->
                  <div v-if="callTarget?.id === entry.item.id" class="item-actions call-input-row">
                    <span class="call-label">{{ t('Call them:') || 'Call them:' }}</span>
                    <input v-model="callText" class="call-input" maxlength="29"
                           @keyup.enter="confirmCall" :placeholder="t('max 29 chars') || 'max 29 chars'" />
                    <button @click="confirmCall" class="action-btn">{{ t('Name it') || 'Name it' }}</button>
                    <button @click="cancelCall" class="action-btn danger">{{ t('Cancel') || 'Cancel' }}</button>
                  </div>
                </li>
              </ul>
           </div>
        </div>
        <div v-else class="empty-msg">
          {{ t('Your pack is empty.') || 'Your pack is empty.' }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.inventory-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: rgba(0, 0, 0, 0.4);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  /* Additional blur handled by child panel */
}

.inventory-modal {
  width: 650px;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
  border: 1px solid var(--border-color);
  background: var(--bg-panel);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem;
  background: linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.02) 100%);
  border-bottom: 1px solid rgba(255,255,255,0.08);
}

.modal-header h2 {
  margin: 0;
  font-family: var(--font-main);
  font-weight: 700;
  font-size: 1.4rem;
  letter-spacing: 1px;
  color: var(--text-primary);
  text-shadow: 0 2px 4px rgba(0,0,0,0.5);
}

.close-btn {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 1.5rem;
  line-height: 1;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}

.close-btn:hover {
  background: rgba(255,255,255,0.15);
  color: #fff;
  transform: scale(1.05);
}

.modal-content {
  padding: 1.5rem;
  overflow-y: auto;
  flex: 1;
}

/* B-1b：鉴定目标选择横幅与候选高亮 */
.identify-banner {
  margin-bottom: 1rem;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: rgba(0, 255, 255, 0.08);
  border: 1px solid rgba(0, 255, 255, 0.3);
  color: #7fe9e9;
  font-family: var(--font-main);
  font-weight: 600;
  text-align: center;
  letter-spacing: 0.5px;
}

.item-row.identify-candidate {
  cursor: pointer;
  background: rgba(0, 255, 255, 0.06);
}
.item-row.identify-candidate:hover {
  background: rgba(0, 255, 255, 0.14);
}

/* B-1b：call 绰号输入行 */
.call-input-row {
  align-items: center;
}
.call-label {
  color: var(--text-secondary);
  font-family: var(--font-main);
  font-size: 0.9rem;
  white-space: nowrap;
}
.call-input {
  flex: 1;
  min-width: 120px;
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  color: #e4e4e7;
  padding: 6px 10px;
  font-family: var(--font-mono);
  font-size: 0.95rem;
  outline: none;
}
.call-input:focus {
  border-color: rgba(221, 136, 255, 0.6);
}

.category-block {
  margin-bottom: 1.5rem;
  background: rgba(0,0,0,0.2);
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.03);
  overflow: hidden;
}

.category-title {
  color: var(--text-secondary);
  font-family: var(--font-main);
  font-weight: 600;
  font-size: 0.9rem;
  margin: 0;
  padding: 0.75rem 1rem;
  background: rgba(0,0,0,0.3);
  border-bottom: 1px solid rgba(255,255,255,0.03);
  text-transform: uppercase;
  letter-spacing: 1px;
}

.strength-warning {
  color: #ff5555;
  font-size: 0.85em;
  margin-left: 0.5rem;
  font-weight: bold;
}

.item-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.item-wrapper {
  border-bottom: 1px solid rgba(255,255,255,0.02);
}
.item-wrapper:last-child {
  border-bottom: none;
}

.item-row {
  display: flex;
  align-items: center;
  padding: 0.75rem 1rem;
  cursor: pointer;
  transition: background-color 0.2s;
  font-family: var(--font-mono);
  font-size: 1rem;
}

.item-row:hover {
  background: rgba(255,255,255,0.04);
}

.selected-row {
  background: rgba(56, 189, 248, 0.1) !important;
  border-left: 3px solid var(--color-accent);
  padding-left: calc(1rem - 3px);
}

.item-letter {
  color: rgba(255,255,255,0.4);
  font-weight: 600;
  margin-right: 15px;
  min-width: 25px;
  font-size: 0.9rem;
}

.item-char {
  font-weight: bold;
  margin-right: 15px;
  font-size: 1.25rem;
  text-shadow: 0 0 8px currentColor;
}

.item-name {
  color: #e4e4e7;
  display: flex;
  align-items: center;
  gap: 10px;
}

.equipped-tag {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.3);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-family: var(--font-main);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.item-actions {
  display: flex;
  gap: 10px;
  padding: 1rem 1rem 1rem 3.5rem;
  background: rgba(0,0,0,0.4);
  box-shadow: inset 0 2px 8px rgba(0,0,0,0.2);
}

.action-btn {
  background: rgba(255,255,255,0.08);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 6px 16px;
  cursor: pointer;
  font-family: var(--font-main);
  font-weight: 500;
  font-size: 0.9rem;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 2px 4px rgba(0,0,0,0.2);
}

.action-btn:hover {
  background: rgba(255,255,255,0.15);
  transform: translateY(-1px);
  box-shadow: 0 4px 8px rgba(0,0,0,0.3);
}

.action-btn:active {
  transform: translateY(1px);
}

.action-btn.danger {
  background: rgba(239, 68, 68, 0.15);
  border-color: rgba(239, 68, 68, 0.3);
  color: #fca5a5;
}

.action-btn.danger:hover {
  background: rgba(239, 68, 68, 0.3);
  color: #fff;
}

.empty-msg {
  text-align: center;
  color: var(--text-secondary);
  font-family: var(--font-main);
  font-weight: 500;
  padding: 3rem 0;
  background: rgba(0,0,0,0.2);
  border-radius: 8px;
  border: 1px dashed rgba(255,255,255,0.1);
}
</style>
