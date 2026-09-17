/**
 * src/test/b_4a_item_generation.test.ts — B-4a：物品生成规则对齐 CE（「生成什么」）
 *
 * 五件事的验收（对照 CE 权威出处）：
 *   1. 计量表 meteredItems（Items.c:569-580/577-579/674-686/700-716/740-752，
 *      表 variants/GlobalsBrogue.c:627-658）——附魔卷轴/life/strength 基表频率 0，
 *      只能靠计量频率被抽中；life 有阈值强制（genMultiplier=4/genIncrement=3/
 *      levelScaling=1）。
 *   2. 加权抽取（chooseKind Items.c:409-420；类别权重 GlobalsBrogue.c:109）——
 *      取代旧的 randRange(0,9) 等概率表。
 *   3. 附魔/符文模型（Items.c:237-263 武器 / 278-308 护甲）——40% 入附魔分支、
 *      诅咒各半、好符文走整数除法阈值、while(rand_percent(10)) 长尾。
 *   4. 投掷物「先掷后剥」（Items.c:265-274）——附魔分支照掷、结果事后抹掉；
 *      RNG 增量判据：投掷武器生成消耗 = 附魔分支消耗 + 恰 2 次（quantity+quiver），
 *      因此任何 seed 下 dart 的消耗 ≥ 3 且跨 seed 有变化（跳过附魔的错误实现
 *      恒消耗 2，在此翻红）。
 *   5. 缺失种类：war_axe / incendiary_dart / javelin 入表可生成；halberd 退池
 *      不再出现；dart 基表频率 0 不被随机抽中。
 *
 * 断言区间的来源：纯测量（10 seed × D1-D26 全层统计，见交付报告 §纯测量数据）。
 * 区间留出统计余量但不是摆设——对抗性反向验证（改坏生产代码）会真的打红它们。
 *
 * 哨兵纪律（任务书 §6.3）：本轮移动生成期 RNG 流，全部哨兵使用
 * ① rng.randomNumbersGenerated 增量、③ 性质断言（分布/区间/存在性），
 * 不锚定 RNG 流绝对位置。generation_baseline 的重捕获另行授权（见 fixture note）。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';
import type { Game } from '../engine/Core/Game';
import type { Item } from '../engine/Items/Item';
import consumablesJson from '../data/consumables.json';
import weaponsJson from '../data/weapons.json';

/** generateDepth 在 Game 上是 private：直接交叉会收缩成 never（TS2349 同款），
 *  用 Omit 摘掉私有成员再交叉（harness 的 GamePrivates 同款技巧）。 */
type GameWithGen = Omit<Game, 'generateDepth'> & {
    generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void;
};

/** 生成链测量种子（与交付报告的纯测量口径一致）。 */
const SEEDS = [1, 7, 42, 2024, 65537, 99991, 123456, 654321, 424242, 8675309];

const NAME_TO_ID: Record<string, string> = {
    'Dagger': 'dagger', 'Sword': 'sword', 'Broadsword': 'broadsword', 'Whip': 'whip',
    'Rapier': 'rapier', 'Flail': 'flail', 'Mace': 'mace', 'War Hammer': 'war_hammer',
    'Spear': 'spear', 'War Pike': 'war_pike', 'Axe': 'axe', 'Halberd': 'halberd',
    'Dart': 'dart', 'War Axe': 'war_axe', 'Incendiary Dart': 'incendiary_dart', 'Javelin': 'javelin',
    'Leather Armor': 'leather_armor', 'Scale Mail': 'scale_mail', 'Chain Mail': 'chain_mail',
    'Banded Mail': 'banded_mail', 'Splint Mail': 'splint_mail', 'Plate Mail': 'plate_mail',
    'Iron Key': 'iron_key',
};

/** 武器/护甲/钥匙无 consumableId/identityId，落显示名——归一成 json id。 */
function identityOf(item: Item): string {
    const anyItem = item as unknown as { consumableId?: string; identityId?: string; name: string };
    const raw = anyItem.consumableId ?? anyItem.identityId ?? anyItem.name;
    return NAME_TO_ID[raw] ?? raw;
}

