/**
 * src/test/b_1c_detect_magic.test.ts — B-1c detect magic 极性揭示的验收
 *
 * 对抗性断言与"具体错误实现"对照（每条都能在对应错误下失败）：
 *   D1  极性揭示被当成真名揭示（照过之后物品显示真名）
 *       → detectMagicOnItem 里把 kindId 写进了 identifiedItems 而非
 *         magicPolarityRevealed
 *   D2  magicPolarity 正负号写反（善意显示成恶意）
 *       → MAGIC_POLARITY 表抄反 / itemMagicPolarity 的 return 互换
 *   D3  itemMagicPolarity 对武器/护甲/戒指改查种类表而非实例附魔
 *       → 把 CE :8272-8277 的实例分支省略成表查
 *   D4  `magicCharDiscoverySuffix == -1` 前置条件漏掉（善意药水也弹确认 /
 *       未知恶意药水被提前剧透）→ requiresMalevolentUseConfirmation 少判一半
 *   D5  升格规则的极性半支没被激活（isPolarityRevealed 仍恒 false，或
 *       对侧计数只认 identified 不认 magicPolarityRevealed）
 *   D6  极性状态不进存档（种类级 magicPolarityRevealed / 实例级 magicDetected
 *       任一漏掉）→ toSnapshot/loadSnapshot 落一半
 *   D7  RNG 流被移动（构造地图口径哨兵，任务书 §四硬门禁）
 *   D8  detectMagicOnItem 的"零附魔无符文武器护甲直接全亮"分支写成 <= 0
 *       （负附魔的诅咒武器被白送鉴定）
 *   D9  CAN_BE_DETECTED 类别集写错（食物/金币被照出 sigil）
 *
 * CE 权威出处（BrogueCE-master/src/brogue/）：
 *   - itemTable.magicPolarity / magicPolarityRevealed 字段：Rogue.h:1435-1436
 *   - HAS_INTRINSIC_POLARITY / CAN_BE_DETECTED：Rogue.h:768 / 770
 *   - detectMagicOnItem：Items.c:8027-8038
 *   - POTION_DETECT_MAGIC 分支：Items.c:8137-8185
 *   - itemMagicPolarity：Items.c:8267-8299
 *   - magicCharDiscoverySuffix：Items.c:8213-8262
 *   - 恶意品使用确认：Items.c:8050-8060（喝）/ 7757-7767（读）
 *   - 最后一种类升格（含极性两个入口）：Items.c:6609-6673
 *   - 新局清零：Items.c:8775-8780 resetItemTableEntry
 *   - 背包 sigil 渲染：Items.c:3611-3625
 */
import { describe, it, expect, beforeAll } from 'vitest';
import i18next from 'i18next';
import { createHeadlessGame } from './harness';
import { Game, type GameSnapshot } from '../engine/Core/Game';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';

beforeAll(() => {
    if (!i18next.isInitialized) {
        i18next.init({ lng: 'en', fallbackLng: false, resources: {}, initImmediate: false });
    }
});

/** 与 b_1a / b_1b 同款：清场 + 安全落位。 */
function isolatePlayer(game: Game): void {
    for (let x = 2; x <= 9; x++) {
        for (let y = 2; y <= 9; y++) {
            const cell = game.grid.getCell(x, y);
            if (cell) cell.isPassable = true;
        }
    }
    game.player.loc = { x: 5, y: 5 };
    game.monsters = game.monsters.filter(m => m.hasBehavior('MONST_INANIMATE'));
    game.player.hp = game.player.maxHp;
}

/** 清空地面物品——本文件所有"地面"断言都自己摆物品，不吃生成器的摆法。 */
function clearFloor(game: Game): void {
    game.items = [];
}

function give(game: Game, kindId: string): Item {
    const potion = ItemLoader.spawnPotion(kindId, -1, -1)!;
    game.player.inventory.addItem(potion);
    return potion;
}

