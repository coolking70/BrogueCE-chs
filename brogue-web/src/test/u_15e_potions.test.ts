import { beforeAll, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { createHeadlessGame } from './harness';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { GasType } from '../engine/Environment/Gas';
import { DungeonLayer } from '../engine/Map/Grid';
import { rng } from '../engine/Random';

beforeAll(() => {
    if (!i18next.isInitialized) i18next.init({ lng: 'en', fallbackLng: false, resources: {}, initImmediate: false });
});

function give(game: ReturnType<typeof createHeadlessGame>, id: string) {
    const item = ItemLoader.spawnPotion(id, -1, -1)!;
    game.player.inventory.addItem(item);
    return item;
}

describe('U15e CE potion semantics', () => {
    it('life increases maximum HP, heals, and applies the CE panacea list', () => {
        const game = createHeadlessGame(42, 'test');
        const item = give(game, 'potion_of_life');
        const oldMax = game.player.maxHp;
        game.player.hp = 1;
        game.player.setStatusDuration('hallucinating', 80);
        game.player.setStatusDuration('confused', 80);
        game.player.setStatusDuration('nauseous', 80);
        game.player.setStatusDuration('poisoned', 80);
        game.player.setStatusDuration('darkness', 80);
        game.player.weaken(80);
        game.quaffItem(item);
        expect(game.player.maxHp).toBe(oldMax + 10);
        expect(game.player.hp).toBe(game.player.maxHp);
        for (const status of ['hallucinating', 'confused', 'nauseous'] as const) {
            expect(game.player.getStatusDuration(status)).toBeLessThanOrEqual(1);
        }
        expect(game.player.hasStatus('poisoned')).toBe(false);
        expect(game.player.hasStatus('darkness')).toBe(false);
        expect(game.player.weaknessAmount).toBe(0);
    });

    it('confusion uncorking creates gas without directly granting hallucination', () => {
        const game = createHeadlessGame(43, 'test');
        const item = give(game, 'potion_of_confusion');
        game.quaffItem(item);
        expect(game.player.hasStatus('hallucinating')).toBe(false);
        expect(game.grid.getCell(game.player.loc.x, game.player.loc.y)?.layers[DungeonLayer.GAS]).toBe(GasType.CONFUSION);
    });

    it('known darkness is confirmable and cancellation preserves item and RNG', () => {
        const game = createHeadlessGame(44, 'test');
        const item = give(game, 'potion_of_darkness');
        ItemLoader.identifiedItems.add('potion_of_darkness');
        const before = rng.getState();
        game.quaffItem(item);
        expect(game.player.inventory.items).toContain(item);
        expect(rng.getState()).toEqual(before);
        game.cancelPendingUse();
        expect(game.player.inventory.items).toContain(item);
        expect(rng.getState()).toEqual(before);
        game.quaffItem(item, true);
        expect(game.player.getStatusDuration('darkness')).toBeGreaterThan(0);
        expect(game.player.maxStatus.darkness).toBe(400);
    });

    it('fixed CE durations and lichen retirement leave generation entries stable', () => {
        const durations = [
            ['potion_of_hallucination', 'hallucinating', 300],
            ['potion_of_invisibility', 'invisible', 75],
            ['potion_of_levitation', 'levitating', 100],
            ['potion_of_telepathy', 'telepathy', 300],
            ['potion_of_haste', 'haste', 25],
        ] as const;
        for (const [id, status, duration] of durations) {
            const game = createHeadlessGame(45, 'test');
            game.quaffItem(give(game, id));
            expect(game.player.getStatusDuration(status)).toBeGreaterThan(0);
            expect(game.player.maxStatus[status]).toBe(duration);
        }
        expect(ItemLoader.genPotions.some(p => p.id === 'potion_of_darkness')).toBe(false);
        expect(ItemLoader.potions.find(p => p.id === 'potion_of_creeping_death')?.frequency).toBe(7);
    });
});
