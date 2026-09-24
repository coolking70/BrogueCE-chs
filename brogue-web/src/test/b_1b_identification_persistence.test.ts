/**
 * src/test/b_1b_identification_persistence.test.ts — B-1b 鉴定态持久化 + call
 * 绰号 + identify 目标指定 + 戒指双槽 + 免费按钮移除 的验收
 *
 * 对抗性断言与"具体错误实现"对照（每条都能在对应错误下失败）：
 *   P1  快照只存种类集、丢实例旗标（或反之）      → serialize/deserialize 落一半
 *   P2  读档被"按 spawn 语义重建"覆盖（B-1a 旧行为残留）
 *   P3  旧存档（无鉴定字段）读档崩溃或行为漂移    → 兼容回退缺失
 *   C1  called 绰号覆盖真名（已鉴定仍显示绰号）   → displayName 分支序写反
 *   C2  空文本未清除绰号 / 新局未清零绰号         → callKind / initConsumables 缺半
 *   I1  identify 卷轴仍随机挑而非玩家挑           → readItem 内直接落账
 *   I2  非法目标被接受 / 无可鉴物品仍进待选态     → choose/begin 校验缺失
 *   R1  戒指只处理了一只手                        → processIncrementalAutoID 未展开
 *   R2  旧档单槽 equippedRingId 迁移丢失          → loadSnapshot 兼容分支缺失
 *   S1  RNG 哨兵：持久化/call/选择/揭示零掷骰     → 任何新增抽取（构造地图口径，
 *                                                  对生成器改动免疫，任务书 §三）
 *   X1  挂起中的选择跨场景泄漏                    → loadSnapshot/startNewGame 未复位
 *
 * CE 权威出处：identify 目标指定 Items.c:7774-7802；call Items.c:1347-1437；
 * callTitle 字段 Rogue.h:1426-1427；双槽 Items.c:8560-8566、Time.c:1988-2024；
 * 旧局清零 resetItemTableEntry Items.c:8775-8800。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import i18next from 'i18next';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Item } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';

beforeAll(() => {
    if (!i18next.isInitialized) {
        i18next.init({
            lng: 'en',
            fallbackLng: false,
            resources: {},
            initImmediate: false,
        });
    }
});

/** 与 b_1a 同款：清场 + 安全落位（本文件所有操作不依赖怪物与地形）。 */
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

/** 造一把已知形状的测试剑（spawn 消耗掷骰，调用方须在哨兵计数起点前完成）。 */
function makeSword(game: Game, enchantment: number): Item {
    const wpn = ItemLoader.spawnWeapon('sword', -1, -1)!;
    wpn.enchantment = enchantment;
    wpn.runicType = undefined;
    game.player.inventory.addItem(wpn);
    return wpn;
}

describe('P1: 快照必须同时保住种类集与实例旗标（只存一侧即红）', () => {
    it('存读档往返：种类识别、实例附魔态、充能上限知识、使用计数全部还原', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);

        // 种类识别（层 1）：药水种类亮、实例未知
        const potion = ItemLoader.spawnPotion('potion_of_life', -1, -1)!;
        ItemLoader.identifiedItems.add('potion_of_life');
        void potion;
        // 实例旗标（层 2）：剑已鉴定；魔杖只有上限知识与使用计数；护甲可鉴
        const sword = makeSword(game, 2);
        ItemLoader.identifyInstance(sword);
        const wand = ItemLoader.spawnWand('wand_of_teleportation', -1, -1)!;
        wand.timesUsed = 3;
        wand.maxChargesKnown = true;
        game.player.inventory.addItem(wand);
        const armor = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        armor.enchantment = 1;
        armor.runicType = 'reflection';
        armor.runicKnown = false;
        game.player.inventory.addItem(armor);

        game.loadSnapshot(JSON.parse(JSON.stringify(game.toSnapshot())));

        // 错误实现"只存种类集"：实例旗标全丢 → 下面四条全红
        expect(ItemLoader.identifiedItems.has('potion_of_life')).toBe(true);
        const sword2 = game.player.inventory.items.find(i => i.name === 'Sword')!;
        expect(sword2.identified).toBe(true);
        expect(sword2.displayName).toBe('Sword +2');
        const wand2 = game.player.inventory.items.find(i => i.name === 'Wand of Teleportation')!;
        expect(wand2.identified).toBe(false);          // 实例未鉴不许被翻成已鉴
        expect(wand2.maxChargesKnown).toBe(true);
        expect(wand2.timesUsed).toBe(3);
        const armor2 = game.player.inventory.items.find(i => i.name === 'Leather Armor')!;
        expect(armor2.canBeIdentified).toBe(true);     // 未知符文仍是合法鉴定目标
        // 错误实现"只存实例旗标"：种类集丢失 → 第一条已红
    });
});