// ---------------------------------------------------------------------------
// D1 / D9：detectMagicOnItem 的三件事，以及"揭示极性 ≠ 揭示真名"
// ---------------------------------------------------------------------------
describe('B-1c D1：detect magic 揭示的是极性，不是真名（CE Items.c:8027-8032）', () => {
    it('照过之后：种类极性已揭示、实例 magicDetected 为真，但种类仍未识别、显示名仍是风味名', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        clearFloor(game);
        const target = give(game, 'potion_of_incineration');
        const flavorBefore = target.displayName;
        expect(flavorBefore).not.toBe(target.name); // 前置：确实还没识别

        ItemLoader.detectMagicOnItem(target);

        expect(ItemLoader.isPolarityRevealed('potion_of_incineration')).toBe(true);
        expect(target.magicDetected).toBe(true);
        // ★ 错误实现"写进 identifiedItems"在此翻红
        expect(ItemLoader.identifiedItems.has('potion_of_incineration')).toBe(false);
        expect(target.displayName).toBe(flavorBefore);
    });

    it('CAN_BE_DETECTED 类别集与 CE Rogue.h:770 逐项一致（食物/金币/钥匙不在内）', () => {
        const included = [ItemCategory.WEAPON, ItemCategory.ARMOR, ItemCategory.POTION,
            ItemCategory.SCROLL, ItemCategory.RING, ItemCategory.CHARM, ItemCategory.WAND,
            ItemCategory.STAFF, ItemCategory.AMULET];
        const excluded = [ItemCategory.FOOD, ItemCategory.GOLD, ItemCategory.KEY];
        for (const c of included) expect(ItemLoader.CAN_BE_DETECTED.has(c), `缺 ${ItemCategory[c]}`).toBe(true);
        for (const c of excluded) expect(ItemLoader.CAN_BE_DETECTED.has(c), `多了 ${ItemCategory[c]}`).toBe(false);
        expect(ItemLoader.CAN_BE_DETECTED.size).toBe(9);
        // HAS_INTRINSIC_POLARITY（Rogue.h:768）只有五张风味表
        expect([...ItemLoader.HAS_INTRINSIC_POLARITY].sort((a, b) => a - b))
            .toEqual([ItemCategory.POTION, ItemCategory.SCROLL, ItemCategory.WAND,
                ItemCategory.STAFF, ItemCategory.RING].sort((a, b) => a - b));
    });

    it('食物在背包里时不会被 detect magic 记成"有魔法"（CAN_BE_DETECTED 写错即翻红）', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        clearFloor(game);
        game.player.inventory.items.length = 0;
        const food = ItemLoader.spawnFood('ration_of_food', -1, -1);
        if (food) game.player.inventory.addItem(food);
        const potion = give(game, 'potion_of_detect_magic');
        game.quaffItem(potion);
        if (food) {
            expect(food.magicDetected, '食物不在 CAN_BE_DETECTED 里，不该被照').toBe(false);
        }
    });
});

