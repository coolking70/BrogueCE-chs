/**
 * src/test/b_1a_identification.test.ts — B-1a 未知态模型与揭示规则（含反泄露）验收
 *
 * 对抗性断言的"具体错误实现"对照（每条都能在对应错误下失败）：
 *   A1  displayName 无条件拼附魔/诅咒前缀（B-0 §2.3 泄露①，Item.ts 旧 100-104 行）
 *   A2  DetailGenerator 武器段不查鉴定态就显示实际伤害/被诅咒（泄露②）
 *   A3  DetailGenerator 护甲段同上
 *   A4  法器详情/名称不查实例旗标就显示充能（泄露③）
 *   A5  层 1（种类）与层 2（实例）被合并成一层
 *   A6  武器熟悉度门槛写错（19 杀就亮 / 20 杀不亮 / 无生命怪也计数）
 *   A7  护甲穿戴门槛写错（999 回合就亮 / 1000 不亮 / 脱下还计数）
 *   A8  戒指穿戴门槛写错（1499 就亮 / 1500 不亮 / 只亮实例不亮种类）
 *   A9  开局不清零（上一局鉴定态漏进新局，CE resetItemTableEntry Items.c:8775）
 *   A10 卷轴"用完不自亮"例外缺失（enchant/identify，CE Items.c:8019-8026）
 *   A11 最后一种类升格写错（≥2 未识别就升格 / 对侧未全识别也升格）
 *   A12 鉴定卷轴不亮实例（CE identify() 是实例全亮+种类亮，Items.c:7636-7648）
 *   A13 RNG 流被移动（回归哨兵，对应任务书 §四硬门禁）
 *   A14 CAN_BE_IDENTIFIED 不维护（已无秘密的物品仍可被鉴定卷轴选中）
 *
 * CE 权威出处见 ItemLoader.ts 内注释块（B-1a 引用清单）。
 * 留痕测试（本轮明确不做）见文件尾部 describe 块，均注明反转轮次。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import i18next from 'i18next';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Monster, type MonsterData } from '../entities/Monster';
import { generateItemDetail, type DetailInfo } from '../engine/UI/DetailGenerator';
import monsterDataJson from '../data/monsters.json';

const MONSTER_DATA = monsterDataJson as MonsterData[];

beforeAll(() => {
    // 与 harness 同款空资源初始化：文案走 defaultValue（英文）。
    // 新增 i18n 键的存在性由 p1_30_i18n_gate（静态扫描）把关，不在本文件重复。
    if (!i18next.isInitialized) {
        i18next.init({
            lng: 'en',
            fallbackLng: false,
            resources: {},
            initImmediate: false,
        });
    }
});

/** 把玩家挪到安全位置并清空场地，避免回合推进被怪物干扰。 */
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

function makeMonster(game: Game, id: string, x: number, y: number): Monster {
    const data = MONSTER_DATA.find(m => m.id === id);
    if (!data) throw new Error(`monsters.json 中无 ${id}`);
    const m = new Monster(x, y, data);
    game.monsters.push(m);
    return m;
}

function allLines(detail: DetailInfo): string[] {
    return detail.sections.flatMap(s => s.lines.map(l => l.text));
}

describe('A1: displayName 反泄露（武器/护甲的附魔与诅咒）', () => {
    it('未鉴定武器不显示 +N；鉴定后显示', () => {
        const wpn = ItemLoader.spawnWeapon('sword', -1, -1)!;
        wpn.enchantment = 2;
        wpn.runicType = undefined;
        // spawn 出口必须显式置未鉴定（错误实现：忘记置 false → undefined 视为已鉴定 → 本断言红）
        expect(wpn.identified).toBe(false);
        expect(wpn.displayName).toBe('Sword');

        wpn.identified = true;
        expect(wpn.displayName).toBe('Sword +2');
    });

    it('诅咒绝不进名字（CE 无 cursed 前缀分支；玩家经"摘不下"得知）', () => {
        const armor = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        armor.enchantment = -1;
        armor.isCursed = true;
        expect(armor.displayName).toBe('Leather Armor');
        expect(armor.displayName).not.toContain('诅咒');
        expect(armor.displayName).not.toContain('Cursed');
        // 负附魔同样只在鉴定后显示
        armor.identified = true;
        expect(armor.displayName).toBe('Leather Armor -1');
    });

    it('带未知符文的已鉴定武器显示"未知符文"提示；符文已识别则亮符文名', () => {
        const wpn = ItemLoader.spawnWeapon('sword', -1, -1)!;
        wpn.enchantment = 1;
        wpn.runicType = 'quietus';
        wpn.identified = true;
        // CE Items.c:1518-1523：IDENTIFIED && RUNIC && !RUNIC_IDENTIFIED → (unknown runic)
        // （空资源下走 defaultValue 英文；zh 资源下为"未知符文"）
        expect(wpn.displayName).toMatch(/unknown runic|未知符文/);
        wpn.runicKnown = true;
        expect(wpn.displayName).toContain('quietus');
        expect(wpn.displayName).not.toMatch(/unknown runic|未知符文/);
    });
});