describe('P2: 读档不得被"按 spawn 语义重建"覆盖（B-1a 旧行为残留）', () => {
    it('已鉴定剑读档后仍已鉴定；未鉴定剑仍未鉴定；两者互不污染', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const identifiedSword = makeSword(game, 2);
        ItemLoader.identifyInstance(identifiedSword);
        makeSword(game, 1); // 保持 spawn 出口的未鉴定态

        game.loadSnapshot(JSON.parse(JSON.stringify(game.toSnapshot())));

        // 旧 deserializeItem 把可未知类别一律置 identified=false——错误实现下
        // identifiedSword 读档后显示名会从 "Sword +2" 退回 "Sword"
        const swords = game.player.inventory.items.filter(i => i.name === 'Sword');
        const plus2 = swords.find(i => i.enchantment === 2)!;
        const plus1 = swords.find(i => i.enchantment === 1)!;
        expect(plus2.identified).toBe(true);
        expect(plus2.displayName).toBe('Sword +2');
        expect(plus1.identified).toBe(false);  // 未鉴不许被反向翻成已鉴
        expect(plus1.displayName).toBe('Sword');
    });
});

describe('C1: 三态显示序——真名 > called > 风味（CE itemName 分支序）', () => {
    it('绰号盖过风味；种类识别后真名短路、绰号必须消失', () => {
        const game = createHeadlessGame(42, 'test');
        const potion = ItemLoader.spawnPotion('potion_of_life', -1, -1)!;
        const flavorName = potion.displayName; // 风味名
        game.callItem(potion, 'red bull');
        // 错误实现"没有 called 分支"：仍显示风味名
        expect(potion.displayName).toMatch(/called red bull|称为「red bull」/);
        expect(potion.displayName).not.toBe(flavorName);

        // 错误实现"called 分支放在 identified 之前"：识别后仍显示绰号
        ItemLoader.identifiedItems.add('potion_of_life');
        expect(potion.displayName).toBe(potion.name); // 真名 "Potion of Life"
        expect(potion.displayName).not.toContain('red bull');

        // 魔杖：绰号作名根，充能/次数详情拼在其后（CE includeDetails 与名根正交）
        const wand = ItemLoader.spawnWand('wand_of_slowness', -1, -1)!;
        game.callItem(wand, 'slowpoke');
        expect(wand.displayName).toMatch(/called slowpoke|称为「slowpoke」/);
    });

    it('call 拒绝已识别种类（CE "you already know what that is."）', () => {
        const game = createHeadlessGame(42, 'test');
        const potion = ItemLoader.spawnPotion('potion_of_life', -1, -1)!;
        ItemLoader.identifiedItems.add('potion_of_life');
        expect(game.callItem(potion, 'nope')).toBe(false);
        expect(ItemLoader.callTitles.has('potion_of_life')).toBe(false);
    });
});

describe('C2: 绰号的清除与新局清零（CE Items.c:1429-1432 / 8778-8779）', () => {
    it('空/纯空白文本清除绰号；新局不残留上一局绰号', () => {
        const game = createHeadlessGame(42, 'test');
        const scroll = ItemLoader.spawnScroll('scroll_of_teleportation', -1, -1)!;
        game.callItem(scroll, '回家的纸');
        expect(ItemLoader.callTitles.get('scroll_of_teleportation')).toBe('回家的纸');
        // 错误实现"空串照存"：CE 空文本 = callTitle[0]='\0' + called=false
        game.callItem(scroll, '   ');
        expect(ItemLoader.callTitles.has('scroll_of_teleportation')).toBe(false);

        // 错误实现"initConsumables 漏清 callTitles"：新局残留
        game.callItem(scroll, '下一局不该看到的绰号');
        createHeadlessGame(777);
        expect(ItemLoader.callTitles.size).toBe(0);
    });
});