// ---------------------------------------------------------------------------
// D2 / D3：itemMagicPolarity 的语义（CE Items.c:8267-8299）
// ---------------------------------------------------------------------------
describe('B-1c D2/D3：itemMagicPolarity 的正负号与"实例 vs 种类"分流', () => {
    it('药水/卷轴查种类表，正负号不得互换', () => {
        const good = ['potion_of_life', 'potion_of_strength', 'potion_of_detect_magic', 'potion_of_haste'];
        const bad = ['potion_of_incineration', 'potion_of_paralysis', 'potion_of_descent',
            'potion_of_confusion', 'potion_of_hallucination'];
        for (const id of good) {
            const p = ItemLoader.spawnPotion(id, -1, -1)!;
            expect(ItemLoader.itemMagicPolarity(p), `${id} 应为善意 +1`).toBe(1);
        }
        for (const id of bad) {
            const p = ItemLoader.spawnPotion(id, -1, -1)!;
            expect(ItemLoader.itemMagicPolarity(p), `${id} 应为恶意 -1`).toBe(-1);
        }
        const summon = ItemLoader.spawnScroll('scroll_of_summon_monsters', -1, -1)!;
        expect(ItemLoader.itemMagicPolarity(summon)).toBe(-1);
        const ench = ItemLoader.spawnScroll('scroll_of_enchantment', -1, -1)!;
        expect(ItemLoader.itemMagicPolarity(ench)).toBe(1);
    });

    it('武器/护甲/戒指按**实例**的诅咒与附魔算，不查种类表（CE :8272-8277 / :8287-8293）', () => {
        const sword = ItemLoader.spawnWeapon('sword', -1, -1)!;
        sword.runicType = undefined;
        sword.enchantment = 0; sword.isCursed = false;
        expect(ItemLoader.itemMagicPolarity(sword), '±0 且不诅咒 = 无魔法').toBe(0);
        sword.enchantment = 2;
        expect(ItemLoader.itemMagicPolarity(sword)).toBe(1);
        sword.enchantment = -1;
        expect(ItemLoader.itemMagicPolarity(sword)).toBe(-1);
        sword.enchantment = 3; sword.isCursed = true;
        expect(ItemLoader.itemMagicPolarity(sword), '诅咒压过正附魔（CE 先判 ITEM_CURSED）').toBe(-1);

        // 戒指：ringTable 的 magicPolarity 全 +1，但实例分支必须压过它
        const ring = ItemLoader.spawnRing('ring_of_wisdom', -1, -1)!;
        ring.enchantment = -2; ring.isCursed = true;
        expect(ItemLoader.itemMagicPolarity(ring), '负附魔戒指 = 恶意（查表实现会返回 +1）').toBe(-1);
        ring.enchantment = 0; ring.isCursed = false;
        expect(ItemLoader.itemMagicPolarity(ring)).toBe(0);
    });

    it('护身符恒 +1（CE charmTable 的 magicPolarity 列全 +1）；安卡恒 +1（CE :8295）', () => {
        const charm = ItemLoader.spawnCharm(ItemLoader.charms[0]!.id, -1, -1)!;
        expect(ItemLoader.itemMagicPolarity(charm), 'CE charmTable 全 +1').toBe(1);
        expect(ItemLoader.magicCharDiscoverySuffix(charm), 'CE :8253-8255 CHARM 恒 1').toBe(1);
        const amulet = ItemLoader.spawnAmulet(ItemLoader.amulets[0]!.id, -1, -1)!;
        expect(ItemLoader.itemMagicPolarity(amulet)).toBe(1);
    });

    it('魔杖充能耗尽 → 0，有充能 → 贯穿到种类表（CE :8278-8281 的 fallthrough）', () => {
        const wand = ItemLoader.spawnWand('wand_of_teleportation', -1, -1)!;
        wand.charges = 2;
        expect(ItemLoader.itemMagicPolarity(wand)).toBe(1);
        wand.charges = 0;
        expect(ItemLoader.itemMagicPolarity(wand), '空魔杖无魔法可言').toBe(0);
    });
});

// ---------------------------------------------------------------------------
// D8：detectMagicOnItem 的武器/护甲自亮分支（CE :8033-8037）
// ---------------------------------------------------------------------------
describe('B-1c D8：零附魔无符文的武器/护甲被照到即全亮，负附魔的不得白送', () => {
    it('enchant==0 且无符文 → identify；enchant<0 或带符文 → 只打 magicDetected', () => {
        const plain = ItemLoader.spawnWeapon('sword', -1, -1)!;
        plain.enchantment = 0; plain.runicType = undefined; plain.identified = false;
        ItemLoader.detectMagicOnItem(plain);
        expect(plain.identified, 'CE :8033-8037：没有秘密可留，直接 identify()').toBe(true);

        const cursed = ItemLoader.spawnWeapon('sword', -1, -1)!;
        cursed.enchantment = -2; cursed.runicType = undefined; cursed.identified = false;
        ItemLoader.detectMagicOnItem(cursed);
        // ★ 把 `=== 0` 写成 `<= 0` 的实现在此翻红
        expect(cursed.identified, '负附魔不是"零附魔"，CE 不白送鉴定').toBe(false);
        expect(cursed.magicDetected).toBe(true);

        const runic = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        runic.enchantment = 0; runic.runicType = 'reflection'; runic.runicKnown = false;
        runic.identified = false;
        ItemLoader.detectMagicOnItem(runic);
        expect(runic.identified, '带符文 = 还有秘密，不自亮').toBe(false);
    });
});