describe('A2: DetailGenerator 武器段反泄露', () => {
    it('未鉴定武器只给基础伤害与力量需求；不显示实际伤害与被诅咒', () => {
        const game = createHeadlessGame(42);
        const wpn = ItemLoader.spawnWeapon('sword', -1, -1)!;
        wpn.enchantment = 2;
        wpn.runicType = undefined;
        const detail = generateItemDetail(wpn, game.player.strength);
        const lines = allLines(detail);
        expect(lines.some(t => t.startsWith('基础伤害:'))).toBe(true);
        expect(lines.some(t => t.startsWith('实际伤害:'))).toBe(false);
        expect(lines.some(t => t.includes('被诅咒'))).toBe(false);
    });

    it('鉴定后显示实际伤害（锁定：信息来自鉴定态，不是行被删了）', () => {
        const wpn = ItemLoader.spawnWeapon('sword', -1, -1)!;
        wpn.enchantment = 2;
        wpn.runicType = undefined;
        wpn.identified = true;
        const lines = allLines(generateItemDetail(wpn, 16));
        expect(lines.some(t => t.startsWith('实际伤害:') && t.includes('+2'))).toBe(true);
    });
});

describe('A3: DetailGenerator 护甲段反泄露', () => {
    it('未鉴定诅咒护甲不显示实际防御值与被诅咒；基础防御值照常', () => {
        const armor = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        armor.enchantment = -1;
        armor.isCursed = true;
        const lines = allLines(generateItemDetail(armor, 16));
        expect(lines.some(t => t.startsWith('基础防御值:'))).toBe(true);
        expect(lines.some(t => t.startsWith('实际防御值:'))).toBe(false);
        expect(lines.some(t => t.includes('被诅咒'))).toBe(false);
    });

    it('鉴定后显示实际防御值', () => {
        const armor = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        armor.enchantment = 2;
        armor.identified = true;
        const lines = allLines(generateItemDetail(armor, 16));
        expect(lines.some(t => t.startsWith('实际防御值:'))).toBe(true);
    });
});

describe('A4: 魔杖/法杖充能反泄露', () => {
    it('未识别魔杖：名称与详情都不显示充能；使用后显示次数而非充能', () => {
        const game = createHeadlessGame(42);
        const wand = ItemLoader.spawnWand('wand_of_teleportation', -1, -1)!;
        expect(wand.maxCharges).toBeGreaterThanOrEqual(1);
        expect(wand.displayName).not.toContain('[');
        const lines = allLines(generateItemDetail(wand, 16));
        expect(lines.some(t => t.startsWith('充能:'))).toBe(false);

        game.player.inventory.addItem(wand);
        game.useArcanaItem(wand); // 用一次：种类亮、实例仍未知
        expect(ItemLoader.identifiedItems.has('wand_of_teleportation')).toBe(true);
        expect(wand.identified).toBe(false);
        // CE Items.c:1615-1634：未识别魔杖显示使用次数，不显示充能
        expect(wand.displayName).toContain('Wand of Teleportation');
        expect(wand.displayName).toMatch(/已使用 1 次|used once/);
        expect(wand.displayName).not.toContain('[');
        expect(allLines(generateItemDetail(wand, 16)).some(t => t.startsWith('充能:'))).toBe(false);
        expect(allLines(generateItemDetail(wand, 16)).some(t => t.match(/已使用 1 次|used once/))).toBe(true);
    });

    it('实例鉴定后显示充能 [剩余]；空杖敲一下亮充能上限 [?/上限]（跟着风味名走）', () => {
        const wand = ItemLoader.spawnWand('wand_of_teleportation', -1, -1)!;
        wand.identified = true;
        expect(wand.displayName).toBe(`Wand of Teleportation [${wand.charges}]`);
        expect(allLines(generateItemDetail(wand, 16)).some(t => t.startsWith('充能:'))).toBe(true);

        // CE Items.c:7420-7424：对耗尽法器再施放 → ITEM_MAX_CHARGES_KNOWN。
        // 种类未识别 → 名字是风味名，[?/上限] 跟在其后（CE itemName 先选名根
        // 再拼充能，Items.c:1645-1653）。
        const staff = ItemLoader.spawnStaff('staff_of_lightning', -1, -1)!;
        staff.charges = 0;
        const game = createHeadlessGame(42);
        game.player.inventory.addItem(staff);
        game.useArcanaItem(staff);
        expect(staff.maxChargesKnown).toBe(true);
        expect(staff.identified).toBe(false);
        expect(staff.displayName).toMatch(/\[\?\/2\]$/);
        expect(staff.displayName).not.toBe(`Staff of Lightning [?/2]`); // 真名仍未亮
    });
});

