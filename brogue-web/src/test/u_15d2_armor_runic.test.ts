import { describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Item, ItemCategory } from '../engine/Items/Item';
import { Monster, type MonsterData } from '../entities/Monster';
import { rng } from '../engine/Random';
import { armorImageCount } from '../engine/Combat/CombatFormulas';
import monsterData from '../data/monsters.json';

function scene(runic: string, enchant = 3) {
    const game = createHeadlessGame(1512);
    const armor = new Item('armor', ']', 0xffffff, ItemCategory.ARMOR);
    armor.runicType = runic;
    armor.enchantment = enchant;
    armor.strengthRequired = game.player.effectiveStrength;
    game.player.equippedArmor = armor;
    const rat = new Monster(game.player.x + 1, game.player.y, (monsterData as MonsterData[]).find(m => m.id === 'rat')!);
    rat.hp = rat.maxHp = 100;
    game.monsters = [rat];
    return { game, armor, rat };
}

describe('U15d-2 CE armor runics', () => {
    it('armor image count follows PowerTables.c:108', () => {
        expect([0, 3, 9, 30].map(armorImageCount)).toEqual([1, 1, 3, 5]);
    });

    it('multiplicity consumes one 33% roll and makes three short lived spectral allies at enchant 9', () => {
        const { game, armor, rat } = scene('multiplicity', 9);
        const roll = vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        game.tryTriggerArmorRunic(rat, 8, true, true);
        expect(roll).toHaveBeenCalledExactlyOnceWith(33);
        const images = game.monsters.filter(m => m.typeId === 'spectral_image');
        expect(images).toHaveLength(3);
        for (const image of images) {
            expect([image.isAlly, image.boundToPlayer, image.hp, image.maxHp,
                image.getStatusDuration('lifespan_remaining'), image.ticksUntilTurn]).toEqual([true, true, 1, 1, 3, 100]);
            expect(image.diesIfNegated()).toBe(true);
        }
        (game as any).negateCreatureMagic(images[0]);
        expect(images[0]!.hp).toBe(0);
        expect(armor.runicKnown).toBe(true);
        roll.mockRestore();
    });

    it('immunity only protects the selected class; vulnerability doubles damage without RNG', () => {
        const { game, armor, rat } = scene('immunity');
        const roll = vi.spyOn(rng, 'randPercent');
        armor.vorpalEnemy = 'dragon';
        expect(game.tryTriggerArmorRunic(rat, 12, true)).toBe(12);
        expect(armor.runicKnown).toBe(false);
        armor.vorpalEnemy = 'animal';
        expect(game.tryTriggerArmorRunic(rat, 12, true)).toBe(0);
        expect(armor.runicKnown).toBe(true);
        armor.runicType = 'vulnerability';
        expect(game.tryTriggerArmorRunic(rat, 12, true)).toBe(24);
        expect(roll).not.toHaveBeenCalled();
        roll.mockRestore();
    });

    it('burden adds one permanent strength requirement only on its 10% roll', () => {
        const { game, armor, rat } = scene('burden');
        const original = armor.strengthRequired!;
        const roll = vi.spyOn(rng, 'randPercent').mockReturnValueOnce(false).mockReturnValueOnce(true);
        game.tryTriggerArmorRunic(rat, 6, true);
        expect(armor.strengthRequired).toBe(original);
        game.tryTriggerArmorRunic(rat, 6, true);
        expect(armor.strengthRequired).toBe(original + 1);
        expect(roll.mock.calls).toEqual([[10], [10]]);
        roll.mockRestore();
    });

    it('burden and target class survive the existing U01 snapshot contract', () => {
        const { game, armor, rat } = scene('burden');
        const roll = vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        game.tryTriggerArmorRunic(rat, 6, true);
        roll.mockRestore();
        armor.vorpalEnemy = 'animal';
        const saved = JSON.parse(JSON.stringify(game.toSnapshot()));
        expect(game.loadSnapshot(saved)).toBe(true);
        expect(game.player.equippedArmor?.runicType).toBe('burden');
        expect(game.player.equippedArmor?.runicKnown).toBe(true);
        expect(game.player.equippedArmor?.vorpalEnemy).toBe('animal');
        expect(game.player.equippedArmor?.strengthRequired).toBe(armor.strengthRequired);
    });

    it('immolation uses one 10% roll per hit and identifies only on a fire burst', () => {
        const { game, armor, rat } = scene('immolation');
        const roll = vi.spyOn(rng, 'randPercent').mockReturnValueOnce(false).mockReturnValueOnce(true);
        expect(game.tryTriggerArmorRunic(rat, 6, true)).toBe(6);
        expect(armor.runicKnown).toBe(false);
        expect(game.tryTriggerArmorRunic(rat, 6, true)).toBe(6);
        expect(armor.runicKnown).toBe(true);
        // The successful burst also consumes DF propagation rolls.
        expect(roll.mock.calls.slice(0, 2)).toEqual([[10], [10]]);
        roll.mockRestore();
    });

    it('thrown attack skips melee only effects while absorption still rolls', () => {
        const { game, armor, rat } = scene('multiplicity');
        const percent = vi.spyOn(rng, 'randPercent');
        expect(game.tryTriggerArmorRunic(rat, 7, true, false)).toBe(7);
        expect(percent).not.toHaveBeenCalled();
        armor.runicType = 'absorption';
        const range = vi.spyOn(rng, 'randRange').mockReturnValue(2);
        expect(game.tryTriggerArmorRunic(rat, 7, true, false)).toBe(5);
        expect(range).toHaveBeenCalledExactlyOnceWith(1, 3);
        range.mockRestore(); percent.mockRestore();
    });
});