describe('I1: identify 卷轴 = 玩家指定目标（CE promptForItemOfType）', () => {
    it('读卷轴只进待选、不落账；点选谁谁亮（"随机挑"的实现此处必红）', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const swordA = makeSword(game, 1);
        const swordB = makeSword(game, 2);
        const scroll = ItemLoader.spawnScroll('scroll_of_identify', -1, -1)!;
        game.player.inventory.addItem(scroll);

        game.readItem(scroll);
        // 错误实现"读的时候随机挑一件落账"：此刻必须两把都未亮、处于待选态
        expect(game.pendingIdentify).toBe(true);
        expect(swordA.identified).toBe(false);
        expect(swordB.identified).toBe(false);

        // 玩家点名 B：只有 B 全亮
        expect(game.chooseIdentifyTarget(swordB)).toBe(true);
        expect(game.pendingIdentify).toBe(false);
        expect(swordB.identified).toBe(true);
        expect(swordA.identified).toBe(false);
    });

    it('无可鉴物品：不进待选态、卷轴照常消耗（CE "already identified" 短路）', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        // 开局三件套全部已鉴定 → 无候选
        const scroll = ItemLoader.spawnScroll('scroll_of_identify', -1, -1)!;
        game.player.inventory.addItem(scroll);
        game.readItem(scroll);
        expect(game.pendingIdentify).toBe(false);
        expect(game.player.inventory.items.some(i => (i as { consumableId?: string }).consumableId === 'scroll_of_identify')).toBe(false);
    });
});

describe('I2: 待选态的校验（CE do-while 强制合法目标）', () => {
    it('非候选目标被拒绝且留在待选态；未进待选态时 choose 无效', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const dagger = game.player.inventory.items.find(i => i.name === 'Dagger')!; // 已鉴定 → 非候选
        const sword = makeSword(game, 1);
        const scroll = ItemLoader.spawnScroll('scroll_of_identify', -1, -1)!;
        game.player.inventory.addItem(scroll);

        // 错误实现"choose 不校验 pendingIdentify"：未待选就能落账
        expect(game.chooseIdentifyTarget(sword)).toBe(false);
        expect(sword.identified).toBe(false);

        game.readItem(scroll);
        expect(game.pendingIdentify).toBe(true);
        // 错误实现"choose 不校验 canBeIdentified"：已鉴定的匕首被选中
        expect(game.chooseIdentifyTarget(dagger)).toBe(false);
        expect(game.pendingIdentify).toBe(true); // CE：选到合法目标为止
        expect(game.chooseIdentifyTarget(sword)).toBe(true);
        expect(game.pendingIdentify).toBe(false);
    });
});

describe('R1: 双槽熟悉度倒计时（CE Time.c:1988-2024 三槽循环）', () => {
    it('同一客观块两枚戒指各自扣减；只有右槽归零时只揭示右槽', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const left = ItemLoader.spawnRing('ring_of_regeneration', -1, -1)!;
        const right = ItemLoader.spawnRing('ring_of_wisdom', -1, -1)!;
        game.player.inventory.addItem(left);
        game.player.inventory.addItem(right);
        // 绕开 equipItem 的回合推进，精确控制计数器
        game.player.equip(left);
        game.player.equip(right);
        left.charges = 2;
        right.charges = 1;

        (game as unknown as { processIncrementalAutoID(): void }).processIncrementalAutoID();

        // 错误实现"只处理单槽"（旧 equippedRing 形态残留）：右槽揭示、左槽纹丝不动
        expect(right.identified).toBe(true);
        expect(ItemLoader.identifiedItems.has('ring_of_wisdom')).toBe(true); // 戒指走 identify() 全亮
        expect(left.identified).toBe(false);
        expect(left.charges).toBe(1);       // 恰好 -1
        expect(right.charges).toBe(0);
    });

    it('两枚同时归零：同块双双揭示（"只亮一只手"的实现必红）', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const left = ItemLoader.spawnRing('ring_of_awareness', -1, -1)!;
        const right = ItemLoader.spawnRing('ring_of_transference', -1, -1)!;
        game.player.inventory.addItem(left);
        game.player.inventory.addItem(right);
        game.player.equip(left);
        game.player.equip(right);
        left.charges = 1;
        right.charges = 1;

        (game as unknown as { processIncrementalAutoID(): void }).processIncrementalAutoID();

        expect(left.identified).toBe(true);
        expect(right.identified).toBe(true);
        expect(ItemLoader.identifiedItems.has('ring_of_awareness')).toBe(true);
        expect(ItemLoader.identifiedItems.has('ring_of_transference')).toBe(true);
    });
});