describe('A5: 层 1（种类）与层 2（实例）不合并', () => {
    it('实例揭示不外溢：鉴定一把剑，同种另一把仍藏附魔', () => {
        const a = ItemLoader.spawnWeapon('sword', -1, -1)!;
        const b = ItemLoader.spawnWeapon('sword', -1, -1)!;
        a.enchantment = 2;
        b.enchantment = 2;
        ItemLoader.identifyInstance(a);
        expect(a.identified).toBe(true);
        expect(b.identified).toBe(false);
        expect(b.displayName).toBe('Sword');
        expect(a.displayName).toBe('Sword +2');
        // 武器不进种类集（CE 武器/护甲无风味种类表，识别只发生在实例层）
        expect([...ItemLoader.identifiedItems].some(k => k.includes('sword'))).toBe(false);
    });

    it('种类揭示作用于所有实例：喝一瓶生命药水，另一瓶同名', () => {
        const game = createHeadlessGame(42);
        const p1 = ItemLoader.spawnPotion('potion_of_life', -1, -1)!;
        const p2 = ItemLoader.spawnPotion('potion_of_life', -1, -1)!;
        game.player.inventory.addItem(p1);
        game.quaffItem(p1);
        expect(ItemLoader.identifiedItems.has('potion_of_life')).toBe(true);
        expect(p2.displayName).toBe(p1.name); // 真名
    });

    it('熟悉度只亮实例：护甲穿满 1000 回合，同种新护甲仍未知', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const a = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        const b = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        a.enchantment = 1; a.runicType = undefined;
        b.enchantment = 1; b.runicType = undefined;
        game.player.inventory.addItem(a);
        game.equipItem(a); // 装备回合消耗 1 个客观块
        for (let i = 0; i < 999; i++) {
            (game as unknown as { objectiveTimeBlock(): void }).objectiveTimeBlock();
        }
        expect(a.identified).toBe(true);
        expect(b.identified).toBe(false);
        expect(b.displayName).toBe('Leather Armor');
    });
});

