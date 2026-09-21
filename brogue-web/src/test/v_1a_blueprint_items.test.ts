/**
 * src/test/v_1a_blueprint_items.test.ts — V-1a：拆掉 `_random_good_` 直投
 *
 * 背景：`_random_good_`（web 自创类别：六选一保底好物，roll4 直投附魔卷轴、
 * roll5 直投 life 药水）在 CE 全源码零对应（V-0 grep 确认）。CE 的门厅机器
 * 零自产奖励、守卫机器（BP_ADOPT_ITEM）零自产物品；唯一的掩码物品路径是
 * 神祠 "Shrine -- safe haven…"（GlobalsBrogue.c:561-565）的
 * (POTION|SCROLL|WEAPON|ARMOR|RING)，经 pickItemCategory（Items.c:85-107，
 * itemGenerationProbabilities_Brogue 类别加权）+ 类内 chooseKind 基表频率
 * **两段抽取**落地——enchanting/life/strength 基频 0，永不出现。
 *
 * 本文件钉四件事：
 *   A. 结构：JSON 里不再有任何自创 itemCategory；10 台门厅/守卫机器零自产
 *      奖励 feature（CE 形态）；area_shrine 掩码逐字等于 CE 五类。
 *   B. 行为终点：整局（真实生成链）蓝图路径零直投、ench/life 双双下移
 *      （改造前后实测对比：ench 25.9→14.9/局、life 18.7→6.3/局，10 seed，
 *      见 V-1a 报告 §纯测量数据）。CE 参考量级：附魔卷轴约 12-15/局。
 *   C. 分布：掩码两段抽取按 itemGenerationProbabilities 加权，不是等概率、
 *      也不是"五类合成一张池子按 kind 数加权"。
 *   D. 哨兵（形态①增量）：掩码抽取 RNG 消耗恰 2 次（类别 1 + kind 1）——
 *      单池单次抽取的错误实现消耗 1，在此翻红。
 *
 * 反转预告：V-1b 引擎补机制（MF_ALTERNATIVE/资格过滤/配额）后，B 组的整局
 * 数字会再变（机器密度是独立放大器）；届时按实测平移本文件的带，不是放宽。
 * V-2 全表重写后 A 组的 10 机清单会被 CE 解题工具 feature 替换，届时按新
 * 数据改写 T2 的白名单。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHeadlessGame } from './harness';
import blueprintData from '../data/blueprints.json';
import type { BlueprintDef } from '../engine/Generator/BlueprintEngine';
import { rng } from '../engine/Random';
import { ItemCategory } from '../engine/Items/Item';
import { Game } from '../engine/Core/Game';
import type { Item } from '../engine/Items/Item';

const blueprints = blueprintData as BlueprintDef[];

/** CE 类别名全集（machineFeature.itemCategory 位掩码的合法组成段）。 */
const CE_CATEGORIES = new Set(['SCROLL', 'POTION', 'WEAPON', 'ARMOR', 'RING', 'KEY', 'FOOD', 'WAND', 'STAFF', 'CHARM', 'AMULET', 'GOLD', 'GEM']);

/** V-1a 删除直投 feature 的 10 台机器（4 门厅 + 6 守卫；key_rat_trap 的 KEY
 *  条目是锁具驱动的既有登记，不在本轮范围，单独豁免）。 */
const TEN_MACHINES = [
    'vestibule_locked', 'vestibule_flammable', 'vestibule_guardian', 'vestibule_pit_traps',
    'key_fire_trap', 'key_flood_trap', 'key_poison_gas', 'key_web_room', 'key_lava_moat', 'key_boss',
];

/** 整局测量口径与 b_4a/t_1 的 collectFullRun 完全一致（4 seed 控制门禁时长）。 */
const SEEDS = [1, 42, 123456, 654321];

type GameWithGen = Omit<Game, 'generateDepth'> & {
    generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void;
};