// ---------------------------------------------------------------------------
// D4：magicCharDiscoverySuffix == -1 的前置条件（CE :8050-8052 / :7757-7759）
// ---------------------------------------------------------------------------
describe('B-1c D4：恶意品使用确认的两个析取项，缺一不可', () => {
    it('善意药水永不弹确认（漏掉 `== -1` 的实现在此翻红）', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        clearFloor(game);
        const life = give(game, 'potion_of_life');
        ItemLoader.detectMagicOnItem(life);          // 已照过，但它是善意的
        ItemLoader.identifiedItems.add('potion_of_life'); // 连真名都知道了
        expect(game.requiresMalevolentUseConfirmation(life)).toBe(false);
        const hpBefore = game.player.hp;
        game.player.hp = 1;
        game.quaffItem(life);
        expect(game.pendingUseConfirm, '善意药水不该被拦').toBeNull();
        expect(game.player.hp).toBeGreaterThan(1);
        expect(hpBefore).toBeGreaterThan(0);
    });

    it('恶意但玩家一无所知的药水不得弹确认——那是剧透（漏掉后半段析取的实现翻红）', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        clearFloor(game);
        const fire = give(game, 'potion_of_incineration');
        expect(fire.magicDetected).toBe(false);
        expect(ItemLoader.identifiedItems.has('potion_of_incineration')).toBe(false);
        expect(game.requiresMalevolentUseConfirmation(fire),
            '未鉴定且未被照过 = 玩家没有理由知道这是坏东西，CE 不拦').toBe(false);
    });

    it('恶意 + 实例被照过 → 拦；恶意 + 种类已识别 → 拦；取消不消耗药水也不推进回合', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        clearFloor(game);
        const fire = give(game, 'potion_of_incineration');
        ItemLoader.detectMagicOnItem(fire);
        expect(game.requiresMalevolentUseConfirmation(fire)).toBe(true);

        const packBefore = game.player.inventory.items.length;
        const turnsBefore = game.stats.turns;
        game.quaffItem(fire);
        expect(game.pendingUseConfirm?.id).toBe(fire.id);
        expect(game.player.inventory.items.length, '待确认期间不得消耗药水').toBe(packBefore);
        game.cancelPendingUse();
        expect(game.pendingUseConfirm).toBeNull();
        expect(game.player.inventory.items.length).toBe(packBefore);
        expect(game.stats.turns, 'CE `return false`：取消不推进回合').toBe(turnsBefore);

        // 确认后真正喝下
        game.quaffItem(fire);
        expect(game.pendingUseConfirm?.id).toBe(fire.id);
        expect(game.confirmPendingUse()).toBe(true);
        expect(game.player.inventory.items.length).toBe(packBefore - 1);
        expect(game.pendingUseConfirm).toBeNull();

        // 种类已识别的那一半析取（新实例、没被照过）
        const fire2 = give(game, 'potion_of_incineration');
        expect(fire2.magicDetected).toBe(false);
        expect(ItemLoader.identifiedItems.has('potion_of_incineration')).toBe(true);
        expect(game.requiresMalevolentUseConfirmation(fire2)).toBe(true);
    });

    it('读恶意卷轴走同一条闸（CE :7757-7767）', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        clearFloor(game);
        const scroll = ItemLoader.spawnScroll('scroll_of_summon_monsters', -1, -1)!;
        game.player.inventory.addItem(scroll);
        ItemLoader.detectMagicOnItem(scroll);
        const packBefore = game.player.inventory.items.length;
        game.readItem(scroll);
        expect(game.pendingUseConfirm?.id).toBe(scroll.id);
        expect(game.player.inventory.items.length).toBe(packBefore);
        game.cancelPendingUse();

        // 善意卷轴不拦
        const ident = ItemLoader.spawnScroll('scroll_of_identify', -1, -1)!;
        game.player.inventory.addItem(ident);
        ItemLoader.detectMagicOnItem(ident);
        expect(game.requiresMalevolentUseConfirmation(ident)).toBe(false);
    });

    it('magicCharDiscoverySuffix：戒指恒 0（与 ringTable 全 +1 的 magicPolarity 相反）', () => {
        const ring = ItemLoader.spawnRing('ring_of_wisdom', -1, -1)!;
        ring.enchantment = 2;
        expect(ItemLoader.itemMagicPolarity(ring), '实例极性 = +1').toBe(1);
        expect(ItemLoader.magicCharDiscoverySuffix(ring),
            'CE :8250-8252 发现屏后缀对戒指恒 0（"说不准好坏"）').toBe(0);
    });
});