describe('A6: 武器熟悉度门槛（CE GlobalsBrogue.c:1040 = 20 杀）', () => {
    it('边界：19 杀不亮、第 20 杀亮；无生命怪不计入', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const wpn = ItemLoader.spawnWeapon('mace', -1, -1)!;
        wpn.enchantment = 1;
        wpn.runicType = undefined;
        game.player.inventory.addItem(wpn);
        game.player.equip(wpn);
        expect(wpn.charges).toBe(20);

        // 错误实现"少杀一个也揭示"：19 次击杀必须不亮
        for (let i = 0; i < 19; i++) {
            expect(ItemLoader.decrementWeaponAutoIDTimer(wpn)).toBe(false);
        }
        expect(wpn.identified).toBe(false);
        expect(wpn.displayName).toBe('Mace');

        // 第 20 杀恰好揭示
        expect(ItemLoader.decrementWeaponAutoIDTimer(wpn)).toBe(true);
        expect(wpn.identified).toBe(true);
        expect(wpn.displayName).toBe('Mace +1');
    });

    it('接线：真实近战击杀扣减 1；击杀无生命怪不扣减（CE Monsters.c:157-159）', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const wpn = ItemLoader.spawnWeapon('sword', -1, -1)!; // 伤害 7~9 > 大鼠 6 血，必杀
        wpn.runicType = undefined;
        game.player.inventory.addItem(wpn);
        game.player.equip(wpn);
        const resolve = game as unknown as { resolvePlayerMeleeAttackOn(t: Monster): boolean };

        const rat = makeMonster(game, 'rat', 5, 6);
        rat.hp = 1;
        expect(resolve.resolvePlayerMeleeAttackOn(rat)).toBe(true);
        expect(wpn.charges).toBe(19); // 恰好 -1

        const totem = makeMonster(game, 'goblin_totem', 5, 4);
        totem.hp = 1; // 防御 0 必中，一击致死
        resolve.resolvePlayerMeleeAttackOn(totem);
        expect(totem.hp).toBeLessThanOrEqual(0);
        expect(wpn.charges).toBe(19); // 无生命怪：不减（MB_WEAPON_AUTO_ID 不置）
    });
});

describe('A7: 护甲穿戴门槛（CE GlobalsBrogue.c:1041 = 1000 客观块）', () => {
    it('边界：999 块不亮、第 1000 块亮（只亮实例）；脱下不计数', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const armor = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        armor.enchantment = 1;
        armor.runicType = undefined;
        game.player.inventory.addItem(armor);
        game.equipItem(armor); // 装备回合消耗第 1 块
        const block = () => (game as unknown as { objectiveTimeBlock(): void }).objectiveTimeBlock();

        for (let i = 0; i < 998; i++) block(); // 累计 999 块
        expect(armor.identified).toBe(false);
        expect(armor.charges).toBe(1);

        block(); // 第 1000 块
        expect(armor.identified).toBe(true);
        expect(armor.displayName).toBe('Leather Armor +1');

        // 错误实现"脱下还计数"：卸下后剩余计数不得变动
        game.unequipItem(armor);
        expect(armor.charges).toBe(0);
        const frozen = armor.charges;
        for (let i = 0; i < 5; i++) block();
        expect(armor.charges).toBe(frozen);
    });
});

describe('A8: 戒指穿戴门槛（CE GlobalsBrogue.c:1042 = 1500 客观块）', () => {
    it('边界：1499 块不亮、第 1500 块实例+种类一起亮（CE identify()）', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const ring = ItemLoader.spawnRing('ring_of_regeneration', -1, -1)!;
        game.player.inventory.addItem(ring);
        game.equipItem(ring); // 第 1 块
        const block = () => (game as unknown as { objectiveTimeBlock(): void }).objectiveTimeBlock();

        for (let i = 0; i < 1498; i++) block(); // 累计 1499 块
        expect(ring.identified).toBe(false);
        expect(ItemLoader.identifiedItems.has('ring_of_regeneration')).toBe(false);

        block(); // 第 1500 块
        // 错误实现"只亮实例不亮种类"（护甲路径照搬）：戒指必须走 identify() 两条都亮
        expect(ring.identified).toBe(true);
        expect(ItemLoader.identifiedItems.has('ring_of_regeneration')).toBe(true);
        expect(ring.displayName).toBe('Ring of Regeneration');
    });

    it('戴上即亮种类：clairvoyance/stealth（CE Items.c:8583-8586）；普通戒指不行', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const clair = ItemLoader.spawnRing('ring_of_clairvoyance', -1, -1)!;
        game.player.inventory.addItem(clair);
        game.equipItem(clair);
        expect(ItemLoader.identifiedItems.has('ring_of_clairvoyance')).toBe(true);
        // 附魔 0 ≤ 0：无隐藏价值，连实例一起亮（CE Items.c:6696-6700）
        expect(clair.identified).toBe(true);

        game.unequipItem(clair);
        const regen = ItemLoader.spawnRing('ring_of_regeneration', -1, -1)!;
        game.player.inventory.addItem(regen);
        game.equipItem(regen);
        expect(ItemLoader.identifiedItems.has('ring_of_regeneration')).toBe(false);
        expect(regen.identified).toBe(false);
    });
});

