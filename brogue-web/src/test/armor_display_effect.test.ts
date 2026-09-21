/**
 * src/test/armor_display_effect.test.ts — 展示层护甲口径对齐 CE 加法防御模型
 * （P1-11 的展示层收尾）。
 *
 * 修复前展示层是旧"乘法减伤"口径：
 *   1. generateItemDetail 用 round(armor * 1.065^netEnchant) 显示"实际护甲值"；
 *   2. generateMonsterDetail 用调用方传入的 armor 显示值（皮甲=3）当防御算
 *      "命中你的概率"——CE 加法模型下实战防御是 (armor+netEnchant)*10（×10
 *      内部标度），面板长期低估被命中概率（96% vs 真值 68%）。
 *
 * 修复后：
 *   1. 物品详情显示"实际防御值 = armor + netEnchant"（显示值口径，非 ×10）；
 *   2. 怪物详情在 DetailGenerator 内部用 armor 三元组调用 playerDefense()，
 *      与 Combat.ts attack() 的玩家受击分支完全同源（含无甲→0、
 *      strengthRequired 缺省 || 0 两个口径）。
 *
 * 核心断言：面板显示值 === hitProbability(monsterAccuracy, playerDefense(...))，
 * 即展示与实战必须同源。
 */
import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import { Item, ItemCategory } from '../engine/Items/Item';
import { Monster } from '../entities/Monster';
import { generateItemDetail, generateMonsterDetail, type DetailInfo } from '../engine/UI/DetailGenerator';
import { hitProbability, netEnchant, playerDefense } from '../engine/Combat/CombatFormulas';
import { createHeadlessGame } from './harness';
import type { Game } from '../engine/Core/Game';
import { TerrainType } from '../engine/Map/Grid';

// 与 src/engine/UI/DetailGenerator.test.ts 相同的最小 i18n 初始化（幂等），
// 供 Monster 构造器 translateName 使用
if (!i18next.isInitialized) {
    i18next.init({
        lng: 'en',
        fallbackLng: false,
        resources: {},
        initImmediate: false,
    });
}

function allLines(detail: DetailInfo): string[] {
    return detail.sections.flatMap((s) => s.lines.map((l) => l.text));
}

function findLine(detail: DetailInfo, prefix: string): string | undefined {
    return allLines(detail).find((t) => t.startsWith(prefix));
}

// ─── 1. 物品详情：实际防御值 = armor + netEnchant（显示值口径） ───

function makeArmor(armor: number, enchantment: number, strengthRequired: number): Item {
    const item = new Item('Test Armor', '[', 0xffffff, ItemCategory.ARMOR);
    item.armor = armor;
    item.enchantment = enchantment;
    item.strengthRequired = strengthRequired;
    return item;
}

/** 旧乘法口径（修复前公式），仅用于文档性对照断言。 */
function legacyDisplayArmor(baseArmor: number, enchantment: number, playerStrength: number, requiredStrength: number): number {
    return Math.round(baseArmor * Math.pow(1.065, netEnchant(enchantment, playerStrength, requiredStrength)));
}

describe('物品详情护甲值 = armor + netEnchant（显示值口径，CE 加法模型）', () => {
    // (armor, enchantment, strength, strengthRequired)；strength 缺口按
    // 盈余 +0.25/点、不足 -2.5/点进入 netEnchant
    const CASES = [
        { label: '皮甲+0 力量恰好（净附魔 0）', armor: 3, ench: 0, strength: 10, strReq: 10 },
        { label: '皮甲+2 力量恰好', armor: 3, ench: 2, strength: 10, strReq: 10 },
        { label: '板甲+3 力量恰好', armor: 11, ench: 3, strength: 19, strReq: 19 },
        { label: '板甲-2 力量不足 1（净附魔 -4.5）', armor: 11, ench: -2, strength: 18, strReq: 19 },
        { label: '皮甲+1 力量盈余 2（净附魔 +1.5）', armor: 3, ench: 1, strength: 12, strReq: 10 },
        { label: '鳞甲-2 力量恰好', armor: 4, ench: -2, strength: 12, strReq: 12 },
        { label: '皮甲-3 力量恰好（钳到 0）', armor: 3, ench: -3, strength: 10, strReq: 10 },
    ];

    it.each(CASES)('%s', ({ armor, ench, strength, strReq }) => {
        const detail = generateItemDetail(makeArmor(armor, ench, strReq), strength);
        const expected = armor + netEnchant(ench, strength, strReq);

        const effText = findLine(detail, '实际防御值:');
        let displayed: number;
        if (netEnchant(ench, strength, strReq) !== 0 || ench !== 0) {
            // 有净修正：必须出现"实际防御值"行，且为加法口径
            if (!effText) throw new Error('详情面板中未找到实际防御值行');
            displayed = parseFloat(effText.replace('实际防御值: ', ''));
        } else {
            // 无净修正：基础行即 armor + 0
            const baseText = findLine(detail, '基础防御值:');
            if (!baseText) throw new Error('详情面板中未找到基础防御值行');
            displayed = parseFloat(baseText.replace('基础防御值: ', ''));
        }
        expect(displayed).toBeCloseTo(expected, 9);
    });

    it('不再显示旧乘法口径的数值（皮甲+2：旧 3 ≠ 新 5）', () => {
        const detail = generateItemDetail(makeArmor(3, 2, 10), 10);
        const effText = findLine(detail, '实际防御值:');
        if (!effText) throw new Error('详情面板中未找到实际防御值行');
        const displayed = parseFloat(effText.replace('实际防御值: ', ''));
        expect(displayed).not.toBe(legacyDisplayArmor(3, 2, 10, 10));
        expect(displayed).toBe(5);
        expect(effText).toContain('净附魔 +2');
    });
});