// ---------------------------------------------------------------------------
// D5：升格规则的极性两个入口（CE :6634-6653 + :6609-6624）
// ---------------------------------------------------------------------------
describe('B-1c D5：最后一种类升格的极性半支已激活', () => {
    /** 把某类别整张种类表清成"全未识别、全未揭示"。 */
    function resetPotionKinds(): string[] {
        const ids = ItemLoader.potions.map(p => p.id);
        for (const id of ids) {
            ItemLoader.identifiedItems.delete(id);
            ItemLoader.magicPolarityRevealed.delete(id);
        }
        return ids;
    }

    it('入口A：善意类只剩 1 种未识别，且**该种类极性已被揭示** → 升格（对侧远未全识别）', () => {
        createHeadlessGame(42, 'test');
        const ids = resetPotionKinds();
        const benign = ids.filter(id => ItemLoader.kindPolarity(id) === 1);
        expect(benign.length, '善意药水类（含 potion_of_haste）').toBe(8);
        for (const id of benign.slice(0, 7)) ItemLoader.identifiedItems.add(id);
        const last = benign[7]!;
        // 恶意类一条都没识别 —— 若只有"对侧全识别"这一个入口，这里不该升格
        expect(ItemLoader.identifiedItems.has(last)).toBe(false);

        ItemLoader.magicPolarityRevealed.add(last);
        ItemLoader.tryIdentifyLastItemKindsAllPolarityCategories();
        // ★ isPolarityRevealed 仍恒 false 的实现在此翻红
        expect(ItemLoader.identifiedItems.has(last),
            'CE :6648 的 theItemTable[lastItemKind].magicPolarityRevealed 半支').toBe(true);
    });

    it('入口B：对侧极性类的极性**全部已知**（identified 或 revealed 都算，CE :6617-6620）', () => {
        createHeadlessGame(42, 'test');
        const ids = resetPotionKinds();
        const benign = ids.filter(id => ItemLoader.kindPolarity(id) === 1);
        const malevolent = ids.filter(id => ItemLoader.kindPolarity(id) === -1);
        expect(malevolent.length).toBeGreaterThan(0);

        for (const id of benign.slice(0, 7)) ItemLoader.identifiedItems.add(id);
        const last = benign[7]!;
        // 对侧一件也没识别，但**极性全被 detect magic 揭示**
        for (const id of malevolent) ItemLoader.magicPolarityRevealed.add(id);
        expect(malevolent.every(id => !ItemLoader.identifiedItems.has(id))).toBe(true);

        ItemLoader.tryIdentifyLastItemKindsAllPolarityCategories();
        // ★ 对侧计数只认 identified（B-1a 的旧写法）在此翻红
        expect(ItemLoader.identifiedItems.has(last),
            'CE magicPolarityRevealedItemKindCount 把 revealed 也算作"极性已知"').toBe(true);
    });

    it('守卫：剩 2 种未识别时，无论怎么揭示极性都不得升格', () => {
        createHeadlessGame(42, 'test');
        const ids = resetPotionKinds();
        const benign = ids.filter(id => ItemLoader.kindPolarity(id) === 1);
        for (const id of benign.slice(0, 6)) ItemLoader.identifiedItems.add(id);
        for (const id of ids) ItemLoader.magicPolarityRevealed.add(id); // 全揭示
        ItemLoader.tryIdentifyLastItemKindsAllPolarityCategories();
        expect(ItemLoader.identifiedItems.has(benign[6]!)).toBe(false);
        expect(ItemLoader.identifiedItems.has(benign[7]!)).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 端到端：喝 detect magic 的三轮遍历与消息分支（CE :8137-8185）
// ---------------------------------------------------------------------------
describe('B-1c E2E：喝 detect magic 照亮背包与地面', () => {
    it('背包与地面各有带极性的物品 → 两处都被照到，且极性揭示落在种类上', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        clearFloor(game);
        game.player.inventory.items.length = 0;

        const detect = give(game, 'potion_of_detect_magic');
        const packPotion = give(game, 'potion_of_paralysis');
        const floorScroll = ItemLoader.spawnScroll('scroll_of_summon_monsters', -1, -1)!;
        floorScroll.loc = { x: 6, y: 6 };
        game.items.push(floorScroll);

        game.quaffItem(detect);

        expect(packPotion.magicDetected).toBe(true);
        expect(floorScroll.magicDetected).toBe(true);
        expect(ItemLoader.isPolarityRevealed('potion_of_paralysis')).toBe(true);
        expect(ItemLoader.isPolarityRevealed('scroll_of_summon_monsters')).toBe(true);
        // 极性揭示不等于识别（恶意药水类有 6 种，远不止 1 种未识别）
        expect(ItemLoader.identifiedItems.has('potion_of_paralysis')).toBe(false);
        // ★ 例外且**符合 CE**：web 卷轴表里恶意类只有 summon monsters 一种
        //   （CE 还有 aggravate monsters，web 目录缺口，B-0 §5.1-9）。恶意类
        //   "只剩 1 种未识别 + 该种极性已揭示" 恰好满足 CE :6648 的升格条件，
        //   于是它被连带识别。这是目录缺口的真实后果，不是实现错——B-4 补上
        //   aggravate monsters 后本条会自动变回"未识别"，届时改这条断言。
        expect(ItemLoader.identifiedItems.has('scroll_of_summon_monsters'),
            'web 恶意卷轴仅此一种 → 极性一揭示就触发 CE 的最后一种类升格').toBe(true);
        // 喝掉的那瓶自身按 CE 也被照到（它在 CE 里此刻仍在 packItems 内）
        expect(ItemLoader.isPolarityRevealed('potion_of_detect_magic')).toBe(true);
    });

    it('背包空、地面空 → 只报"感到没有魔法"，不产生任何极性揭示', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        clearFloor(game);
        game.player.inventory.items.length = 0;
        const detect = give(game, 'potion_of_detect_magic');
        game.quaffItem(detect);
        // 只有被喝的那瓶自己（CE 同样会照到它，但不计 hadEffectOnPack）
        expect([...ItemLoader.magicPolarityRevealed]).toEqual(['potion_of_detect_magic']);
    });
});

// ---------------------------------------------------------------------------
// D6：持久化（种类级 + 实例级）
// ---------------------------------------------------------------------------
describe('B-1c D6：极性状态进存档（种类级 magicPolarityRevealed + 实例级 magicDetected）', () => {
    it('存读一轮：两级状态都往返；新局清零（CE resetItemTableEntry :8777）', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        clearFloor(game);
        const potion = give(game, 'potion_of_paralysis');
        ItemLoader.detectMagicOnItem(potion);
        expect(ItemLoader.isPolarityRevealed('potion_of_paralysis')).toBe(true);

        const snap = JSON.parse(JSON.stringify(game.toSnapshot())) as GameSnapshot;
        expect(snap.magicPolarityRevealed, '★ 种类级状态漏出存档时翻红')
            .toContain('potion_of_paralysis');
        expect(snap.player.inventory.some(it => it.magicDetected === true),
            '★ 实例级 ITEM_MAGIC_DETECTED 漏出存档时翻红').toBe(true);

        // 新局必须清零
        const fresh = createHeadlessGame(7, 'test');
        expect(ItemLoader.isPolarityRevealed('potion_of_paralysis'), '新局不得继承上一局的极性揭示').toBe(false);

        // 读档回放
        expect(fresh.loadSnapshot(snap)).toBe(true);
        expect(ItemLoader.isPolarityRevealed('potion_of_paralysis')).toBe(true);
        const restored = fresh.player.inventory.items.find(it => (it as unknown as { consumableId?: string }).consumableId === 'potion_of_paralysis');
        expect(restored?.magicDetected).toBe(true);
    });


});

// ---------------------------------------------------------------------------
// X1：待决确认态不得跨场景泄漏（与 B-1b 的 pendingIdentify 同款）
// ---------------------------------------------------------------------------
describe('B-1c X1：挂起的恶意品确认不跨场景泄漏', () => {
    it('新局 / 读档都会复位 pendingUseConfirm', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        clearFloor(game);
        const fire = give(game, 'potion_of_incineration');
        ItemLoader.detectMagicOnItem(fire);
        game.quaffItem(fire);
        expect(game.pendingUseConfirm?.id).toBe(fire.id);

        const snap = JSON.parse(JSON.stringify(game.toSnapshot())) as GameSnapshot;
        game.loadSnapshot(snap);
        expect(game.pendingUseConfirm, '读档后不得还挂着上一幕的确认').toBeNull();

        const game2 = createHeadlessGame(42, 'test');
        expect(game2.pendingUseConfirm).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// D7：RNG 流哨兵（构造地图口径，对 C-6 改生成器免疫）
// ---------------------------------------------------------------------------
describe('B-1c D7：RNG 流哨兵（任务书 §四硬门禁）', () => {
    /**
     * 口径与 B-1b 的 S1 一致：以 rng.randomNumbersGenerated（只计 SUBSTANTIVE
     * 流）的**增量**度量本轮新增的全部路径——极性表查、detectMagicOnItem、
     * 升格联动、确认闸、序列化写侧。计数起点在物品手工构造之后，因此对
     * 地图生成与 C-6 的生成器改动完全免疫。
     * 反向验证（报告 RV3）：在 applyDetectMagic 里注入一次 randRange 即翻红。
     */
    it('极性揭示全链零掷骰消耗', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        clearFloor(game);
        game.player.inventory.items.length = 0;
        // spawnPotion/spawnScroll 本身零掷骰，但保险起见仍把构造放在计数起点前
        const detect = give(game, 'potion_of_detect_magic');
        const bad = give(game, 'potion_of_incineration');
        const floorScroll = ItemLoader.spawnScroll('scroll_of_summon_monsters', -1, -1)!;
        floorScroll.loc = { x: 6, y: 6 };
        game.items.push(floorScroll);

        const c0 = rng.randomNumbersGenerated;

        // ★ 必须直接盖住 applyDetectMagic 本体：走 quaffItem 会连带 playerTurnEnded
        //   （怪物 AI 有掷骰），增量口径就失守了。反向验证 RV3 的第一版哨兵
        //   只调 detectMagicOnItem，结果在 applyDetectMagic 里注入 randRange 后
        //   **没能翻红**——这条注释是那次失败换来的。
        (game as unknown as { applyDetectMagic(it: Item): void }).applyDetectMagic(detect);
        ItemLoader.detectMagicOnItem(bad);
        ItemLoader.detectMagicOnItem(floorScroll);
        ItemLoader.itemMagicPolarity(bad);
        ItemLoader.magicCharDiscoverySuffix(bad);
        ItemLoader.tryIdentifyLastItemKindsAllPolarityCategories();
        expect(game.requiresMalevolentUseConfirmation(bad)).toBe(true);
        game.quaffItem(bad);                       // 被确认闸拦下，零掷骰
        expect(game.pendingUseConfirm?.id).toBe(bad.id);
        game.cancelPendingUse();
        JSON.parse(JSON.stringify(game.toSnapshot()));

        expect(rng.randomNumbersGenerated, '★ 任何新增抽取在此翻红').toBe(c0);
        expect(detect.id).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 留痕：本轮明确不做的两件（均注明反转轮次）
// ---------------------------------------------------------------------------
describe('留痕：地面 sigil 渲染未实装（→ 渲染层轮次反转）', () => {
    /**
     * CE 在 POTION_DETECT_MAGIC 里给格子打 pmap ITEM_DETECTED（Items.c:8144）
     * 并由 IO.c:1216-1234 / Movement.c:204-220 把地面物品画成 G_GOOD_MAGIC /
     * G_BAD_MAGIC。web 的 Grid.Cell 没有对应旗标，渲染层也不在本轮允许清单里
     * （只许改 InventoryOverlay.vue 的极性显示），故本轮只做背包列 sigil。
     * 反转轮次：接渲染层的那一轮——届时 Cell 需要 itemDetected 旗标。
     */
    it('Grid.Cell 无 ITEM_DETECTED 等价旗标；detect magic 只改物品实例', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        clearFloor(game);
        const floorPotion = ItemLoader.spawnPotion('potion_of_incineration', -1, -1)!;
        floorPotion.loc = { x: 6, y: 6 };
        game.items.push(floorPotion);
        const detect = give(game, 'potion_of_detect_magic');
        game.quaffItem(detect);

        expect(floorPotion.magicDetected).toBe(true);
        const cell = game.grid.getCell(6, 6)! as unknown as Record<string, unknown>;
        expect('itemDetected' in cell, 'web Cell 尚无 ITEM_DETECTED 载体').toBe(false);
    });
});

describe('留痕：怪物携带品这一轮遍历无载体（→ 怪物掉落/携带轮次反转）', () => {
    /**
     * CE Items.c:8150-8157 的第二轮遍历照的是 monst->carriedItem。web 的
     * Monster/Creature 没有 carriedItem 字段（全库 grep 零命中），这一轮在
     * web 结构性缺席——不是漏做，是没有载体。
     * 反转轮次：给怪物接上"携带品"的那一轮。届时 applyDetectMagic 需补一段
     * 与背包同构的遍历（并按 CE 只计 hadEffectOnLevel）。
     */
    it('Monster 实例上没有 carriedItem 字段', () => {
        const game = createHeadlessGame(42, 'test');
        const monster = game.monsters[0];
        if (monster) {
            expect('carriedItem' in (monster as unknown as Record<string, unknown>)).toBe(false);
        } else {
            expect(game.monsters.length).toBe(0);
        }
    });
});

describe('W-2 留痕反转：magicCharDiscoverySuffix 的 WAND/STAFF 已接 CE 身份目录', () => {
    // 原断言恒 0：B-1c 当时缺载体；W-1 已补目录，此登记过期。
    // CE Items.c:8243-8249：BF_TARGET_ALLIES -> -1，其余 -> +1，不读剩余电量。
    it('allies 后缀为 -1，敌向为 +1；三件自创兼容项仍无 CE 后缀', () => {
        const wand = ItemLoader.spawnWand('wand_of_invisibility', -1, -1)!;
        wand.charges = 0;
        expect(ItemLoader.itemMagicPolarity(wand)).toBe(0);
        expect(ItemLoader.magicCharDiscoverySuffix(wand)).toBe(-1);
        expect(ItemLoader.magicCharDiscoverySuffix(ItemLoader.spawnStaff('staff_of_healing', -1, -1)!)).toBe(-1);
        expect(ItemLoader.magicCharDiscoverySuffix(ItemLoader.spawnWand('wand_of_slowness', -1, -1)!)).toBe(1);
        for (const id of ['wand_of_fire', 'wand_of_lightning']) {
            expect(ItemLoader.magicCharDiscoverySuffix(ItemLoader.spawnWand(id, -1, -1)!)).toBe(0);
        }
        expect(ItemLoader.magicCharDiscoverySuffix(ItemLoader.spawnStaff('staff_of_light', -1, -1)!)).toBe(0);
    });
});
