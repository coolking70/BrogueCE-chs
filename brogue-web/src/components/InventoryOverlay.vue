<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, toRaw } from 'vue';
import { useTranslation } from 'i18next-vue';
import i18next from 'i18next';
import { activeGame } from '../engine/Core/Game';
import { ItemCategory } from '../engine/Items/Item';
import type { Item } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { generateItemDetail } from '../engine/UI/DetailGenerator';
import { createItemDetailContext } from '../engine/UI/ItemDetailContext';

// Local reactive state for the inventory visibility
const isVisible = ref(false);
const inventoryItems = ref<Item[]>([]);
const selectedItem = ref<Item | null>(null);
const inventoryAction = ref<typeof activeGame.inventoryAction>(null);
// B-1b：鉴定目标待选态与 call 输入态（引擎态是普通单例，沿用本组件 100ms
// 轮询的既有模式镜像进 ref）
const pendingIdentify = ref(false);
const pendingEnchantment = ref(false);
const callTarget = ref<Item | null>(null);
const callText = ref('');
// B-1c：恶意品使用确认的待决态（引擎 Game.pendingUseConfirm 的镜像）
const pendingUseConfirm = ref<Item | null>(null);
const pendingUseConfirmText = ref('');

const updateInventoryState = () => {
    if (inventoryAction.value !== activeGame.inventoryAction || !activeGame.isInventoryOpen) {
        selectedItem.value = null;
        callTarget.value = null;
        callText.value = '';
    }
    inventoryAction.value = activeGame.inventoryAction;
    isVisible.value = activeGame.isInventoryOpen;
    pendingIdentify.value = activeGame.pendingIdentify;
    pendingEnchantment.value = activeGame.pendingEnchantment;
    pendingUseConfirm.value = activeGame.pendingUseConfirm;
    pendingUseConfirmText.value = activeGame.pendingUseConfirm
        ? activeGame.malevolentUseConfirmPrompt(activeGame.pendingUseConfirm)
        : '';
    if (isVisible.value) {
        inventoryItems.value = [...activeGame.player.inventory.items];
    }
};

onMounted(() => {
    // We'll set up a simple tick or event listener to sync state
    const interval = setInterval(() => { flushDeferredClose(); updateInventoryState(); }, 100);
    
    // Cleanup
    onUnmounted(() => {
        clearInterval(interval);
    });
});

// FE-1：喝药/吃东西等动作会开启 P2-4 分步推进（isAdvancing），期间
// executeCommand 丢弃一切新输入——紧随其后的关闭命令被吞掉，背包就一直开着
// （v0.1.0 桌面同样复现，审查截图 C-*-05-after-quaff）。这里记下"待关闭"，
// 等推进结束后再经同一录制边界补发一次 escape（录像按实际发出时刻记录，回放一致）。
let closeDeferred = false;
const flushDeferredClose = () => {
    if (!closeDeferred) return;
    if (!activeGame.isInventoryOpen || activeGame.pendingEnchantment || activeGame.pendingIdentify
        || activeGame.pendingUseConfirm || activeGame.replayRecording) {
        closeDeferred = false;
        return;
    }
    if (activeGame.isAdvancing) return;
    closeDeferred = false;
    activeGame.handlePlayerAction('escape');
};

const closeInventory = () => {
    if (activeGame.pendingEnchantment) return; // CE mandatory target after reading.
    activeGame.handlePlayerAction('escape');
    if (activeGame.isInventoryOpen && activeGame.isAdvancing) closeDeferred = true;
    selectedItem.value = null;
    updateInventoryState();
};

