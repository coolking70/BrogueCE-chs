import { describe, expect, it, vi } from 'vitest';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { charmEffectDuration, charmHealing, charmProtection, charmRechargeDelay } from '../engine/Items/CharmModel';
import { enchantArcana } from '../engine/Items/ArcanaEnchantment';
import { createHeadlessGame } from './harness';
import { timeSystem } from '../engine/Systems/Time';
import { serializeItem, deserializeItem } from '../engine/Core/EntitySnapshot';

describe('U15c CE charm table and use', () => {
    it('uses CE fixed-point golden values at multiple enchantments', () => {
        expect([1, 2, 5].map(e => charmRechargeDelay('charm_of_health', e))).toEqual([1377, 759, 128]);
        expect([1, 2, 5].map(e => charmRechargeDelay('charm_of_protection', e))).toEqual([619, 379, 97]);
        expect([1, 2, 5].map(e => charmRechargeDelay('charm_of_speed', e))).toEqual([527, 347, 109]);
        expect([1, 2, 5].map(e => charmRechargeDelay('charm_of_fire_immunity', e))).toEqual([491, 302, 92]);
        expect([1, 2, 5].map(e => charmRechargeDelay('charm_of_invisibility', e))).toEqual([524, 344, 104]);
        expect([1, 2, 5].map(e => charmRechargeDelay('charm_of_telepathy', e))).toEqual([550, 376, 168]);
        expect([1, 2, 5].map(e => charmEffectDuration('charm_of_speed', e))).toEqual([8, 10, 17]);
        expect([1, 2, 5].map(e => charmEffectDuration('charm_of_fire_immunity', e))).toEqual([12, 15, 30]);
        expect([1, 2, 5].map(charmHealing)).toEqual([20, 40, 100]);
        expect([1, 2, 5].map(charmProtection)).toEqual([150, 202, 498]);
    });

    it('applies the six CE effects, charges even at full health, and rejects charging attempts', () => {
        for (const id of ItemLoader.charms.map(c => c.id)) {
            const game = createHeadlessGame(42, 'test');
            const charm = ItemLoader.spawnCharm(id, -1, -1)!;
            charm.enchantment = 2;
            game.player.inventory.addItem(charm);
            vi.spyOn(game as any, 'playerTurnEnded').mockImplementation(() => undefined);
            game.player.hp = game.player.maxHp;
            const beforeTick = timeSystem.currentTick;
            game.useArcanaItem(charm);
            expect(charm.cooldownRemaining, id).toBe(charmRechargeDelay(id as Parameters<typeof charmRechargeDelay>[0], 2));
            if (id === 'charm_of_protection') expect(game.player.getStatusDuration('shielded')).toBe(202);
            if (id === 'charm_of_speed') {
                expect(game.player.getStatusDuration('hasted')).toBe(10);
                expect(game.player.getStatusDuration('levitating')).toBe(0);
                expect(timeSystem.currentTick - beforeTick).toBe(50);
            }
            if (id === 'charm_of_telepathy') expect(game.player.getStatusDuration('telepathy')).toBe(39);
            if (id === 'charm_of_fire_immunity') expect(game.player.getStatusDuration('immune_fire')).toBe(15);
            if (id === 'charm_of_invisibility') expect(game.player.getStatusDuration('invisible')).toBe(7);
            game.useArcanaItem(charm);
            expect(charm.cooldownRemaining).toBe(charmRechargeDelay(id as Parameters<typeof charmRechargeDelay>[0], 2));
            vi.restoreAllMocks();
        }
    });

    it('enchanting recharges an active charm and increases its CE curve', () => {
        const charm = ItemLoader.spawnCharm('charm_of_health', 0, 0)!;
        charm.enchantment = 1;
        charm.cooldownRemaining = 90;
        expect(enchantArcana(charm)).toBe(true);
        expect([charm.enchantment, charm.cooldownRemaining]).toEqual([2, 0]);
    });

    it('round trips the CE charm instance (no legacy-save migration, per project decision)', () => {
        const charm = ItemLoader.spawnCharm('charm_of_health', 0, 0)!;
        charm.enchantment = 5;
        charm.cooldownRemaining = 47;
        expect(deserializeItem(serializeItem(charm))).toMatchObject({
            enchantment: 5, cooldownRemaining: 47, arcanaInstanceVersion: 2,
        });
    });
});
