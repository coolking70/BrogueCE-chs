/**
 * src/engine/Core/startingKit.test.ts — 开局装备对齐回归（CE RogueMain.c:420-443）
 *
 * CE 开局发放：口粮 ×1 → 匕首（已鉴定+已装备）→ 飞镖 ×15（已鉴定+不装备）
 * → 皮甲（已鉴定+已装备），发放顺序影响全局 rng 消耗顺序（回放系统依赖）。
 * 本项目 Item 模型中武器/护甲无独立"已鉴定"标志：附魔/诅咒恒可见，
 * runicKnown 是唯一物侧标记 —— 故"已鉴定"断言为 runicKnown === true。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from '../../test/harness';
import { ItemCategory, type Item } from '../Items/Item';
import type { Game } from './Game';

interface StartingKit {
    ration: Item;
    dagger: Item;
    dart: Item;
    leather: Item;
}

function findStartingKit(game: Game): StartingKit | null {
    const inv = game.player.inventory.items;
    const ration = inv.find(i => i.category === ItemCategory.FOOD);
    const dagger = inv.find(i => i.category === ItemCategory.WEAPON && i.name === 'Dagger');
    const dart = inv.find(i => i.category === ItemCategory.WEAPON && i.name === 'Dart');
    const leather = inv.find(i => i.category === ItemCategory.ARMOR);
    if (!ration || !dagger || !dart || !leather) return null;
    return { ration, dagger, dart, leather };
}

describe('开局装备对齐 CE（RogueMain.c:420-443）', () => {
    it('normal 模式：背包含口粮/匕首/飞镖/皮甲，且发放顺序与 CE 一致', () => {
        const game = createHeadlessGame(20260914);
        const inv = game.player.inventory.items;
        const kit = findStartingKit(game);
        expect(kit).not.toBeNull();

        const found = kit!;
        const idx = (item: Item) => inv.indexOf(item);
        // 口粮 → 匕首 → 飞镖 → 皮甲（顺序影响 rng 消耗顺序）
        expect(idx(found.ration)).toBeLessThan(idx(found.dagger));
        expect(idx(found.dagger)).toBeLessThan(idx(found.dart));
        expect(idx(found.dart)).toBeLessThan(idx(found.leather));
    });

    it('匕首与皮甲：已装备、enchantment=0、无诅咒、已鉴定（runicKnown）', () => {
        const game = createHeadlessGame(20260914);
        const kit = findStartingKit(game)!;
        const { dagger, leather } = kit;

        expect(game.player.equippedWeapon).toBe(dagger);
        expect(game.player.equippedArmor).toBe(leather);

        for (const item of [dagger, leather]) {
            expect(item.isCursed).toBe(false);
            expect(item.enchantment).toBe(0);
            expect(item.runicType).toBeUndefined();
            expect(item.runicKnown).toBe(true);
        }
    });

    it('飞镖：数量 15、已鉴定、无诅咒、不装备', () => {
        const game = createHeadlessGame(20260914);
        const kit = findStartingKit(game)!;

        expect(kit.dart.quantity).toBe(15);
        expect(kit.dart.isCursed).toBe(false);
        expect(kit.dart.enchantment).toBe(0);
        expect(kit.dart.runicType).toBeUndefined();
        expect(kit.dart.runicKnown).toBe(true);
        expect(game.player.equippedWeapon).not.toBe(kit.dart);
        // 口粮 quantity 恒为默认 1
        expect(kit.ration.quantity).toBe(1);
    });

    it.each(['easy', 'wizard'] as const)('%s 模式：同样发放开局套件，maxHp/strength 覆盖保持不变', (mode) => {
        const game = createHeadlessGame(20260914, mode);
        expect(findStartingKit(game)).not.toBeNull();
        expect(game.player.equippedWeapon?.name).toBe('Dagger');
        expect(game.player.equippedArmor?.name).toBe('Leather Armor');

        if (mode === 'easy') {
            expect(game.player.maxHp).toBe(45);
            expect(game.player.strength).toBe(14);
        } else {
            expect(game.player.maxHp).toBe(999);
            expect(game.player.strength).toBe(18);
        }
    });
});