const { t } = useTranslation();
const categoryLabel = (category: string) => {
    switch (category) {
        case '-- WEAPONS --': return t('inventory.category.weapons');
        case '-- ARMOR --': return t('inventory.category.armor');
        case '-- POTIONS --': return t('inventory.category.potions');
        case '-- SCROLLS --': return t('inventory.category.scrolls');
        case '-- WANDS --': return t('inventory.category.wands');
        case '-- STAFFS --': return t('inventory.category.staffs');
        case '-- RINGS --': return t('inventory.category.rings');
        case '-- CHARMS --': return t('inventory.category.charms');
        case '-- KEYS --': return t('inventory.category.keys');
        case '-- GEMS --': return t('inventory.category.gems');
        case '-- AMULETS --': return t('inventory.category.amulets');
        case '-- FOOD --': return t('inventory.category.food');
        case '-- GOLD --': return t('inventory.category.gold');
        default: return t('inventory.category.other');
    }
};
const callPlaceholder = computed(() => t('max 29 chars'));
const enchantPrompt = computed(() => i18next.t('scroll.enchant_prompt'));
const actionPrompt = computed(() => {
    switch (inventoryAction.value) {
        case 'equip': return t('inventory.prompt.equip');
        case 'unequip': return t('inventory.prompt.unequip');
        case 'drop': return t('inventory.prompt.drop');
        case 'call': return t('inventory.prompt.call');
        default: return '';
    }
});

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
        '-- GEMS --': [],
        '-- AMULETS --': [],
        '-- FOOD --': [],
        '-- GOLD --': [],
        '-- OTHER --': []
    };

    // Assign letters a-z
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    
    inventoryItems.value.forEach((item, index) => {
        if (!pendingIdentify.value && !pendingEnchantment.value) {
            if (inventoryAction.value === 'equip' && (!isEquippable(item) || isEquipped(item))) return;
            if (inventoryAction.value === 'unequip' && !isEquipped(item)) return;
            if (inventoryAction.value === 'call' && !isCallable(item)) return;
        }
        const letter = item.inventoryLetter ?? alphabet[index] ?? '?';
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
            case ItemCategory.GEM: groups['-- GEMS --']!.push(entry); break;
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

// ── B-1c：极性 sigil（CE Items.c:3611-3625 的背包列渲染）──────────────
// CE：ITEM_MAGIC_DETECTED 且非护符时，在物品字符前插一个符号——
//   极性 +1 → G_GOOD_MAGIC（实心带杠圆，U+29F3，善意色）
//   极性 -1 → G_BAD_MAGIC （空心带杠圆，U+29F2，恶意色）
//   极性  0 → '-'（黄色，"照过了，没魔法"）
// 未被照过的物品**不显示任何符号**（显示 = 泄露）。
const magicSigil = (item: Item): string => {
    if (!item.magicDetected || item.category === ItemCategory.AMULET) return '';
    const polarity = ItemLoader.itemMagicPolarity(item);
    if (polarity === 1) return '\u29F3';
    if (polarity === -1) return '\u29F2';
    return '-';
};
const magicSigilColor = (item: Item): string => {
    const polarity = ItemLoader.itemMagicPolarity(item);
    if (polarity === 1) return '#44ff88';
    if (polarity === -1) return '#ff6666';
    return '#ffff44';
};

// ── B-1c：恶意品使用确认（CE confirm()，Items.c:8054-8060 / 7761-7767）──
const confirmMalevolentUse = () => {
    activeGame.executeItemCommand('confirm');
    updateInventoryState();
    closeInventory();
};
const cancelMalevolentUse = () => {
    activeGame.executeItemCommand('cancel');
    updateInventoryState();
};

const selectItem = (item: Item) => {
    selectedItem.value = selectedItem.value?.id === item.id ? null : item;
};

// B-1b：鉴定卷轴目标选择模式——行点击被拦截为"指定目标"，只有
// canBeIdentified 的物品可选中（CE promptForItemOfType 只列合法目标）。
const selectItemOrIdentify = (item: Item) => {
    if (pendingEnchantment.value) {
        activeGame.executeItemCommand('enchant', toRaw(item), undefined, () => activeGame.chooseEnchantTarget(toRaw(item)));
        selectedItem.value = null;
        updateInventoryState();
        return;
    }
    if (pendingIdentify.value) {
        if (item.canBeIdentified) performIdentifySelect(item);
        return;
    }
    if (pendingUseConfirm.value) return;
    switch (inventoryAction.value) {
        case 'equip': performEquip(item); return;
        case 'unequip': performUnequip(item); return;
        case 'drop': performDrop(item); return;
        case 'call': openCallInput(item); return;
    }
    selectItem(item);
};

const performInspect = (item: Item) => {
    activeGame.inspectTarget = generateItemDetail(item, createItemDetailContext(activeGame, item));
};

const performEquip = (item: Item) => {
    activeGame.executeItemCommand('equip', toRaw(item));
    closeInventory();
};

const performUnequip = (item: Item) => {
    activeGame.executeItemCommand('unequip', toRaw(item));
    closeInventory();
};

const performDrop = (item: Item) => {
    activeGame.executeItemCommand('drop', toRaw(item));
    closeInventory();
};

const performQuaff = (item: Item) => {
    activeGame.executeItemCommand('quaff', toRaw(item));
    // B-1c：被确认闸拦下时不关面板——确认行就在这一行下方渲染
    if (activeGame.pendingUseConfirm) { updateInventoryState(); return; }
    closeInventory();
};

const performRead = (item: Item) => {
    activeGame.executeItemCommand('read', toRaw(item), undefined, () => activeGame.readItem(toRaw(item)));
    if (activeGame.pendingEnchantment) {
        selectedItem.value = null;
        cancelCall();
        updateInventoryState();
        return;
    }
    if (activeGame.pendingUseConfirm) { updateInventoryState(); return; }
    closeInventory();
};

const performThrow = (item: Item) => {
    activeGame.executeItemCommand('throw', toRaw(item));
    closeInventory();
};

const performEat = (item: Item) => {
    activeGame.executeItemCommand('eat', toRaw(item));
    closeInventory();
};

const performUse = (item: Item) => {
    activeGame.executeItemCommand('use', toRaw(item));
    selectedItem.value = null;
    // Selection closes inventory in the engine; refused uses keep it available.
    if (item.category === ItemCategory.CHARM) closeInventory();
    else updateInventoryState();
};

// ── B-1b：鉴定卷轴目标指定与 call 绰号 ─────────────────────────────
const performIdentifySelect = (item: Item) => {
    activeGame.executeItemCommand('identify', toRaw(item));
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
    activeGame.executeItemCommand('call', toRaw(callTarget.value), callText.value);
    cancelCall();
    updateInventoryState();
};
</script>

<template>
  <div v-if="isVisible" class="inventory-overlay" @click.self="closeInventory">
    <div class="inventory-modal">
      <div class="modal-header">
        <h2>{{ t('Your Inventory') || 'Your Inventory' }}</h2>
        <button class="close-btn" :disabled="pendingEnchantment" @click="closeInventory">×</button>
      </div>
      
      <div class="modal-content">
        <div v-if="actionPrompt && !pendingIdentify && !pendingEnchantment" class="identify-banner">
          {{ actionPrompt }}
        </div>
        <div v-if="pendingEnchantment" class="identify-banner enchant-banner">
          {{ enchantPrompt }}
        </div>
        <div v-if="pendingIdentify" class="identify-banner">
          {{ t('Identify what? (choose a highlighted item)') || 'Identify what? (choose a highlighted item)' }}
        </div>
        <div v-if="inventoryItems.length > 0">
           <div v-for="(items, category) in groupedItems" :key="category" class="category-block">
              <h3 class="category-title">{{ categoryLabel(category) }}</h3>
              <ul class="item-list">
                <li v-for="entry in items" :key="entry.letter" class="item-wrapper">
                  <div class="item-row" @click="selectItemOrIdentify(entry.item)"
                       :class="{ 'selected-row': selectedItem?.id === entry.item.id,
                                 'identify-candidate': pendingIdentify && entry.item.canBeIdentified,
                                 'enchant-candidate': pendingEnchantment && activeGame.canEnchantTarget(toRaw(entry.item)) }">
                    <!-- UI-2：ITEM_PROTECTED 闭括号 }（CE Items.c:3629/3641）——受保护物品闭括号从 ) 变 } -->
                    <span class="item-letter">{{ entry.letter }}{{ entry.item.isProtected ? '}' : ')' }}</span>
                    <!-- B-1c：detect magic 极性符号（CE Items.c:3611-3625） -->
                    <span class="item-sigil" :style="{ color: magicSigilColor(entry.item) }">{{ magicSigil(entry.item) }}</span>
                    <span class="item-char" :style="{ color: colorToCss(entry.item.color) }">{{ entry.item.char }}</span>
                    <span class="item-name">
                       {{ getLocalizedName(entry.item.displayName) }}<span v-if="entry.item.quantity > 1"> ×{{ entry.item.quantity }}</span>
                       <span v-if="isEquipped(entry.item)" class="equipped-tag">{{ t('(equipped)') || '(equipped)' }}</span>
                       <span v-if="entry.item.strengthRequired && activeGame.player.effectiveStrength < entry.item.strengthRequired" class="strength-warning">
                           {{ t('[Req Str:') || '[Req Str:' }} {{ entry.item.strengthRequired }}]
                       </span>
                    </span>
                  </div>
                  <div v-if="selectedItem?.id === entry.item.id && !pendingIdentify && !pendingEnchantment" class="item-actions">
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
                  <!-- B-1c：恶意品使用确认（CE confirm()，Items.c:8054-8060） -->
                  <div v-if="pendingUseConfirm?.id === entry.item.id" class="item-actions confirm-row">
                    <span class="confirm-label">{{ pendingUseConfirmText }}</span>
                    <button @click="confirmMalevolentUse()" class="action-btn danger">{{ t('Yes') || 'Yes' }}</button>
                    <button @click="cancelMalevolentUse()" class="action-btn">{{ t('No') || 'No' }}</button>
                  </div>
                  <!-- B-1b：call 绰号输入（CE getInputTextString，Items.c:1423） -->
                  <div v-if="callTarget?.id === entry.item.id && !pendingEnchantment" class="item-actions call-input-row">
                    <span class="call-label">{{ t('Call them:') || 'Call them:' }}</span>
                    <input v-model="callText" class="call-input" maxlength="29"
                           @keyup.enter="confirmCall" :placeholder="callPlaceholder" />
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
.item-sigil {
  display: inline-block;
  width: 1em;
  text-align: center;
  font-weight: bold;
}

