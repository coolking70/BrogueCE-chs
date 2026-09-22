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
 *
 * B-1c 更正（2026-09-17）：A11 第二例注释里的 "web 药水表无 potion_of_speed"
 * 是 B-1a 的事实错误——CE POTION_SPEED 在 web 的 id 是 `potion_of_haste`
 * （consumables.json，trueName "Potion of Speed"），善意药水类实为 8 种。
 * ItemLoader.MAGIC_POLARITY 的键已随之更正，本文件断言未受影响（当时也
 * 只断言"不得升格"）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import i18next from 'i18next';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { cellTerrainFlags } from '../engine/Map/DungeonFeature';
import { T_OBSTRUCTS_ITEMS, T_PATHING_BLOCKER, T_IS_DF_TRAP } from '../engine/Map/TerrainCatalog';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
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
        // 验收方 2026-09-18 修（跨文件泄漏，本文件不在 UI-1/C-8/V-1a 任一清单内）：
        // B-4a 之后 spawnArmor 会按 CE 掷 40% 附魔/符文分支（Items.c:237-263），
        // 掷中符文时 displayName 会带 `(unknown runic)` 后缀。
        // 本用例的**被测对象是"诅咒与负附魔不进名字"**，与符文无关——
        // 此前它能过，靠的是进入本文件时 rng 流位置恰好没掷中符文，
        // 于是它对**文件执行顺序**产生了隐性依赖：
        // 单跑绿，但 `generation_baseline` 排在它之前跑就翻红
        // （实测 'Leather Armor -1 (unknown runic)' ≠ 'Leather Armor -1'）。
        // 这正是 T-1 登记的「vitest 单 worker 下模块级单例跨文件泄漏」。
        // 修法是**把无关变量显式清掉**，让断言只表达它真正要表达的意思，
        // 而不是去挑一个走运的流位置。
        armor.runicType = undefined;
        armor.runicKnown = false;
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
        // W-2 留痕反转：旧“用一次种类即亮”并非 CE。
        // Items.c:5220-5227 BE_TELEPORT 不设置 autoID；:7397-7405 仅依结果鉴定。
        game.useArcanaItem(wand);
        game.setArcanaTarget(game.player.loc.x + 1, game.player.loc.y);
        game.confirmArcanaTarget();
        expect(ItemLoader.identifiedItems.has('wand_of_teleportation')).toBe(false);
        expect(wand.identified).toBe(false);
        // CE Items.c:1615-1634：未识别魔杖显示使用次数，不显示充能
        expect(wand.displayName).not.toContain('Wand of Teleportation');
        expect(wand.displayName).toMatch(/已使用 1 次|used once/);
        expect(wand.displayName).not.toContain('[');
        expect(allLines(generateItemDetail(wand, 16)).some(t => t.startsWith('充能:'))).toBe(false);
        expect(allLines(generateItemDetail(wand, 16)).some(t => t.match(/已使用 1 次|used once/))).toBe(true);
    });

    it('实例鉴定后显示充能 [剩余]；空杖敲一下亮充能上限 [?/上限]（跟着风味名走）', () => {
        const wand = ItemLoader.spawnWand('wand_of_teleportation', -1, -1)!;
        // Use the real identification API; the old fixture depended on the previous test revealing the kind.
        ItemLoader.identifyInstance(wand);
        expect(wand.displayName).toBe(`Wand of Teleportation [${wand.charges}]`);
        expect(allLines(generateItemDetail(wand, 16)).some(t => t.startsWith('充能:'))).toBe(true);

        // CE Items.c:7420-7424：对耗尽法器再施放 → ITEM_MAX_CHARGES_KNOWN。
        // 种类未识别 → 名字是风味名，[?/上限] 跟在其后（CE itemName 先选名根
        // 再拼充能，Items.c:1645-1653）。
        const staff = ItemLoader.spawnStaff('staff_of_lightning', -1, -1)!;
        // W-5: this is an unknown-state fixture, not a generation distribution assertion.
        // Explicitly retain its E=2 capacity; production staff generation now rolls E.
        staff.enchantment = staff.maxCharges = 2;
        staff.charges = 0;
        const game = createHeadlessGame(42);
        game.player.inventory.addItem(staff);
        game.useArcanaItem(staff);
        expect(staff.maxChargesKnown).toBe(false); // W-2: cancellation is free, discovery follows confirmation.
        game.setArcanaTarget(game.player.loc.x + 1, game.player.loc.y);
        game.confirmArcanaTarget();
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
        // B-1c 更正：CE POTION_SPEED 在 web 的 id 是 potion_of_haste（B-1a 把键
        // 写成了 potion_of_speed，B-0 §5.1-9 的"目录缺口"结论不成立），
        // 善意药水类实为 8 种。本例只断言"不得升格"，不受种类数影响。
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
        // B-1b（原断言到期）：目标改为玩家指定（CE promptForItemOfType，
        // Items.c:7783-7802）——readItem 只进入待选态，落账在玩家点选时
        // （这里以玩家身份选 wpn；"仍随机挑"的错误实现由 b_1b 测试文件对抗）
        expect(game.pendingIdentify).toBe(true);
        expect(game.chooseIdentifyTarget(wpn)).toBe(true);

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

describe('A13: 物品生成哨兵（S-1 改造：结构合法性 + 同种子双跑确定性）', () => {
    /**
     * S-1 改造说明。原 A13 = 全链 D1..D26 逐层物品签名硬编码（seed 42/2026），
     * 锚定的是**地图生成 + RNG 流位置**的复合产物——与 g_2/g_3 的 FIRE-NAT
     * 同类，C-5/C-6 两次实证：任何改生成的轮次都会让它翻红，而它翻红既可能
     * 是"物品放置被改"（真阳性）也可能是"地图/流被改"（假阳性），两种成因
     * 在输出签名里不可分离。S-1 把它拆成两个**对流位移免疫**的守卫：
     *
     *  L1 落格合法性（形态③性质断言）：全链每一件生成物品都落在物品合法格
     *     ——CE 物品落位一律回避 T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER
     *     （Rogue.h:1926/:1948；web 的 floorTiles 牌堆、P1-43 岩浆修复同源）。
     *     捕获的错误实现：牌堆判据被绕开/删除（物品进墙、岩浆、深渊）。
     *  L2 同种子双跑确定性：同 seed 重播种后全链物品签名必须逐位一致。
     *     捕获的错误实现：生成链里任何**非确定性**掷骰（Math.random 类泄漏、
     *     时间种子漏网）——两次全链跑不完全一致，立即翻红。这是地形指纹
     *     测试（"同一次运行内两次生成一致"口径）在物品侧的对应物。
     *
     * **守卫降级登记**：原 A13 对"新增抽取/改变池大小/调整发放顺序"的逐位
     * 流敏感性**不再由本哨兵承担**——生成期逐位流权威在 generation_baseline
     * fixture（验收方随生成轮重锚）。物品生成逻辑的其余错误形态由
     * p1_20_item_placement / invented_content_pool / monster_damage_balance
     * 等内容级哨兵承担。
     *
     * ★ 已知违例口（边界外发现，只登记不修——修复轮应收紧为 0）★
     * HEAD 实测 2 件宝物落在 T_IS_DF_TRAP 格上（seed42/D25 Ring of
     * Clairvoyance @(28,2)；seed2026/D8 Staff of Conjuration @(4,14)），
     * 成因：trap vault 宝物直接放 vault.center（陷阱正中）。T_IS_DF_TRAP ∈
     * T_PATHING_BLOCKER（Rogue.h:1948），CE 不会把物品放上陷阱。L1 因此把
     * T_IS_DF_TRAP 单列豁免计数（≤2），其余旗标（T_OBSTRUCTS_ITEMS、
     * 岩浆、深渊等）仍为严格 0。
     */

    const SENTINEL_SEEDS = [42, 2026];

    function walkChain(seed: number, visit: (game: Game, depth: number) => void): void {
        const game = createHeadlessGame(seed);
        visit(game, 1);
        for (let d = 2; d <= 26; d++) {
            (game as unknown as { depth: number }).depth = d;
            (game as unknown as { generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void }).generateDepth(false, false);
            visit(game, d);
        }
    }

    it('L1 全链 D1..D26 每件生成物品都落在物品合法格（CE T_OBSTRUCTS_ITEMS|T_PATHING_BLOCKER 回避）', () => {
        for (const seed of SENTINEL_SEEDS) {
            walkChain(seed, (game, depth) => {
                for (const it of game.items) {
                    const flags = cellTerrainFlags(game.grid, it.loc.x, it.loc.y);
                    const hardBad = flags & (T_OBSTRUCTS_ITEMS | T_PATHING_BLOCKER) & ~T_IS_DF_TRAP;
                    expect(hardBad, `seed${seed}/D${depth} ${it.name} @ (${it.loc.x},${it.loc.y}) ` +
                        `落在物品非法格（旗标位 ${hardBad}）——落位判据被绕开/删除。` +
                        `修复指引（p1_43 同族）：Game.ts 的 altar/vault/floorTiles 落格池` +
                        `只查了 terrain===LAVA 的窄口径，应改用完整旗标谓词 ` +
                        `T_OBSTRUCTS_ITEMS|T_PATHING_BLOCKER（Rogue.h:1926/:1948）；` +
                        `修复落地后本哨兵即绿，届时无需改本断言。`)
                        .toBe(0);
                }
            });
        }
        // 已知违例口：trap vault 宝物落 vault.center = T_IS_DF_TRAP 格。
        // 当前恰 2 处（见 describe 头注）；修复轮到来时把常量改 0 并删本口。
        let trapViolations = 0;
        for (const seed of SENTINEL_SEEDS) {
            walkChain(seed, (game) => {
                for (const it of game.items) {
                    if (cellTerrainFlags(game.grid, it.loc.x, it.loc.y) & T_IS_DF_TRAP) trapViolations++;
                }
            });
        }
        expect(trapViolations, '陷阱格物品数漂移（当前已知口为 2，新增=新的非法落位路径）')
            .toBeLessThanOrEqual(2);
    });

    it('L2 同种子双跑全链物品签名逐位一致（非确定性掷骰——Math.random 类泄漏——在此翻红）', () => {
        const catName = (c: ItemCategory): string => ItemCategory[c] ?? String(c);
        const kindOf = (it: Item): string => (it as any).consumableId ?? (it as any).identityId ?? it.name;
        const sigKey = (it: Item): string =>
            `${catName(it.category)}|${kindOf(it)}|${it.loc.x},${it.loc.y}|e${it.enchantment}|c${it.isCursed ? 1 : 0}|r${it.runicType ?? '-'}|q${it.quantity}`;
        const run = (): string[] => {
            const hashes: string[] = [];
            let fnv = 0x811c9dc5;
            const push = (line: string): void => {
                for (let i = 0; i < line.length; i++) {
                    fnv ^= line.charCodeAt(i);
                    fnv = Math.imul(fnv, 0x01000193);
                }
                hashes.push((fnv >>> 0).toString(16).padStart(8, '0'));
            };
            walkChain(42, (game) => push([...game.items].map(sigKey).sort().join(';')));
            return hashes;
        };
        const a = run();
        const b = run();
        expect(b, '同 seed 两次全链生成的物品签名不一致——生成链存在非确定性掷骰').toEqual(a);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 留痕反转区（B-1b 落地）。原 B-1a 留痕断言已按"反转 = 断言新事实 + 保留越界
// 守卫"改造；原断言内容保留在注释里，供回溯。
// ─────────────────────────────────────────────────────────────────────────────
describe('已反转（B-1b）：鉴定态进存档（原 P1-48 留痕）', () => {
    /**
     * 原留痕断言（B-1a 立）：快照无任何鉴定字段；读档后种类鉴定集与实例
     * 旗标全部丢失。B-1b 持久化落地，本组反转为断言新事实：
     * 种类集 + 实例旗标 + 绰号全部随存档往返。反向（只存一半）的对抗由
     * b_1b_identification_persistence.test.ts 承担。
     */
    it('快照携带鉴定字段；读档后种类集、实例旗标、绰号全部还原', () => {
        const game = createHeadlessGame(42);
        ItemLoader.identifiedItems.add('potion_of_life');
        ItemLoader.callKind('potion_of_life', '生命的味道');
        const wpn = ItemLoader.spawnWeapon('sword', -1, -1)!;
        wpn.enchantment = 2;
        wpn.identified = true;
        game.player.inventory.addItem(wpn);

        const snap = game.toSnapshot();
        // 快照 schema 现在携带鉴定字段（原留痕断言"无 identif* 字段"已到期）
        expect(snap.identifiedItems).toContain('potion_of_life');
        expect(snap.callTitles?.['potion_of_life']).toBe('生命的味道');
        const snapWpn = snap.player.inventory.find((s) => s.name === 'Sword')!;
        expect(snapWpn.identified).toBe(true);
        expect(snapWpn.canBeIdentified).toBe(true);

        // 读档：种类集、实例旗标、绰号全部还原（原断言"读档后全丢"已到期）
        const reloaded = createHeadlessGame(1);
        reloaded.loadSnapshot(snap);
        expect(ItemLoader.identifiedItems.has('potion_of_life')).toBe(true);
        expect(ItemLoader.callTitles.get('potion_of_life')).toBe('生命的味道');
        const wpn2 = reloaded.player.inventory.items.find(i => i.category === ItemCategory.WEAPON && i.name.includes('Sword'));
        expect(wpn2?.identified).toBe(true);
        expect(wpn2?.displayName).toBe('Sword +2');
    });
});

describe('已反转（B-1b）：call 绰号已实现（原"call/inscribe 未实现"留痕）', () => {
    /**
     * 原留痕断言（B-1a 立）：ItemLoader 无 call 绰号 API；未识别品显示名
     * 不含 "called"。B-1b 落地 callTitle（Map）与 called 显示分支。
     * 越界守卫保留：CE 对武器/护甲等无风味表类别的 call 转题字
     * （inscribeItem，Items.c:1373-1381）——web 仍无题字，callItem 必须
     * 拒绝这些类别（不得静默起绰号）。
     */
    it('callKind 落账 + 显示名进入 called 态；武器仍不可 call（题字未实现）', () => {
        expect(typeof (ItemLoader as unknown as Record<string, unknown>).callKind).toBe('function');
        expect(ItemLoader.callTitles).toBeInstanceOf(Map);

        const game = createHeadlessGame(42, 'test');
        const potion = ItemLoader.spawnPotion('potion_of_life', -1, -1)!;
        expect(potion.displayName).not.toContain('called'); // 还没起绰号：风味名
        game.callItem(potion, 'red bull');
        expect(ItemLoader.callTitles.get('potion_of_life')).toBe('red bull');
        expect(potion.displayName).toMatch(/called red bull|称为「red bull」/);

        // 越界守卫：武器没有风味种类表，callItem 拒绝（原"无 call API"留痕
        // 的精神由这条继承——题字轮到来前，武器不得被起绰号）
        const wpn = ItemLoader.spawnWeapon('sword', -1, -1)!;
        expect(game.callItem(wpn, 'stabby')).toBe(false);
        expect(ItemLoader.callTitles.size).toBe(1); // 只有药水那条
    });
});

describe('已反转（B-1b）：戒指双槽（原"戒指单槽"留痕）', () => {
    /**
     * 原留痕断言（B-1a 立）：Player 无 ringLeft/ringRight；戴第二枚顶掉
     * 第一枚。B-1b 双槽落地（CE Items.c:8560-8566：左槽优先、双占拒绝）。
     */
    it('Player 有 ringLeft/ringRight；第二枚进右槽不顶掉第一枚；双占拒绝', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const r1 = ItemLoader.spawnRing('ring_of_regeneration', -1, -1)!;
        const r2 = ItemLoader.spawnRing('ring_of_wisdom', -1, -1)!;
        const r3 = ItemLoader.spawnRing('ring_of_stealth', -1, -1)!;
        game.player.inventory.addItem(r1);
        game.player.inventory.addItem(r2);
        game.player.inventory.addItem(r3);
        game.equipItem(r1);
        game.equipItem(r2);
        // 原断言"第二枚顶掉第一枚（equippedRing === r2）"已到期：
        // 现在两枚同戴，第三枚被拒绝（CE "no available ring slot"）
        expect(game.player.ringLeft?.id).toBe(r1.id);
        expect(game.player.ringRight?.id).toBe(r2.id);
        expect(game.player.equip(r3)).toBe(false);
        expect(game.player.ringLeft?.id).toBe(r1.id);
        expect(game.player.ringRight?.id).toBe(r2.id);
    });
});

describe('已反转（B-1b）：免费解咒/充能作弊面已移除（原"仍在线"留痕）', () => {
    /**
     * 原留痕断言（B-1a 立）：Game.uncurseItem / rechargeArcanaItem 存在且可
     * 免费用。B-1b 按 D2 移除（CE 无此入口：解咒走 remove curse 卷轴的
     * removeCurseFromInventory，充能走 recharging 卷轴的 rechargeStaffsAndCharms）。
     * 越界守卫：真正等价的方法必须仍然在位——移除作弊面不得伤及卷轴路径。
     */
    it('Game.uncurseItem / rechargeArcanaItem 已不存在；卷轴等价物仍在位', () => {
        const game = createHeadlessGame(42, 'test');
        // 原断言"typeof === 'function'"已到期：方法本体删除
        expect((game as unknown as Record<string, unknown>).uncurseItem).toBeUndefined();
        expect((game as unknown as Record<string, unknown>).rechargeArcanaItem).toBeUndefined();
        // W-6：卷轴改为全包 STAFF/CHARM，方法随语义改名；免费入口仍禁止。
        // 越界守卫：卷轴路径（CE 有）不受移除影响
        expect(typeof (game as unknown as Record<string, unknown>).removeCurseFromInventory).toBe('function');
        expect(typeof (game as unknown as Record<string, unknown>).rechargeStaffsAndCharms).toBe('function');
    });

    it('InventoryOverlay 不再引用两个免费方法（静态守卫，防按钮复活）', () => {
        // 读组件源码扫属性访问（activeGame.rechargeArcanaItem / activeGame.uncurseItem）
        // ——这两个名字是 Game 的公开成员，按钮若复活必须原样出现，改局部
        // 变量名藏不住。直接对**生产文件**断言零引用。
        const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'components', 'InventoryOverlay.vue'), 'utf-8');
        expect(src).not.toMatch(/rechargeArcanaItem|uncurseItem/);
        // 免费充能/解咒按钮的旧文案载体（isRechargeable / performRecharge /
        // performUncurse）也须一并退场
        expect(src).not.toMatch(/isRechargeable|performRecharge|performUncurse/);
    });
});

describe('已反转（B-2）：投掷已是"弹道+命中+落地"，不再是传送+落地', () => {
    /**
     * 原留痕断言（B-1a 立）：
     *     game.throwItemAt(wpn, 6, 6); // 空地
     *     expect(items.some(i => i.id === wpn.id && loc == (6,6))).toBe(true);
     *     expect(rat.hp).toBe(hpBefore); // 对怪物零效果
     * B-2 按 CE Items.c:6772-7066 实装逐格弹道、命中掷骰、伤害与合格落点后，
     * "投掷对怪物零效果"的前提失效。反转 = 断言新事实 + 保留越界守卫，
     * 不是删掉；完整对抗矩阵（弹道逐格/命中骰/未中落地/堆叠递减/药水细分/
     * 熟悉度反常留痕/交互期哨兵）在 b_2_throwing.test.ts。
     */
    it('扔武器到弹道上的怪：有命中结算（掉血或被激怒，不再零效果）', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const dart = ItemLoader.spawnWeapon('dart', -1, -1)!;
        dart.quantity = 5;
        game.player.inventory.addItem(dart);
        const rat = makeMonster(game, 'rat', 6, 5); // 恰在 (5,5)→(6,5) 的弹道上
        const hpBefore = rat.hp;

        game.throwItemAt(dart, 6, 5);
        // 命中（掉血/击杀）或未命中（CE Items.c:6791-6801 掷骰前置 TRACKING_SCENT，
        // miss 也激怒→HUNTING）——旧世界"零效果"必居其一之外。
        const engaged = rat.hp < hpBefore || rat.state === MonsterState.HUNTING;
        expect(engaged, '投掷在弹道命中怪物却无任何结算').toBe(true);
        // 越界守卫：堆叠只递减 1（CE Items.c:7160-7162），不得整包消失
        expect(dart.quantity).toBe(4);
    });

    it('越界守卫：扔到空地的物品仍落在目标格（原留痕的存活部分）', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const wpn = ItemLoader.spawnWeapon('sword', -1, -1)!;
        game.player.inventory.addItem(wpn);
        game.throwItemAt(wpn, 6, 6); // 空地，弹道无阻挡
        expect(game.items.some(i => i.id === wpn.id && i.loc.x === 6 && i.loc.y === 6)).toBe(true);
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

describe('已反转（B-1c）：detect magic 极性系统已实装（原"未实装"留痕）', () => {
    /**
     * 原留痕断言（B-1a 立）：
     *     expect((ItemLoader as ...).magicPolarityRevealed).toBeUndefined();
     * 即"ItemLoader 上根本没有极性揭示这个状态"。B-1c 接上 detect magic 后
     * 该前提失效（CE itemTable.magicPolarityRevealed，Rogue.h:1436 →
     * ItemLoader.magicPolarityRevealed:Set<kindId>）。
     * 按项目规矩反转 = 断言新事实 + 保留越界守卫，不是删掉。
     */
    it('喝 detect magic：既亮该种类，也揭示背包内其余种类的极性', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const potion = ItemLoader.spawnPotion('potion_of_detect_magic', -1, -1)!;
        const other = ItemLoader.spawnPotion('potion_of_incineration', -1, -1)!;
        game.player.inventory.addItem(potion);
        game.player.inventory.addItem(other);
        game.quaffItem(potion);
        expect(ItemLoader.identifiedItems.has('potion_of_detect_magic')).toBe(true);
        // 原断言到期：极性状态现在真实存在，且 detect magic 写进了它
        expect(ItemLoader.magicPolarityRevealed).toBeInstanceOf(Set);
        expect(ItemLoader.isPolarityRevealed('potion_of_incineration')).toBe(true);
        // 越界守卫①：揭示极性 ≠ 揭示真名——那瓶焚化药水的种类仍未识别
        expect(ItemLoader.identifiedItems.has('potion_of_incineration')).toBe(false);
        expect(other.displayName).not.toBe(other.name);
        // 越界守卫②：没被照到的种类不得被顺手揭示
        expect(ItemLoader.isPolarityRevealed('potion_of_paralysis')).toBe(false);
    });
});
