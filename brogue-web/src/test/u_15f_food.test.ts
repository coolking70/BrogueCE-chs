import { describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { ItemCategory } from '../engine/Items/Item';
import { rng } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import { logger } from '../engine/Systems/Logger';

function foodGame() {
    const game = createHeadlessGame(1515, 'test');
    game.player.inventory.items = game.player.inventory.items.filter(i => i.category !== ItemCategory.FOOD);
    return game;
}

describe('U15f CE food path', () => {
    it('asks before eating when capacity is insufficient; rejection changes no item, time, or RNG', () => {
        const game = foodGame();
        const ration = ItemLoader.spawnFood('ration_of_food', -1, -1)!;
        game.player.inventory.addItem(ration);
        game.player.nutrition = 351; // free capacity 1799 < ration power 1800
        const confirm = vi.fn((_message: string) => false);
        game.onConfirmRequest = confirm;
        const before = [game.player.nutrition, game.stats.turns, timeSystem.currentTick, rng.randomNumbersGenerated];
        game.eatItem(ration);
        expect(confirm).toHaveBeenCalledOnce();
        expect(confirm.mock.calls[0]?.[0]).toContain('food');
        expect(game.player.inventory.items).toContain(ration);
        expect([game.player.nutrition, game.stats.turns, timeSystem.currentTick, rng.randomNumbersGenerated]).toEqual(before);

        game.onConfirmRequest = () => true;
        game.eatItem(ration);
        expect(game.player.inventory.items).not.toContain(ration);
        expect(game.player.nutrition).toBe(2149);
    });

    it('eats without a prompt at exact capacity and uses mango power', () => {
        const game = foodGame();
        const mango = ItemLoader.spawnFood('mango', -1, -1)!;
        game.player.inventory.addItem(mango);
        game.player.nutrition = 600; // free capacity exactly 1550
        const confirm = vi.fn(() => false);
        game.onConfirmRequest = confirm;
        game.eatItem(mango);
        expect(confirm).not.toHaveBeenCalled();
        expect(game.player.inventory.items).not.toContain(mango);
        expect(game.player.nutrition).toBe(2149);
    });

    it('automatically eats the first food in pack order before starvation damage', () => {
        const game = foodGame();
        const mango = ItemLoader.spawnFood('mango', -1, -1)!;
        const ration = ItemLoader.spawnFood('ration_of_food', -1, -1)!;
        game.player.inventory.addItem(mango);
        game.player.inventory.addItem(ration);
        game.player.nutrition = 2;
        const hp = game.player.hp;
        const confirm = vi.fn(() => false);
        game.onConfirmRequest = confirm;
        game.handlePlayerAction('wait', undefined, 'system');
        expect(confirm).not.toHaveBeenCalled();
        expect(game.player.inventory.items).not.toContain(mango);
        expect(game.player.inventory.items).toContain(ration);
        expect(game.player.nutrition).toBeGreaterThan(1500);
        expect(game.player.hp).toBe(hp);
        expect(game.stats.turns).toBe(2); // nested CE playerTurnEnded plus the initiating wait
        expect(logger.messages.some(m => m.text.includes('Unable to control your hunger'))).toBe(true);
    });

    it('with no food, reaches starvation and takes damage', () => {
        const game = foodGame();
        game.player.nutrition = 2;
        const hp = game.player.hp;
        game.handlePlayerAction('wait', undefined, 'system');
        expect(game.player.nutrition).toBe(0);
        expect(game.player.hp).toBe(hp - 1);
    });
});