.confirm-row {
  align-items: center;
}

.confirm-label {
  color: #ffcc44;
  margin-right: 8px;
}

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
}

.item-row.identify-candidate, .item-row.enchant-candidate {
  cursor: pointer;
  background: rgba(0, 255, 255, 0.06);
}
.item-row.identify-candidate:hover, .item-row.enchant-candidate:hover {
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

/* FE-1：紧凑模式（与 src/ui/layout.ts 同一断点）——底部弹层、全宽、
   操作按钮自动换行且 ≥ 44px 触控高度。 */
@media (max-width: 1023px), (max-height: 599px) {
  .inventory-overlay {
    position: fixed;
    width: 100%;
    height: 100%;
    align-items: flex-end;
    background-color: rgba(0, 0, 0, 0.55);
  }
  .inventory-modal {
    width: 100%;
    max-width: 720px;
    max-height: 92dvh;
    border-radius: 14px 14px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .modal-header { padding: 0.5rem 0.75rem 0.5rem 1rem; }
  .modal-header h2 { font-size: 1.1rem; }
  .close-btn { width: 44px; height: 44px; }
  .modal-content { padding: 0.75rem; }
  .category-block { margin-bottom: 0.75rem; }
  .category-title { padding: 0.4rem 0.75rem; }
  .item-row { padding: 0.65rem 0.75rem; min-height: 44px; box-sizing: border-box; }
  .item-name { flex-wrap: wrap; gap: 6px; min-width: 0; }
  .item-letter { margin-right: 8px; }
  .item-char { margin-right: 10px; }
  .item-actions {
    flex-wrap: wrap;
    gap: 8px;
    padding: 0.75rem;
  }
  .action-btn {
    min-height: 44px;
    min-width: 72px;
    padding: 0 14px;
    flex: 1 1 auto;
    white-space: nowrap;
  }
  .confirm-label { flex-basis: 100%; }
  .call-input { min-height: 44px; flex-basis: 100%; font-size: 16px; }
}
@media (max-height: 599px) and (min-width: 600px) {
  /* 横屏矮视口：侧边抽屉比底部弹层更能多显示几行 */
  .inventory-overlay { align-items: stretch; justify-content: flex-end; }
  .inventory-modal { max-height: 100dvh; height: 100dvh; width: min(560px, 70vw); border-radius: 14px 0 0 14px; }
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