describe('A9: 开局清零（CE resetItemTableEntry，Items.c:8775-8800）', () => {
    it('上一局识别的种类不得漏进新局；护符/护符石无未知态（预亮）', () => {
        const gameA = createHeadlessGame(42);
        ItemLoader.identifiedItems.add('potion_of_life');
        ItemLoader.identifiedItems.add('scroll_of_teleportation');
        ItemLoader.identifiedItems.add('wand_of_slowness');
        expect(ItemLoader.identifiedItems.size).toBeGreaterThanOrEqual(9); // 3 + 6 护符 + 1 护符石

        const gameB = createHeadlessGame(777);
        // 错误实现：initConsumables 漏 clear 或 startNewGame 漏调 initConsumables → 本断言红
        expect(ItemLoader.identifiedItems.has('potion_of_life')).toBe(false);
        expect(ItemLoader.identifiedItems.has('scroll_of_teleportation')).toBe(false);
        expect(ItemLoader.identifiedItems.has('wand_of_slowness')).toBe(false);
        // CE 护符表预置 identified=true（GlobalsBrogue.c:714-726）：开局只有这些预亮
        const preIdentified = [...ItemLoader.identifiedItems].sort();
        expect(preIdentified).toEqual([
            ...ItemLoader.charms.map(c => c.id).sort(),
            ...ItemLoader.amulets.map(a => a.id).sort(),
        ].sort());
        void gameA; void gameB;
    });
});

describe('A10: 卷轴"用完不自亮"例外（CE Items.c:8019-8026；identify 卷轴自亮见 7776-7781）', () => {
    it('enchanting 用完不亮自己；identify 读的瞬间自亮（反驳 B-0 §1.4 表格）；其它卷轴亮', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const give = (id: string): Item => {
            const s = ItemLoader.spawnScroll(id, -1, -1)!;
            game.player.inventory.addItem(s);
            return s;
        };
        game.readItem(give('scroll_of_enchantment'));
        expect(ItemLoader.identifiedItems.has('scroll_of_enchantment')).toBe(false);

        // CE Items.c:7776：case SCROLL_IDENTIFY 先 identify(theItem)——卷轴自身
        // 种类即亮并宣告 "this is a scroll of identify."（B-0 §1.4 表格称 identify
        // 也不自亮，与源码不符，以 CE 为准并在报告反驳）
        game.readItem(give('scroll_of_identify'));
        expect(ItemLoader.identifiedItems.has('scroll_of_identify')).toBe(true);

        game.readItem(give('scroll_of_teleportation'));
        expect(ItemLoader.identifiedItems.has('scroll_of_teleportation')).toBe(true);
    });
});

describe('A11: 最后一种类自动升格（CE Items.c:6635-6673）', () => {
    it('戒指类（全 +1）：恰好剩 1 种未识别且对侧全识别 → 升格；剩 2 种不升格', () => {
        const ids = ItemLoader.rings.map(r => r.id);
        expect(ids.length).toBe(6);
        for (const id of ids) ItemLoader.identifiedItems.delete(id); // 清掉预亮（护符预亮不受影响）
        const unId = () => ids.filter(id => !ItemLoader.identifiedItems.has(id));

        // 错误实现"≥2 未识别就升格"：识别第 4 种后仍剩 2 种，必须不升格
        for (const id of ids.slice(0, 3)) ItemLoader.identifiedItems.add(id);
        const probe = ItemLoader.spawnRing(ids[3]!, -1, -1)!;
        ItemLoader.identifyItemKind(probe);
        expect(unId()).toEqual([ids[4]!, ids[5]!]);

        // 识别第 5 种 → 恰剩 1 种 → 最后一种自动升格（对侧极性类为空 ≙ 全识别）
        const trigger = ItemLoader.spawnRing(ids[4]!, -1, -1)!;
        ItemLoader.identifyItemKind(trigger);
        expect(unId()).toEqual([]);
        expect(ItemLoader.identifiedItems.has(ids[5]!)).toBe(true);
    });

    it('极性分组：善意类剩 1 时，对侧（恶意）未全识别 → 不升格', () => {
        // CE 语义：某极性类剩 1 种未识别时，需"本类极性已被揭示（B-1c 前恒否）"
        // 或"对侧极性类全识别"才升格。恶意药水类含退池的 poison/creeping_death
        // （恒不识别）→ 恶意类升格结构性不可达；同时它也压住"善意剩 1"的升格。
        // web 药水表无 potion_of_speed（CE 有、web 缺，B-0 §5.1-9 目录缺口），
        // 善意类现为 7 种。
        const benign = ['potion_of_life', 'potion_of_strength', 'potion_of_telepathy', 'potion_of_levitation',
            'potion_of_detect_magic', 'potion_of_fire_immunity', 'potion_of_invisibility'];
        expect(benign.every(id => ItemLoader.potions.some(p => p.id === id))).toBe(true);
        for (const id of benign.slice(0, 5)) ItemLoader.identifiedItems.add(id);
        const trigger = ItemLoader.spawnPotion(benign[5]!, -1, -1)!;
        ItemLoader.identifyItemKind(trigger);
        // 善意类此刻恰剩 benign[6] 未识别，但恶意类远未全识别 → 不得升格
        expect(ItemLoader.identifiedItems.has(benign[6]!)).toBe(false);
    });
});

