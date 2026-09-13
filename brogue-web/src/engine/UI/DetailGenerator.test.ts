/**
 * src/engine/UI/DetailGenerator.test.ts — 详情面板伤害显示回归
 *
 * 武器伤害改为 1dN+M 记法后，DetailGenerator 本地 parseDamage（不认 +Z
 * 后缀）把面板区间显示错。修复后统一复用 CombatSystem.parseDamageString。
 * 本文件锁定：
 *   1. 三件开局相关武器的基础伤害区间：1d5+15→16~20、1d11+24→25~35、1d2+2→3~4；
 *   2. item.damage / monster.damageString 为 undefined 时不得抛异常。
 */
import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import { Item, ItemCategory } from '../Items/Item';
import { Monster } from '../../entities/Monster';
import { generateItemDetail, generateMonsterDetail, type DetailInfo } from './DetailGenerator';

// 与 src/test/harness.ts 相同的最小 i18n 初始化（幂等），供 Monster 构造器 translateName 使用
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

function baseDamageLine(damage: string): string {
    const item = new Item('Test Weapon', '(', 0xffffff, ItemCategory.WEAPON);
    item.damage = damage;
    const line = allLines(generateItemDetail(item, 12)).find((t) => t.startsWith('基础伤害:'));
    if (!line) throw new Error('详情面板中未找到基础伤害行');
    return line;
}

describe('详情面板基础伤害区间（1dN+M 记法）', () => {
    it.each([
        ['1d5+15', '16', '20'], // mace
        ['1d11+24', '25', '35'], // war hammer
        ['1d2+2', '3', '4'], // dagger
    ])('%s → 面板显示 %s~%s', (damage, lo, hi) => {
        expect(baseDamageLine(damage)).toBe(`基础伤害: ${damage} (${lo}~${hi})`);
    });
});

describe('damage 缺失时详情面板不抛异常', () => {
    it('item.damage 为 undefined：不抛异常且无伤害行', () => {
        const item = new Item('Bare Weapon', '(', 0xffffff, ItemCategory.WEAPON);
        let detail: DetailInfo;
        expect(() => { detail = generateItemDetail(item, 12); }).not.toThrow();
        // 既有行为：WEAPON 类别的"武器属性"段恒创建，但不含任何伤害行
        const weaponSection = detail!.sections.find((s) => s.header === '武器属性');
        expect(weaponSection).toBeDefined();
        expect(weaponSection!.lines.filter((l) => l.text.includes('伤害'))).toHaveLength(0);
    });

    it('monster.damageString 为 undefined：跳过战斗分析中的伤害行', () => {
        const monster = new Monster(1, 1, {
            id: 'test_monster',
            name: 'Test Monster',
            char: 'T',
            color: 0xffffff,
            hp: 10,
            damage: undefined as unknown as string,
            minDepth: 1,
            maxDepth: 99,
            goldDropChance: 0,
            itemDropChance: 0,
        });
        let detail: DetailInfo;
        expect(() => {
            detail = generateMonsterDetail(monster, 50, 12, 2, null, 0, 12);
        }).not.toThrow();
        expect(detail!.sections.find((s) => s.header === '战斗分析')).toBeDefined();
    });
});