const NAME_TO_ID: Record<string, string> = {
    'Dagger': 'dagger', 'Sword': 'sword', 'Broadsword': 'broadsword', 'Whip': 'whip',
    'Rapier': 'rapier', 'Flail': 'flail', 'Mace': 'mace', 'War Hammer': 'war_hammer',
    'Spear': 'spear', 'War Pike': 'war_pike', 'Axe': 'axe', 'Halberd': 'halberd',
    'Dart': 'dart', 'War Axe': 'war_axe', 'Incendiary Dart': 'incendiary_dart', 'Javelin': 'javelin',
    'Leather Armor': 'leather_armor', 'Scale Mail': 'scale_mail', 'Chain Mail': 'chain_mail',
    'Banded Mail': 'banded_mail', 'Splint Mail': 'splint_mail', 'Plate Mail': 'plate_mail',
    'Iron Key': 'iron_key',
};

function identityOf(item: Item): string {
    const anyItem = item as unknown as { consumableId?: string; identityId?: string; name: string };
    const raw = anyItem.consumableId ?? anyItem.identityId ?? anyItem.name;
    return NAME_TO_ID[raw] ?? raw;
}

function collectFullRunWithBpInstrument(seed: number) {
    const game = createHeadlessGame(seed);
    const g = game as unknown as GameWithGen;
    const proto = Object.getPrototypeOf(game) as {
        spawnBlueprintItem: (this: Game, category: string, id: string | undefined, x: number, y: number, depth: number) => Item | null;
    };
    const orig = proto.spawnBlueprintItem;
    const bpIds: Record<string, number> = {};
    let randomGoodCalls = 0;
    proto.spawnBlueprintItem = function (this: Game, category: string, id: string | undefined, x: number, y: number, depth: number) {
        if (!id && category === '_random_good_') randomGoodCalls++;
        const r = orig.call(this, category, id, x, y, depth);
        if (r && !id) {
            const k = identityOf(r);
            bpIds[k] = (bpIds[k] ?? 0) + 1;
        }
        return r;
    };
    const all: Item[] = [];
    for (let d = 1; d <= 26; d++) {
        if (d > 1) { game.depth = d; g.generateDepth(false, false); }
        all.push(...game.items);
    }
    proto.spawnBlueprintItem = orig;
    const count = (id: string) => all.filter(i => identityOf(i) === id).length;
    return { ench: count('scroll_of_enchantment'), life: count('potion_of_life'), str: count('potion_of_strength'), bpIds, randomGoodCalls };
}