describe('A12: 鉴定卷轴 = 实例全亮 + 种类亮（CE identify()，Items.c:7636-7648）', () => {
    it('目标池按 CAN_BE_IDENTIFIED 过滤；命中者附魔/符文一起亮', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        // 背包里唯一可鉴定的目标：一把带符文的未知剑（开局三件套已鉴定 → 不可选）
        const wpn = ItemLoader.spawnWeapon('sword', -1, -1)!;
        wpn.enchantment = 2;
        wpn.runicType = 'quietus';
        wpn.runicKnown = false;
        game.player.inventory.addItem(wpn);

        const scroll = ItemLoader.spawnScroll('scroll_of_identify', -1, -1)!;
        game.player.inventory.addItem(scroll);
        game.readItem(scroll);

        expect(wpn.identified).toBe(true);
        expect(wpn.runicKnown).toBe(true); // CE：RUNIC_IDENTIFIED | RUNIC_HINTED
        expect(wpn.displayName).toContain('+2');
        expect(wpn.displayName).toContain('quietus');
    });

    it('CAN_BE_IDENTIFIED 维护（CE updateIdentifiableItem，Items.c:7699-7713）', () => {
        const done = ItemLoader.spawnWeapon('sword', -1, -1)!; // 无符文
        done.identified = true;
        ItemLoader.updateIdentifiableItem(done);
        expect(done.canBeIdentified).toBe(false); // 没有可学的了

        const hinted = ItemLoader.spawnWeapon('sword', -1, -1)!;
        hinted.identified = true;
        hinted.runicType = 'quietus';
        hinted.runicKnown = false;
        ItemLoader.updateIdentifiableItem(hinted);
        expect(hinted.canBeIdentified).toBe(true); // 符文还未知：仍是合法目标
        hinted.runicKnown = true;
        ItemLoader.updateIdentifiableItem(hinted);
        expect(hinted.canBeIdentified).toBe(false);

        const potion = ItemLoader.spawnPotion('potion_of_life', -1, -1)!;
        potion.canBeIdentified = true;
        ItemLoader.identifiedItems.add('potion_of_life');
        ItemLoader.updateIdentifiableItem(potion);
        expect(potion.canBeIdentified).toBe(false); // 种类已知：药水无可学
    });
});