/** 跑完整一局 D1→D26，逐层收集物品。 */
function collectFullRun(seed: number): Item[] {
    const game = createHeadlessGame(seed);
    const g = game as unknown as GameWithGen;
    const all: Item[] = [];
    for (let d = 1; d <= 26; d++) {
        if (d > 1) { game.depth = d; g.generateDepth(false, false); }
        all.push(...game.items);
    }
    return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1+3. 计量表：基表频率为 0 + 三条非零条目的 CE 原值 + memcpy 还原语义
// ─────────────────────────────────────────────────────────────────────────────
describe('B-4a 计量表：基表频率与 CE 表原值', () => {
    it('enchanting / life / strength 的基表（json）频率为 0，跑完一局后仍为 0（CE memcpy 还原语义）', () => {
        const potions = consumablesJson.potions as Array<{ id: string; frequency?: number }>;
        const scrolls = consumablesJson.scrolls as Array<{ id: string; frequency?: number }>;
        expect(scrolls.find(s => s.id === 'scroll_of_enchantment')?.frequency).toBe(0);
        expect(potions.find(p => p.id === 'potion_of_life')?.frequency).toBe(0);
        expect(potions.find(p => p.id === 'potion_of_strength')?.frequency).toBe(0);
        // CE populateItems 结尾把 potion/scroll 表 memcpy 还原——web 的等价不变量：
        // 生成过程不得把计量频率持久写回基表。跑一局后复核。
        collectFullRun(42);
        expect(scrolls.find(s => s.id === 'scroll_of_enchantment')?.frequency).toBe(0);
        expect(potions.find(p => p.id === 'potion_of_life')?.frequency).toBe(0);
        expect(potions.find(p => p.id === 'potion_of_strength')?.frequency).toBe(0);
    });

    it('CE_METERED_ITEMS_TABLE 30 条、顺序与 CE 对齐，三条非零条目为 CE 原值', () => {
        const table = ItemLoader.CE_METERED_ITEMS_TABLE;
        expect(table).toHaveLength(30);
        // 前卷轴后药水的拼接（Items.c:679-681 的 j < numberScrollKinds 分界）
        expect(ItemLoader.CE_NUMBER_SCROLL_KINDS).toBe(14);
        expect(table[0]).toMatchObject({ category: 'SCROLL', ceKind: 'SCROLL_ENCHANTING', webId: 'scroll_of_enchantment', initialFrequency: 60, incrementFrequency: 30, decrementFrequency: 50 });
        expect(table[14]).toMatchObject({ category: 'POTION', ceKind: 'POTION_LIFE', webId: 'potion_of_life', initialFrequency: 0, incrementFrequency: 34, decrementFrequency: 150, genMultiplier: 4, genIncrement: 3, levelScaling: 1 });
        expect(table[15]).toMatchObject({ category: 'POTION', ceKind: 'POTION_STRENGTH', webId: 'potion_of_strength', initialFrequency: 40, incrementFrequency: 17, decrementFrequency: 50 });
        // 其余 27 条必须是占位（increment=0），否则索引对齐被破坏
        const nonPlaceholder = table.filter(e => e.incrementFrequency !== 0);
        expect(nonPlaceholder).toHaveLength(3);
        // 唯一参与阈值强制的条目是 POTION_LIFE（levelScaling=1）
        expect(table.filter(e => e.levelScaling !== 0)).toHaveLength(1);
        expect(table.find(e => e.levelScaling !== 0)?.ceKind).toBe('POTION_LIFE');
    });

    it('计量状态随开局重置：新局的 initialFrequency 与 CE 一致（enchant 60 / life 0 / strength 40）', () => {
        const game = createHeadlessGame(7);
        const m = (game as unknown as { meteredItems: { frequency: number; numberSpawned: number }[] }).meteredItems;
        // startNewGame 会先 init 再生成 D1（+increment 后才生成物品）——开局后
        // D1 已加过一次 increment：60+30 / 0+34 / 40+17（CE initializeRogue→populateItems 次序）。
        expect(m[0]!.frequency).toBe(90);
        expect(m[14]!.frequency).toBe(34);
        expect(m[15]!.frequency).toBe(57);
        expect(m.every(x => x.numberSpawned >= 0)).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. 计量表·产物侧：附魔卷轴与 life/strength 的整局产出区间（纯测量定带）
// ─────────────────────────────────────────────────────────────────────────────
describe('B-4a 计量表·产物侧（区间来自 10-seed 纯测量，见报告）', () => {
    const results = new Map<number, Item[]>();
    const itemsOf = (seed: number): Item[] => {
        if (!results.has(seed)) results.set(seed, collectFullRun(seed));
        return results.get(seed)!;
    };
    const countOf = (seed: number, id: string): number =>
        itemsOf(seed).filter(i => identityOf(i) === id).length;

    it('附魔卷轴整局总数落在测量带内（测量 43-68/局；带宽余量 [30, 90]）', () => {
        for (const seed of SEEDS) {
            const n = countOf(seed, 'scroll_of_enchantment');
            expect(n, `seed${seed} 附魔卷轴 ${n} 张/局`).toBeGreaterThanOrEqual(30);
            expect(n, `seed${seed} 附魔卷轴 ${n} 张/局`).toBeLessThanOrEqual(90);
        }
        // 旧实现的等概率表给出 ~52/局且与计量无关；计量机制若失效（频率只涨不跌），
        // 产出会向 60+/局上漂并越过上限；若 increment/decrement 接反则会跌穿下限。
    });

    it('life 药水整局总数落在测量带内（测量 15-27/局；带宽余量 [9, 36]）', () => {
        for (const seed of SEEDS) {
            const n = countOf(seed, 'potion_of_life');
            expect(n, `seed${seed} life 药水 ${n} 只/局`).toBeGreaterThanOrEqual(9);
            expect(n, `seed${seed} life 药水 ${n} 只/局`).toBeLessThanOrEqual(36);
        }
    });

    it('strength 药水整局总数落在测量带内（测量 7-10/局；带宽余量 [3, 16]）', () => {
        for (const seed of SEEDS) {
            const n = countOf(seed, 'potion_of_strength');
            expect(n, `seed${seed} strength 药水 ${n} 只/局`).toBeGreaterThanOrEqual(3);
            expect(n, `seed${seed} strength 药水 ${n} 只/局`).toBeLessThanOrEqual(16);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. 阈值强制生成：numberSpawned*4+3 < depth 的层上必出 life（CE Items.c:702-709）
// ─────────────────────────────────────────────────────────────────────────────
describe('B-4a life 阈值强制生成', () => {
    it('每个 seed 在 D6 前必出现第一只 life（n=0 时 4*0+3 < d+offset 最迟 D6 恒真）', () => {
        for (const seed of SEEDS) {
            const game = createHeadlessGame(seed);
            const g = game as unknown as GameWithGen;
            let firstLifeDepth = -1;
            for (let d = 1; d <= 26; d++) {
                if (d > 1) { game.depth = d; g.generateDepth(false, false); }
                if (game.items.some(i => identityOf(i) === 'potion_of_life')) { firstLifeDepth = d; break; }
            }
            expect(firstLifeDepth, `seed${seed} 第一只 life 出现在 D${firstLifeDepth}`).toBeGreaterThanOrEqual(1);
            expect(firstLifeDepth, `seed${seed} 第一只 life 出现在 D${firstLifeDepth}，阈值强制应在 D6 前生效`)
                .toBeLessThanOrEqual(6);
        }
    });

    it('foodSpawned 公式的整数口径与 CE 一致：D1-D2 无保底，D3 起可触发（CE Items.c:685-691）', () => {
        // 纯函数复核：f=0 时 D1/D2 判据为假、D3 为真（offset=0 时）
        expect(ItemLoader.foodGuaranteeTriggered(0, 1, 0)).toBe(false);
        expect(ItemLoader.foodGuaranteeTriggered(0, 2, 0)).toBe(false);
        expect(ItemLoader.foodGuaranteeTriggered(0, 3, 0)).toBe(true);
        // offset=-2 时 D3 恰好不触发（三角分布下界的边界行为）
        expect(ItemLoader.foodGuaranteeTriggered(0, 3, -2)).toBe(false);
        expect(ItemLoader.foodGuaranteeTriggered(0, 3, -1)).toBe(true);
        // 有一只口粮（1800）后 D3 不触发：LHS=(1800+600)*4*2^16=629145600 > RHS(=233...M)
        expect(ItemLoader.foodGuaranteeTriggered(1800, 3, 0)).toBe(false);
    });

    it('整局食物产出落在测量带内（测量 9-13/局；带宽余量 [5, 18]）——食物保底在起作用', () => {
        for (const seed of [1, 42, 123456]) {
            const items = collectFullRun(seed);
            const n = items.filter(i => i.category === 4 /* FOOD */).length;
            expect(n, `seed${seed} 食物 ${n} 件/局`).toBeGreaterThanOrEqual(5);
            expect(n, `seed${seed} 食物 ${n} 件/局`).toBeLessThanOrEqual(18);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. 加权抽取：frequency=0 不被抽中；高频率显著高于低频率
// ─────────────────────────────────────────────────────────────────────────────
describe('B-4a 加权抽取（chooseKind，Items.c:409-420）', () => {
    it('dart 基表频率 0：在武器池上抽 20000 次一次都不出现（CE：飞镖不参与随机生成）', () => {
        const weapons = weaponsJson as Array<{ id: string; frequency?: number; excludeFromGeneration?: boolean }>;
        const pool = weapons.filter(w => !w.excludeFromGeneration);
        const ids = pool.map(w => w.id);
        const freqs = pool.map(w => w.frequency ?? 10);
        expect(freqs[ids.indexOf('dart')]).toBe(0);
        rng.seedRandomGenerator(20260917);
        for (let i = 0; i < 20000; i++) {
            expect(ids[ItemLoader.chooseKind(freqs)]).not.toBe('dart');
        }
    });

    it('telepathy(20) 的抽取次数约为 haste(10) 的两倍（统计带 1.4x-2.9x，20000 次）', () => {
        const potions = (consumablesJson.potions as Array<{ id: string; frequency?: number }>)
            .filter(p => p.id !== 'potion_of_healing'); // healing 自创退池，不在池内
        const ids = potions.map(p => p.id);
        const freqs = potions.map(p => p.frequency ?? 0);
        const iTele = ids.indexOf('potion_of_telepathy');
        const iHaste = ids.indexOf('potion_of_haste');
        expect(freqs[iTele]).toBe(20);
        expect(freqs[iHaste]).toBe(10);
        rng.seedRandomGenerator(314159);
        let tele = 0, haste = 0;
        for (let i = 0; i < 20000; i++) {
            const k = ids[ItemLoader.chooseKind(freqs)];
            if (k === 'potion_of_telepathy') tele++;
            if (k === 'potion_of_haste') haste++;
        }
        const ratio = tele / haste;
        expect(ratio, `telepathy/haste = ${tele}/${haste} = ${ratio.toFixed(2)}`).toBeGreaterThan(1.4);
        expect(ratio, `telepathy/haste = ${tele}/${haste} = ${ratio.toFixed(2)}`).toBeLessThan(2.9);
    });

    it('chooseKind 消耗恰 1 次随机数（CE rand_range(1, total) 一次）', () => {
        rng.seedRandomGenerator(271828);
        const before = rng.randomNumbersGenerated;
        ItemLoader.chooseKind([10, 0, 20, 5]);
        expect(rng.randomNumbersGenerated - before).toBe(1);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. 投掷物「先掷后剥」：产物侧 + RNG 增量侧
// ─────────────────────────────────────────────────────────────────────────────
describe('B-4a 投掷物：先掷后剥（Items.c:265-274）', () => {
    const THROWING = ['dart', 'incendiary_dart', 'javelin'] as const;

    it('产物侧：300 次生成恒 enchantment=0、无符文、不诅咒，quantity/quiver 在 CE 区间', () => {
        rng.seedRandomGenerator(60606);
        for (let i = 0; i < 100; i++) {
            for (const kind of THROWING) {
                const w = ItemLoader.spawnWeapon(kind, 0, 0)!;
                expect(w.enchantment, `${kind} 附魔必须被剥为 0`).toBe(0);
                expect(w.runicType, `${kind} 不得带符文`).toBeUndefined();
                expect(w.isCursed, `${kind} 不得诅咒`).toBe(false);
                if (kind === 'incendiary_dart') {
                    expect(w.quantity).toBeGreaterThanOrEqual(3);
                    expect(w.quantity).toBeLessThanOrEqual(6);
                } else {
                    expect(w.quantity).toBeGreaterThanOrEqual(5);
                    expect(w.quantity).toBeLessThanOrEqual(18);
                }
                expect(w.quiverNumber ?? 0).toBeGreaterThanOrEqual(1);
                expect(w.quiverNumber ?? 0).toBeLessThanOrEqual(60000);
                expect(w.charges).toBe(ItemLoader.WEAPON_KILLS_TO_AUTO_ID);
            }
        }
    });

    it('RNG 增量侧（对抗①的判据）：50 个 seed 下 dart 消耗恒 ≥3 且跨 seed 有变化——跳过附魔分支的错误实现恒消耗 2', () => {
        const costs: number[] = [];
        for (let s = 0; s < 50; s++) {
            rng.seedRandomGenerator(80_000 + s * 13);
            const before = rng.randomNumbersGenerated;
            ItemLoader.spawnWeapon('dart', 0, 0);
            costs.push(rng.randomNumbersGenerated - before);
        }
        expect(Math.min(...costs), `最小消耗 ${Math.min(...costs)}（先掷后剥 = 附魔分支至少 1 掷 + quantity + quiver = ≥3）`).toBeGreaterThanOrEqual(3);
        expect(new Set(costs).size, `50 个 seed 的消耗种类数 ${new Set(costs).size}（附魔分支被掷过则必然有涨落）`).toBeGreaterThan(1);
    });

    it('RNG 增量侧：javelin / incendiary_dart 同口径（各 30 个 seed，min ≥3）', () => {
        for (const kind of ['javelin', 'incendiary_dart'] as const) {
            const costs: number[] = [];
            for (let s = 0; s < 30; s++) {
                rng.seedRandomGenerator(90_000 + s * 17);
                const before = rng.randomNumbersGenerated;
                ItemLoader.spawnWeapon(kind, 0, 0);
                costs.push(rng.randomNumbersGenerated - before);
            }
            expect(Math.min(...costs), `${kind} 最小消耗`).toBeGreaterThanOrEqual(3);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. 附魔/符文模型（武器 Items.c:237-263 / 护甲 278-308）
// ─────────────────────────────────────────────────────────────────────────────
describe('B-4a 附魔模型（CE 40% 分支 / 诅咒各半 / 长尾）', () => {
    interface W { id: string; name: string; strengthRequired: number; damage: string; weight: number; flags?: string[]; excludeFromGeneration?: boolean }

    it('非投掷武器：有附魔占比 ≈40%（带 [0.34, 0.48]），其中诅咒 ≈一半（带 [0.40, 0.60]）', () => {
        const weapons = (weaponsJson as unknown as W[]).filter(w => !w.excludeFromGeneration
            && !['dart', 'incendiary_dart', 'javelin'].includes(w.id));
        let n = 0, ench = 0, cursed = 0;
        for (let s = 0; s < 12; s++) {
            rng.seedRandomGenerator(40_000 + s * 331);
            for (const w of weapons) {
                for (let i = 0; i < 25; i++) {
                    const it = ItemLoader.spawnWeapon(w.id, 0, 0)!;
                    n++;
                    if (it.enchantment !== 0) { ench++; if (it.isCursed) cursed++; }
                }
            }
        }
        const enchRate = ench / n;
        const cursedRate = cursed / ench;
        expect(enchRate, `附魔率 ${ench}/${n} = ${(enchRate * 100).toFixed(1)}%`).toBeGreaterThan(0.34);
        expect(enchRate).toBeLessThan(0.48);
        expect(cursedRate, `诅咒占附魔比 ${cursed}/${ench} = ${(cursedRate * 100).toFixed(1)}%`).toBeGreaterThan(0.40);
        expect(cursedRate).toBeLessThan(0.60);
    });

    it('长尾存在：9000 次武器生成中出现 +4 及以上（while(rand_percent(10)) 无上界）', () => {
        const weapons = (weaponsJson as unknown as W[]).filter(w => !w.excludeFromGeneration
            && !['dart', 'incendiary_dart', 'javelin'].includes(w.id));
        let maxEnch = 0;
        for (let s = 0; s < 12; s++) {
            rng.seedRandomGenerator(50_000 + s * 353);
            for (const w of weapons) {
                for (let i = 0; i < 25; i++) {
                    const it = ItemLoader.spawnWeapon(w.id, 0, 0)!;
                    if (it.enchantment > maxEnch) maxEnch = it.enchantment;
                }
            }
        }
        expect(maxEnch, `9000 次生成的最大附魔 +${maxEnch}（CE 长尾应出现过 +4）`).toBeGreaterThanOrEqual(4);
    });

    it('护甲：leather 符文率 ≈11.8%（0.4×0.5×65/96×7/8，CE rand_range(0,95)>armor×10）、plate 恒 0（110 恒失败且坏符文段全未实现）', () => {
        rng.seedRandomGenerator(77_007);
        const byKind = new Map<string, { n: number; runic: number }>();
        for (let s = 0; s < 8; s++) {
            rng.seedRandomGenerator(60_000 + s * 97);
            for (const a of ItemLoader.armors) {
                const stat = byKind.get(a.id) ?? { n: 0, runic: 0 };
                for (let i = 0; i < 50; i++) {
                    const it = ItemLoader.spawnArmor(a.id, 0, 0)!;
                    stat.n++;
                    if (it.runicType) stat.runic++;
                }
                byKind.set(a.id, stat);
            }
        }
        const leather = byKind.get('leather_armor')!;
        const plate = byKind.get('plate_mail')!;
        const leatherRate = leather.runic / leather.n;
        const plateRate = plate.runic / plate.n;
        // CE：rand_range(0,95) > armor*10 → leather(30)≈68%、plate(110)=0%
        // 但 plate 的诅咒坏符文段也全映射为 null（登记的目录缺口），故 plate 应接近 0
        expect(leatherRate, `leather 符文率 ${(leatherRate * 100).toFixed(1)}%（理论 0.4×0.5×65/96×7/8 ≈ 11.8%）`).toBeGreaterThan(0.07);
        expect(plateRate, `plate 符文率 ${(plateRate * 100).toFixed(1)}%（armor=110 时 rand_range(0,95) 恒失败，坏符文段全为未实现种类）`).toBeLessThan(0.05);
        // 护甲的附魔率与武器同源（40% 分支）
        let n = 0, ench = 0;
        for (let s = 0; s < 8; s++) {
            rng.seedRandomGenerator(61_000 + s * 101);
            for (const a of ItemLoader.armors) {
                for (let i = 0; i < 50; i++) {
                    const it = ItemLoader.spawnArmor(a.id, 0, 0)!;
                    n++;
                    if (it.enchantment !== 0) ench++;
                }
            }
        }
        const rate = ench / n;
        expect(rate, `护甲附魔率 ${(rate * 100).toFixed(1)}%`).toBeGreaterThan(0.34);
        expect(rate).toBeLessThan(0.48);
    });

    it('W_SLAYING 武器携带 vorpalEnemy、A_IMMUNITY 护甲携带 vorpalEnemy（chooseVorpalEnemy 已接线）', () => {
        rng.seedRandomGenerator(88_888);
        let slayingSeen = 0, immunitySeen = 0;
        for (let i = 0; i < 1500 && (slayingSeen < 3 || immunitySeen < 3); i++) {
            const w = ItemLoader.spawnWeapon('dagger', 0, 0, 5)!;
            if (w.runicType === 'slaying') {
                slayingSeen++;
                expect(w.vorpalEnemy, 'W_SLAYING 必须写入 vorpalEnemy（CE Items.c:257-259）').toBeDefined();
            }
            const a = ItemLoader.spawnArmor('leather_armor', 0, 0, 5)!;
            if (a.runicType === 'immunity') {
                immunitySeen++;
                expect(a.vorpalEnemy, 'A_IMMUNITY 必须写入 vorpalEnemy（CE Items.c:302-304）').toBeDefined();
            }
        }
        expect(slayingSeen, '1500 次内应出现 ≥3 把 slaying（好符文 1/8 × 附魔率）').toBeGreaterThanOrEqual(3);
        expect(immunitySeen, '1500 次内应出现 ≥3 件 immunity').toBeGreaterThanOrEqual(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. 新增种类可生成 / halberd 退池 / dart 不泛滥
// ─────────────────────────────────────────────────────────────────────────────
describe('B-4a 缺失种类与退池', () => {
    it('war_axe / incendiary_dart / javelin 在整局生成中出现（10 seed 合计 ≥8 件）', () => {
        let total = 0;
        for (const seed of SEEDS) {
            for (const item of collectFullRun(seed)) {
                const id = identityOf(item);
                if (id === 'war_axe' || id === 'incendiary_dart' || id === 'javelin') total++;
            }
        }
        expect(total, `三种新武器 10 局合计 ${total} 件（测量值 29）`).toBeGreaterThanOrEqual(8);
    });

    it('halberd 整局生成 0 出现（D2 退池维持）', () => {
        for (const seed of [1, 42, 123456]) {
            for (const item of collectFullRun(seed)) {
                expect(identityOf(item), `seed${seed} 撞见退池武器 halberd`).not.toBe('halberd');
            }
        }
    });

    it('dart 在整局随机生成中几乎不出现（基表频率 0；仅机器等概率路径偶得，10 局 ≤12 把）', () => {
        let total = 0;
        for (const seed of SEEDS) {
            for (const item of collectFullRun(seed)) {
                if (identityOf(item) === 'dart') total++;
            }
        }
        expect(total, `10 局 dart 合计 ${total} 把（旧实现 ~每局 1 把吃附魔；CE 机制下仅机器路径偶得）`).toBeLessThanOrEqual(12);
    });

    it('potion_of_poison（CE caustic gas）整局生成中出现——B-4a 回池的直接产物', () => {
        let total = 0;
        for (const seed of [1, 42, 123456, 2024, 65537]) {
            for (const item of collectFullRun(seed)) {
                if (identityOf(item) === 'potion_of_poison') total++;
            }
        }
        expect(total, `5 局 poison 药水合计 ${total} 只（frequency=15，不应为 0）`).toBeGreaterThan(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// 哨兵：同 seed 双跑物品多重集一致（性质断言，不锚定绝对位置）
// ─────────────────────────────────────────────────────────────────────────────
describe('B-4a 哨兵：生成链确定性', () => {
    it('同 seed 两次 D1-D5 的物品多重集一致（无未播种/乱序泄漏）', () => {
        const run = (seed: number): string => {
            const game = createHeadlessGame(seed);
            const g = game as unknown as GameWithGen;
            const names: string[] = [];
            for (let d = 1; d <= 5; d++) {
                if (d > 1) { game.depth = d; g.generateDepth(false, false); }
                names.push(...game.items.map(i => `${identityOf(i)}@${i.loc.x},${i.loc.y}`).sort());
            }
            return names.join('|');
        };
        expect(run(20260917)).toBe(run(20260917));
    });
});