describe('R2: 戒指双槽随存档往返', () => {
    it('两枚戒指读档后各归各槽；状态（熟悉度计数）不串', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        const left = ItemLoader.spawnRing('ring_of_regeneration', -1, -1)!;
        const right = ItemLoader.spawnRing('ring_of_wisdom', -1, -1)!;
        game.player.inventory.addItem(left);
        game.player.inventory.addItem(right);
        game.player.equip(left);
        game.player.equip(right);
        left.charges = 1234;
        right.charges = 4321;

        game.loadSnapshot(JSON.parse(JSON.stringify(game.toSnapshot())));

        expect(game.player.ringLeft?.id).toBe(left.id);
        expect(game.player.ringRight?.id).toBe(right.id);
        expect(game.player.ringLeft?.charges).toBe(1234);
        expect(game.player.ringRight?.charges).toBe(4321);
    });
});

describe('X1: 挂起中的鉴定选择不跨场景', () => {
    it('读档与新局都复位 pendingIdentify', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        makeSword(game, 1);
        const scroll = ItemLoader.spawnScroll('scroll_of_identify', -1, -1)!;
        game.player.inventory.addItem(scroll);
        game.readItem(scroll);
        expect(game.pendingIdentify).toBe(true);

        // 读档复位
        game.loadSnapshot(JSON.parse(JSON.stringify(game.toSnapshot())));
        expect(game.pendingIdentify).toBe(false);

        // 新局复位
        (game as unknown as { pendingIdentify: boolean }).pendingIdentify = true;
        game.startNewGame({ seed: 9 });
        expect(game.pendingIdentify).toBe(false);
    });
});

describe('S1: RNG 流哨兵（任务书 §三：建在固定物品集上，对地图变化免疫）', () => {
    /**
     * 口径：以 `rng.randomNumbersGenerated`（只计 SUBSTANTIVE 流）的**增量**
     * 度量本轮拥有的全部路径——call、identify 待选/点选、实例揭示、
     * 序列化写侧、读档（恢复保存计数后自身不得消耗）。计数起点在物品手工构造
     * **之后**，因此增量与地图生成无关：C-6 改生成器、C-5 改地图都不动它，
     * 它只对"本轮的代码有没有多消耗掷骰"敏感。权威判据仍是
     * generation_baseline（生成期），本哨兵是交互期的补强。
     * 反向验证（B-1b 报告 RV6）：在 chooseIdentifyTarget 注入一次
     * randPercent 即翻红。
     */
    it('持久化 / call / 选择 / 揭示全链零掷骰消耗', () => {
        const game = createHeadlessGame(42, 'test');
        isolatePlayer(game);
        // —— 手工构造固定物品集（spawnWeapon/Armor 有掷骰，必须在计数起点前）——
        const sword = makeSword(game, 2);
        const potion = ItemLoader.spawnPotion('potion_of_life', -1, -1)!;   // 零掷骰
        game.player.inventory.addItem(potion);
        const ring = ItemLoader.spawnRing('ring_of_wisdom', -1, -1)!;       // 零掷骰
        game.player.inventory.addItem(ring);
        ring.charges = 1;

        // U02a: this sentinel measures zero consumption from a known zero origin.
        // Nonzero-position restoration is covered by u_02a_rng_snapshot.test.ts.
        rng.seedRandomGenerator(42);
    rng.resetCounters(); // U02b: the zero-origin fixture is explicit; reseeding preserves counts.
        const c0 = rng.randomNumbersGenerated;

        // call 全路径（起名 + 清除 + 拒绝）
        expect(game.callItem(potion, 'sentinel')).toBe(true);
        expect(game.callItem(potion, '')).toBe(true);
        // identify 待选 + 点选（不经 readItem——那会推进回合、混入怪物 AI 掷骰）
        expect((game as unknown as { beginIdentifySelection(): boolean }).beginIdentifySelection()).toBe(true);
        expect(game.chooseIdentifyTarget(sword)).toBe(true);
        // 揭示路径
        ItemLoader.identifyInstance(ring);
        expect(ItemLoader.decrementWornFamiliarity(game.player.ringLeft)).toBeNull(); // 已亮，无事发生
        // 持久化写侧
        const snap = JSON.parse(JSON.stringify(game.toSnapshot()));

        expect(rng.randomNumbersGenerated).toBe(c0); // ← 任何新增抽取在此翻红

        // 持久化读侧：恢复这里保存的零计数，且自身不得消耗 SUBSTANTIVE 掷骰
        game.loadSnapshot(snap);
        expect(rng.randomNumbersGenerated).toBe(0);
    });
});