// ─── 2. 怪物详情：面板命中率与实战同源 ───
// 实战真值 = Combat.ts attack() 玩家受击分支：无甲（armor falsy）→ 防御 0；
// 有甲 → playerDefense(armor, enchant, strength, strReq||0)，×10 内部标度。

interface Tier {
    label: string;
    base: number | null; // armors.json 显示值口径；null = 不穿甲
    ench: number;
    strReq: number;
    strength: number;
}
const TIERS: Tier[] = [
    { label: '无甲', base: null, ench: 0, strReq: 0, strength: 12 },
    { label: '皮甲+0（力=需=10）', base: 3, ench: 0, strReq: 10, strength: 10 },
    { label: '板甲+3（11+3=14，力=需=19）', base: 11, ench: 3, strReq: 19, strength: 19 },
    { label: '皮甲+0 力量盈余（力12>需10，防御 35）', base: 3, ench: 0, strReq: 10, strength: 12 },
    { label: '板甲-2 力量不足（净附魔 -9.5，防御 15）', base: 11, ench: -2, strReq: 19, strength: 16 },
];

/** 与 Combat.ts:73-81 相同的防御语义（测试侧真值）。 */
function combatPlayerDefense(tier: Tier): number {
    return tier.base !== null && tier.base > 0
        ? playerDefense(tier.base, tier.ench, tier.strength, tier.strReq)
        : 0;
}

function makeMonster(accuracy: number): Monster {
    return new Monster(1, 1, {
        id: 'test_monster',
        name: 'Test Monster',
        char: 'T',
        color: 0xffffff,
        hp: 10,
        damage: '1d3',
        accuracy,
        minDepth: 1,
        maxDepth: 99,
        goldDropChance: 0,
        itemDropChance: 0,
    });
}

function panelHitProb(tier: Tier, accuracy: number): number {
    const detail = generateMonsterDetail(
        makeMonster(accuracy),
        50,
        tier.strength,
        0, // 已废弃占位参数
        null,
        0,
        12,
        tier.base ?? 0,
        tier.ench,
        tier.strReq
    );
    const text = findLine(detail, '该怪物有');
    if (!text) throw new Error('详情面板中未找到命中率行');
    const m = text.match(/该怪物有 (\d+)% 的概率命中你/);
    if (!m) throw new Error(`命中率行格式不符: ${text}`);
    return parseInt(m[1]!, 10);
}

describe('怪物详情命中率 === hitProbability(acc, playerDefense(...))（展示与实战同源）', () => {
    it.each(TIERS)('%s', (tier) => {
        for (const accuracy of [70, 100]) {
            const truth = hitProbability(accuracy, combatPlayerDefense(tier));
            expect(panelHitProb(tier, accuracy)).toBe(truth);
        }
    });

    it('旧口径（把显示值直接当防御）与真值必然不同——锁定本次修复', () => {
        for (const tier of TIERS) {
            if (tier.base === null) continue;
            const oldPanel = hitProbability(100, tier.base);
            expect(panelHitProb(tier, 100)).not.toBe(oldPanel);
        }
    });
});

// ─── 3. Game 接线：handleInspectAt 传参（无甲→0、皮甲+0→68） ───

const DIRS8: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
];

function inspectAdjacentMonster(game: Game): DetailInfo {
    const px = game.player.loc.x;
    const py = game.player.loc.y;
    game.monsters.splice(0);
    for (const [dx, dy] of DIRS8) {
        const x = px + dx;
        const y = py + dy;
        const cell = game.grid.getCell(x, y);
        if (!cell) continue;
        game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        cell.isVisible = true;
    }
    for (const [dx, dy] of DIRS8) {
        const x = px + dx;
        const y = py + dy;
        if (!game.grid.getCell(x, y)) continue;
        const monster = new Monster(x, y, {
            id: 'wired_monster',
            name: 'Wired Monster',
            char: 'W',
            color: 0xffffff,
            hp: 10,
            damage: '1d3',
            accuracy: 100,
            minDepth: 1,
            maxDepth: 99,
            goldDropChance: 0,
            itemDropChance: 0,
        });
        game.monsters.push(monster);
        game.handleInspectAt(x, y);
        if (!game.inspectTarget) throw new Error('handleInspectAt 未生成详情面板');
        return game.inspectTarget;
    }
    throw new Error('玩家相邻无图内格，无法布置测试怪物');
}

describe('Game.handleInspectAt 接线：面板命中率与 playerDefense 同源', () => {
    const SEED = 20260914;

    it('无甲：面板命中率 = hitProbability(100, 0) = 100%', () => {
        const game = createHeadlessGame(SEED);
        game.player.equippedArmor = null;
        const text = findLine(inspectAdjacentMonster(game), '该怪物有');
        expect(text).toBe(`该怪物有 ${hitProbability(100, 0)}% 的概率命中你。`);
    });

    it('皮甲+0（力10）：面板命中率 = hitProbability(100, playerDefense(3,0,10,10))', () => {
        const game = createHeadlessGame(SEED);
        game.player.strength = 10;
        game.player.equippedArmor = makeArmor(3, 0, 10);
        const truth = hitProbability(100, playerDefense(3, 0, 10, 10));
        const text = findLine(inspectAdjacentMonster(game), '该怪物有');
        expect(text).toBe(`该怪物有 ${truth}% 的概率命中你。`);
        // 修复前面板显示 hitProbability(100, 3) = 96%，真值 68%
        expect(truth).not.toBe(hitProbability(100, 3));
    });
});