// ─────────────────────────────────────────────────────────────────────────────
// A. 结构钉
// ─────────────────────────────────────────────────────────────────────────────
describe('V-1a A：结构（数据形态）', () => {
    it('T1 墓碑：blueprints.json 不再含 _random_good_，全部 itemCategory 落在 CE 类别名集合内', () => {
        const json = readFileSync(new URL('../data/blueprints.json', import.meta.url), 'utf8');
        expect(json.includes('_random_good_'), 'blueprints.json 仍含 _random_good_（V-1a 拆除被回退？）').toBe(false);
        // 语义守卫：不管名字叫什么，任何不在 CE 类别名集合里的 itemCategory 都不得出现。
        // （防"改名回归"——形态改写绕不过这一条。）
        const offenders: string[] = [];
        for (const bp of blueprints) {
            for (const f of bp.features) {
                if (!f.itemCategory) continue;
                for (const seg of f.itemCategory.split('|').map(s => s.trim())) {
                    if (!CE_CATEGORIES.has(seg)) offenders.push(`${bp.id}: ${f.itemCategory}`);
                }
            }
        }
        expect(offenders, `自创 itemCategory：${offenders.join('; ')}`).toEqual([]);
        // Game.ts 侧墓碑：删除的 case 不得以任何字面量形式回流。
        const gameTs = readFileSync(new URL('../engine/Core/Game.ts', import.meta.url), 'utf8');
        expect(gameTs.includes('_random_good_'), 'Game.ts 仍含 _random_good_ 字面量').toBe(false);
    });

    it('T2（V-2a 反转）门厅/守卫机器零自产奖励 feature（key_poison_gas 按 V-2b-6 反转）；vestibule_locked 按 CE :300 恰一条 KEY 解题工具 feature', () => {
        // 原 T2 断言（V-1a 时）：「十台门厅/守卫机器全部零 itemCategory
        // feature」。V-2a 给 vestibule_locked 按 CE GlobalsBrogue.c:300 落地
        // {terrain: LOCKED_DOOR, itemCategory: KEY, MF_BUILD_AT_ORIGIN |
        // MF_OUTSOURCE_ITEM_TO_MACHINE …} 的钥匙外包 feature（本轮 2.2 的
        // 行为终点）——T2 的错误消息自预告「V-2 按 CE 全表重写时会以解题
        // 工具 feature 替代——届时改写本清单，不是放宽」，现按此反转：
        // 其余机器保持零自产奖励（越界守卫），vestibule_locked 改钉新事实。
        // **V-2b-6 反转**：key_poison_gas 按 CE GlobalsBrogue.c:436-444 重写
        // 为领养机器，其 SCROLL_TELEPORT / POTION_DESCENT 两条逃生工具
        // feature（CE :440/:441，MF_ALTERNATIVE 组）是 CE 原表数据、不是
        // 自产奖励——豁免越界守卫、单独正向钉死（见下方 T2b）。
        const offenders: string[] = [];
        for (const id of TEN_MACHINES) {
            if (id === 'vestibule_locked') continue; // V-2a 已反转，下方单独钉
            if (id === 'key_poison_gas') continue; // V-2b-6 已反转，下方 T2b 单独钉
            const bp = blueprints.find(b => b.id === id);
            if (!bp) { offenders.push(`${id}: 蓝图不存在`); continue; }
            for (const f of bp.features) {
                if (f.itemCategory !== undefined) offenders.push(`${id}: 带物品 feature ${f.itemCategory}`);
            }
        }
        expect(offenders, `V-1a 应为空奖励的机器仍有自产物：${offenders.join('; ')}`).toEqual([]);
        const locked = blueprints.find(b => b.id === 'vestibule_locked');
        const feats = locked?.features ?? [];
        expect(feats, 'vestibule_locked 应恰 1 条 feature（CE :300 的锁门+钥匙外包）').toHaveLength(1);
        const kf = feats[0]!;
        expect(kf.itemCategory, '解题工具必须是 KEY（非奖励类别）').toBe('KEY');
        expect(kf.terrain, 'CE :300 terrain 位 = LOCKED_DOOR').toBe('LOCKED_DOOR');
        expect(kf.flags, 'CE :300 flags 位缺旗标').toEqual(expect.arrayContaining([
            'MF_BUILD_AT_ORIGIN', 'MF_GENERATE_ITEM', 'MF_OUTSOURCE_ITEM_TO_MACHINE',
        ]));
    });

    it('T2b（V-2b-6）key_poison_gas 按 CE :436-444 重写：两条逃生工具 feature（SCROLL_TELEPORT / POTION_DESCENT，MF_ALTERNATIVE 组）', () => {
        // 越界守卫的反转面：key_poison_gas 的物品 feature 从"零"改为"恰这两
        // 条"。CE GlobalsBrogue.c:440/:441 原表——SCROLL_TELEPORT 与
        // POTION_DESCENT 各 {1,1}，MF_GENERATE_ITEM | MF_NOT_IN_HALLWAY |
        // MF_ALTERNATIVE（与 TRAP_DOOR_HIDDEN 三选一的逃生线）。多一条、
        // 少一条、旗标走样都红。
        const gas = blueprints.find(b => b.id === 'key_poison_gas');
        expect(gas).toBeDefined();
        const itemFeats = gas!.features.filter(f => f.itemCategory);
        expect(itemFeats, 'key_poison_gas 应恰 2 条物品 feature（CE :440/:441）').toHaveLength(2);
        const byId = new Map(itemFeats.map(f => [f.itemId, f]));
        expect(byId.get('scroll_of_teleportation')?.itemCategory).toBe('SCROLL');
        expect(byId.get('potion_of_descent')?.itemCategory).toBe('POTION');
        for (const f of itemFeats) {
            expect(f.instanceCount).toEqual([1, 1]);
            expect(f.flags).toEqual(expect.arrayContaining(['MF_GENERATE_ITEM', 'MF_NOT_IN_HALLWAY', 'MF_ALTERNATIVE']));
        }
    });

    it('T3 area_shrine 掩码逐字 = CE GlobalsBrogue.c:561-565 的五类，数量 {1,1}，走 MF_GENERATE_ITEM', () => {
        const shrine = blueprints.find(b => b.id === 'area_shrine');
        expect(shrine).toBeDefined();
        const itemFeat = shrine!.features.filter(f => f.itemCategory);
        expect(itemFeat.length, 'area_shrine 应恰 1 条物品 feature').toBe(1);
        expect(itemFeat[0]!.itemCategory, '掩码必须逐字等于 CE (POTION|SCROLL|WEAPON|ARMOR|RING)').toBe('POTION|SCROLL|WEAPON|ARMOR|RING');
        expect(itemFeat[0]!.instanceCount).toEqual([1, 1]);
        expect(itemFeat[0]!.flags).toContain('MF_GENERATE_ITEM');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. 行为终点（整局，真实生成链）
// ─────────────────────────────────────────────────────────────────────────────
describe('V-1a B：行为终点（整局下移）', () => {
    it('T4 蓝图路径零直投：整局无一次 _random_good_ 抽取、蓝图产出不含 enchanting/life/strength', () => {
        for (const seed of SEEDS) {
            const r = collectFullRunWithBpInstrument(seed);
            expect(r.randomGoodCalls, `seed${seed} 仍有 _random_good_ 抽取`).toBe(0);
            const offenders = Object.keys(r.bpIds).filter(k =>
                k === 'scroll_of_enchantment' || k === 'potion_of_life' || k === 'potion_of_strength');
            expect(offenders, `seed${seed} 蓝图路径直投了 ${offenders.join(',')}（基频 0 + 加权抽取下不可能，除非直投回流）`).toEqual([]);
        }
    });

    it('T5 整局 ench/life 下移带（V-1a 后实测 13-16 / 6-7，10 seed；带宽 ± 余量；CE 参考量级 12-15）', () => {
        // 上限挡直投回流（改造前 22-31 / 14-24，任何显著回流必破上限）；
        // 下限挡「计量路径被误伤」（populateItems 的 enchanting 计量是 CE 原生，
        // 正常 13-16/局——B-4a 建立的计量机制被改坏才会跌破）。
        for (const seed of SEEDS) {
            const r = collectFullRunWithBpInstrument(seed);
            expect(r.ench, `seed${seed} 附魔卷轴 ${r.ench}/局`).toBeGreaterThanOrEqual(8);
            expect(r.ench, `seed${seed} 附魔卷轴 ${r.ench}/局`).toBeLessThanOrEqual(20);
            expect(r.life, `seed${seed} life 药水 ${r.life}/局`).toBeGreaterThanOrEqual(2);
            expect(r.life, `seed${seed} life 药水 ${r.life}/局`).toBeLessThanOrEqual(12);
            // strength 与本轮无关（_random_good_ 从不产出它）：维持 b_4a 原带。
            expect(r.str, `seed${seed} strength 药水 ${r.str}/局`).toBeGreaterThanOrEqual(3);
            expect(r.str, `seed${seed} strength 药水 ${r.str}/局`).toBeLessThanOrEqual(16);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. 掩码两段抽取的分布与哨兵
// ─────────────────────────────────────────────────────────────────────────────
const SHRINE_MASK = 'POTION|SCROLL|WEAPON|ARMOR|RING';

function drawMaskCategory(n: number): Record<string, number> {
    const tally: Record<string, number> = {};
    rng.seedRandomGenerator(20260918);
    for (let i = 0; i < n; i++) {
        const item = (Game.prototype as unknown as {
            spawnBlueprintItem: (this: Game, c: string, id: undefined, x: number, y: number, d: number) => Item | null;
        }).spawnBlueprintItem.call(Object.create(Game.prototype) as Game, SHRINE_MASK, undefined, 0, 0, 10);
        if (item) {
            const k = ItemCategory[item.category] ?? `cat#${item.category}`;
            tally[k] = (tally[k] ?? 0) + 1;
        }
    }
    return tally;
}

describe('V-1a C：area_shrine 掩码 = CE pickItemCategory 两段加权（不是等概率/不是合成单池）', () => {
    it('T6 6000 次类别分布按 itemGenerationProbabilities（POTION52/SCROLL42/WEAPON10/ARMOR8/RING3），等概率实现必红', () => {
        const N = 6000;
        const tally = drawMaskCategory(N);
        // 期望份额与 ±6σ 二项带（σ=sqrt(p(1-p)/N)；带再外扩 1% 绝对余量容环境噪声）。
        const bands: Array<[string, number]> = [
            // weight/115
            ['POTION', 52 / 115], ['SCROLL', 42 / 115], ['WEAPON', 10 / 115], ['ARMOR', 8 / 115], ['RING', 3 / 115],
        ];
        for (const [cat, p] of bands) {
            const got = (tally[cat] ?? 0) / N;
            const sigma = Math.sqrt(p * (1 - p) / N);
            expect(got, `${cat} 份额 ${got.toFixed(4)}，期望 ${p.toFixed(4)}`).toBeGreaterThan(p - 6 * sigma - 0.01);
            expect(got, `${cat} 份额 ${got.toFixed(4)}，期望 ${p.toFixed(4)}`).toBeLessThan(p + 6 * sigma + 0.01);
        }
        // RING 槽被抽中时必须真的产出戒指（RING 分支接线生效，不是静默 null）。
        expect((tally['RING'] ?? 0), '6000 次里 RING 槽按权重应出现 ~130 次，0 次说明分支未接线').toBeGreaterThan(50);
    });

    it('T7 掩码抽取 RNG 消耗恰 2 次（CE pickItemCategory 1 + chooseKind 1）；单池单次抽取的错误实现消耗 1 必红', () => {
        // 只含「类内恰 1 掷」类别的掩码：无论类别抽中谁，总消耗恒 = 1 类别 + 1 kind。
        // （神祠全掩码含 WEAPON/ARMOR——其 CE 原生附魔模型会再掷骰，恰值断言只在
        // 本掩码下成立；神祠掩码的下界哨兵见下。）
        rng.seedRandomGenerator(99);
        const before = rng.randomNumbersGenerated;
        const item = (Game.prototype as unknown as {
            spawnBlueprintItem: (this: Game, c: string, id: undefined, x: number, y: number, d: number) => Item | null;
        }).spawnBlueprintItem.call(Object.create(Game.prototype) as Game, 'POTION|SCROLL|RING', undefined, 0, 0, 10);
        expect(item).not.toBeNull();
        expect(rng.randomNumbersGenerated - before, '掩码抽取必须恰消耗 2 次掷骰（类别+kind，CE 两段各 1）').toBe(2);
        // 神祠全掩码：下界 2（WEAPON/ARMOR 的附魔模型只会更多）——单池单次实现必<2。
        rng.seedRandomGenerator(99);
        const before2 = rng.randomNumbersGenerated;
        const item2 = (Game.prototype as unknown as {
            spawnBlueprintItem: (this: Game, c: string, id: undefined, x: number, y: number, d: number) => Item | null;
        }).spawnBlueprintItem.call(Object.create(Game.prototype) as Game, SHRINE_MASK, undefined, 0, 0, 10);
        expect(item2).not.toBeNull();
        expect(rng.randomNumbersGenerated - before2, '神祠掩码单次抽取消耗 <2：类别抽取那一掷丢了？').toBeGreaterThanOrEqual(2);
    });
});