describe('A13: RNG 流哨兵（任务书 §四：本轮不许移动 RNG 流）', () => {
    /**
     * 基线取自 B-1a 改动落地后（与改动前逐位一致——本轮零掷骰消耗，
     * generation_baseline 同日复测绿）。签名 = 全链 D1..D26 逐层物品
     * `类别|种类|坐标|附魔|诅咒|符文|数量` 排序拼接后的 FNV-1a。
     * 任何"新增随机抽取/改变池大小/调整发放顺序"的改动都会打红本哨兵：
     * 请先查清成因；确属有意移动 RNG 流的轮次（如 B-4）应重采并说明。
     */
    // ★ 合并到含 C-5 的 main 后由验收方重锚 ★
    // B-1a 从 C-5 合并之前的 main 分叉，这份签名测的是**改深渊之前**的地图；
    // 合并后深渊湖改写了地形与 RNG 流，签名自然对不上。
    //
    // **B-1a 本身没有移动 RNG 流**——同一次运行里 `generation_baseline` 是绿的
    // （它已按 C-5 重捕获过），那才是"本轮不许移动 RNG 流"的权威判据。
    // 本哨兵是**地图锚定**的，与 g_2/g_3 的 FIRE-NAT 同类。
    //
    // ⚠️ 并行执行的固有成本：两轮并行、其中一轮改生成时，
    // 另一轮的地图锚定哨兵在**合并时**必然要重锚。
    // 下次可考虑把签名建在构造地图上以消除这个耦合。
    const SENTINEL: Record<number, string[]> = {
        42: ['c2cc20da', 'ebc8e850', '5933111b', 'd1e66360', 'f75f1f5e', '1660d5fd', '9d13aff9', '131a0b8a', 'b6eff72f', 'a02c4acc', '8f142bf5', '383c937b', '25fd4f18', 'e5b0e317', '3f9e07a6', 'f6cc3e25', '3aab5dd2', 'e10d4edb', '9524ee39', '3e552400', '18cbb09a', 'c9d01613', 'af016dff', 'cdf53b38', 'ee4f5333', 'e24b4410'],
        2026: ['cd41797c', 'cfc4a6d3', '00997c2c', 'e507d4c8', '5662546a', '8198545e', '218f0734', '9f88b23c', '1c901519', 'ba8c3d91', '1f9b2f6a', 'a1aac62d', '90d90acd', 'e05cf4c3', '10d4f82f', 'e4c0a7e5', 'b09e3025', 'a3e6ddf3', '15d0dba4', '9720899e', '97e6535b', '8a46ab84', '8d2f0fdf', '89875e85', 'c54b5532', '39a5ee50'],
    };

    function fnv1a(s: string): string {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(16).padStart(8, '0');
    }

    it('seed 42 / 2026 全链逐层物品签名与基线逐位一致', () => {
        const catName = (c: ItemCategory): string => ItemCategory[c] ?? String(c);
        const kindOf = (it: Item): string => (it as any).consumableId ?? (it as any).identityId ?? it.name;
        const sigKey = (it: Item): string =>
            `${catName(it.category)}|${kindOf(it)}|${it.loc.x},${it.loc.y}|e${it.enchantment}|c${it.isCursed ? 1 : 0}|r${it.runicType ?? '-'}|q${it.quantity}`;

        for (const [seed, expected] of Object.entries(SENTINEL)) {
            const game = createHeadlessGame(Number(seed));
            const hashes: string[] = [];
            const dump = () => hashes.push(fnv1a([...game.items].map(sigKey).sort().join(';')));
            dump();
            for (let d = 2; d <= 26; d++) {
                game.depth = d;
                (game as unknown as { generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void }).generateDepth(false, false);
                dump();
            }
            expect(hashes, `seed=${seed} 的物品生成签名漂移——RNG 流被移动了`).toEqual(expected);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 留痕测试：本轮明确不做（任务书 §三）。断言现状；反转轮次见各条注释。
// ─────────────────────────────────────────────────────────────────────────────
describe('留痕：鉴定态不进存档（P1-48 → B-1b 反转本组断言）', () => {
    it('快照无任何鉴定字段；读档后种类鉴定集与实例旗标全部丢失', () => {
        const game = createHeadlessGame(42);
        ItemLoader.identifiedItems.add('potion_of_life');
        const wpn = ItemLoader.spawnWeapon('sword', -1, -1)!;
        wpn.enchantment = 2;
        wpn.identified = true;
        game.player.inventory.addItem(wpn);

        const snap = game.toSnapshot();
        // 快照 schema 无鉴定字段（B-1b 将新增 identified/identifiedItems 等——届时反转）
        expect(Object.keys(snap).some(k => k.toLowerCase().includes('identif'))).toBe(false);
        expect(Object.keys(snap.player.inventory[0]!).some(k => k.toLowerCase().includes('identif'))).toBe(false);

        // 读档：种类集被 initConsumables 清空（只剩护符/护符石预亮），实例旗标按 spawn 语义重建
        const reloaded = createHeadlessGame(1);
        reloaded.loadSnapshot(snap);
        expect(ItemLoader.identifiedItems.has('potion_of_life')).toBe(false);
        const wpn2 = reloaded.player.inventory.items.find(i => i.category === ItemCategory.WEAPON && i.name.includes('Sword'));
        expect(wpn2?.identified).toBe(false);
        expect(wpn2?.displayName).toBe('Sword'); // 读档后暂失已鉴定态（B-1b 持久化后消除）
    });
});

describe('留痕：call/inscribe 未实现（→ B-1b 反转）', () => {
    it('ItemLoader 无 call 绰号 API；未识别品显示名不含 "called"', () => {
        expect((ItemLoader as unknown as Record<string, unknown>).callItem).toBeUndefined();
        expect((ItemLoader as unknown as Record<string, unknown>).callTitle).toBeUndefined();
        const potion = ItemLoader.spawnPotion('potion_of_life', -1, -1)!;
        expect(potion.displayName).not.toContain('called');
    });
});

describe('留痕：戒指单槽（→ B-1b 反转）', () => {
    it('Player 无 ringLeft/ringRight；戴第二枚顶掉第一枚', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const player = game.player as unknown as Record<string, unknown>;
        expect(player.ringLeft).toBeUndefined();
        expect(player.ringRight).toBeUndefined();
        const r1 = ItemLoader.spawnRing('ring_of_regeneration', -1, -1)!;
        const r2 = ItemLoader.spawnRing('ring_of_wisdom', -1, -1)!;
        game.player.inventory.addItem(r1);
        game.player.inventory.addItem(r2);
        game.equipItem(r1);
        game.equipItem(r2);
        expect(game.player.equippedRing?.id).toBe(r2.id);
    });
});

describe('留痕：免费解咒/充能作弊面仍在线（→ B-1b 移除时反转）', () => {
    it('Game.uncurseItem / rechargeArcanaItem 存在且可免费用', () => {
        const game = createHeadlessGame(42, 'test');
        expect(typeof (game as unknown as Record<string, unknown>).uncurseItem).toBe('function');
        expect(typeof (game as unknown as Record<string, unknown>).rechargeArcanaItem).toBe('function');
    });
});

describe('留痕：投掷仍是"传送+落地"，无弹道无伤害（→ B-2 反转）', () => {
    it('扔剑到空地：剑落地、相邻怪不掉血、无命中结算', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const wpn = ItemLoader.spawnWeapon('sword', -1, -1)!;
        game.player.inventory.addItem(wpn);
        const rat = makeMonster(game, 'rat', 5, 6);
        const hpBefore = rat.hp;

        game.throwItemAt(wpn, 6, 6); // 空地
        expect(game.items.some(i => i.id === wpn.id && i.loc.x === 6 && i.loc.y === 6)).toBe(true);
        expect(rat.hp).toBe(hpBefore); // 对怪物零效果
    });
});

describe('留痕：三占位卷轴仍为日志占位（→ B-3 反转）', () => {
    it('negation/sanctuary/shattering 读取后无机制效果', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const give = (id: string): Item => {
            const s = ItemLoader.spawnScroll(id, -1, -1)!;
            game.player.inventory.addItem(s);
            return s;
        };
        const monstersBefore = game.monsters.length;
        game.readItem(give('scroll_of_negation'));
        game.readItem(give('scroll_of_sanctuary'));
        game.readItem(give('scroll_of_shattering'));
        // B-3 实装后：negation 剥魔法、sanctuary 铺禁行地形、shattering 墙变水晶——届时反转
        expect(game.monsters.length).toBe(monstersBefore);
    });
});

describe('留痕：detect magic 极性系统未实装（→ B-1c 反转）', () => {
    it('喝 detect magic 只亮该种类，无极性揭示/恶意确认机制', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const potion = ItemLoader.spawnPotion('potion_of_detect_magic', -1, -1)!;
        game.player.inventory.addItem(potion);
        game.quaffItem(potion);
        expect(ItemLoader.identifiedItems.has('potion_of_detect_magic')).toBe(true);
        // B-1c 将引入 magicPolarityRevealed 状态与使用前确认——届时反转
        expect((ItemLoader as unknown as Record<string, unknown>).magicPolarityRevealed).toBeUndefined();
    });
});
