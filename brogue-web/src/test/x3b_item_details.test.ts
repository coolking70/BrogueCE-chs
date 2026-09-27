import { describe, expect, it } from 'vitest';
import { createHeadlessGame } from './harness';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { generateItemDetail } from '../engine/UI/DetailGenerator';
import { enchantedDamage, netEnchant } from '../engine/Combat/CombatFormulas';
import { CombatSystem } from '../engine/Combat/Combat';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';

describe('X3b actual strength requirement in item details', () => {
    it.each([0, 10, 12, 15, undefined])('uses combat damage endpoints for requirement %s', requirement => {
        const g = createHeadlessGame(22013, 'test');
        const item = ItemLoader.spawnWeapon('dagger', -1, -1)!;
        item.enchantment = 12; item.strengthRequired = requirement; item.identified = true;
        const lines = generateItemDetail(item, 12).sections.flatMap(s => s.lines.map(l => l.text));
        const enchant = netEnchant(12, 12, requirement ?? 0);
        const low = Math.max(1, enchantedDamage(3, enchant)), high = Math.max(1, enchantedDamage(4, enchant));
        expect(lines).toContain(`实际伤害: ${low}~${high} (附魔 +12)`);
        if (requirement === 0) {
            expect([low, high]).toEqual([7, 10]);
            expect(lines).toContain('力量需求: 0 (你的力量: 12, 盈余)');
        }
        expect(g.player.effectiveStrength).toBe(12);
    });

    it.each([0, 10, undefined])('does not expose unknown enchantment or runes for requirement %s', requirement => {
        createHeadlessGame(22013, 'test');
        const item = ItemLoader.spawnWeapon('dagger', -1, -1)!;
        item.enchantment = 12; item.strengthRequired = requirement;
        item.identified = false; item.runicType = 'slaying'; item.runicKnown = false;
        const lines = generateItemDetail(item, 12).sections.flatMap(s => s.lines.map(l => l.text));
        expect(lines.some(l => l.includes('实际伤害') || l.includes('+12') || l.includes('slaying'))).toBe(false);
        expect(lines).toContain('基础伤害: 1d2+2 (3~4)');
    });

    it.each([0, 12])('shows strength bonuses even at enchantment %s and matches real melee endpoints', enchantment => {
        const g = createHeadlessGame(22013, 'test');
        const item = ItemLoader.spawnWeapon('dagger', -1, -1)!;
        item.enchantment = enchantment; item.strengthRequired = 0; item.identified = true; item.runicType = undefined;
        g.player.equippedWeapon = item;
        const detail = generateItemDetail(item, g.player.effectiveStrength).sections.flatMap(s => s.lines.map(l => l.text));
        const hits = [3, 4].map(endpoint => {
            const target = new Monster(14, 10, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
            target.state = MonsterState.HUNTING; target.isCaged = true; target.hp = target.maxHp = 100;
            item.damage = `${endpoint}d1`;
            const result = CombatSystem.attack(g.player, target);
            expect(result.hit).toBe(true); expect(result.backstab).toBe(false);
            return result.damage;
        });
        expect(detail).toContain(`实际伤害: ${hits[0]}~${hits[1]} (附魔 ${enchantment ? '+' : ''}${enchantment})`);
    });

    it.each([0, 10, undefined])('uses the same strength inputs for armor requirement %s without leaking unknown values', requirement => {
        createHeadlessGame(22013, 'test');
        const item = ItemLoader.spawnArmor('leather_armor', -1, -1)!;
        item.enchantment = 12; item.strengthRequired = requirement; item.identified = true;
        const lines = () => generateItemDetail(item, 12).sections.flatMap(s => s.lines.map(l => l.text));
        const expected = item.armor! + netEnchant(12, 12, requirement ?? 0);
        expect(lines().some(l => l.startsWith(`实际防御值: ${expected} (`))).toBe(true);
        if (requirement === 0) expect(lines()).toContain('力量需求: 0 (你的力量: 12, 盈余)');
        item.identified = false;
        expect(lines().some(l => l.includes('实际防御值') || l.includes('+12'))).toBe(false);
    });
});
