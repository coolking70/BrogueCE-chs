import { describe, expect, it } from 'vitest';
import { createHeadlessGame } from './harness';
import { ItemCategory } from '../engine/Items/Item';
import { TerrainType } from '../engine/Map/Grid';
import blueprintData from '../data/blueprints.json';

const inventedItems = new Set([
    'halberd', 'wand_of_fire', 'wand_of_lightning', 'scroll_of_amnesia',
    'potion_of_healing', 'staff_of_light',
]);
const inventedRunics = new Set(['venom', 'vampirism', 'vitality']);
const inventedBlueprints = new Set([
    'reward_library', 'reward_consumables', 'vestibule_flammable',
    'vestibule_guardian', 'vestibule_pit_traps', 'key_rat_trap',
    'key_fire_trap', 'key_flood_trap', 'key_web_room', 'key_lava_moat', 'key_boss',
]);

describe('X2h public test mode reachability', () => {
    it('menu mode payload descends every exhibit, permits pickup, and exposes no invented identity, runic, or blueprint', () => {
        // MainMenu emits { mode: 'test' }; App.startNewGame passes this payload to Game.
        const game = createHeadlessGame(424242, 'test');
        const seenCategories = new Set<string>();
        const seenRunics = new Set<string>();
        const seenItems = new Set<string>();
        let pickedUp = 0;

        for (let depth = 1; depth <= 40; depth++) {
            expect(game.depth).toBe(depth);
            const category = game.currentTestCategory!;
            seenCategories.add(category);
            expect(game.testRooms.size, `D${depth} ${category}: empty exhibit`).toBeGreaterThan(0);

            const allItems = [
                ...game.items,
                ...game.player.inventory.items,
                ...[...game.testRooms.values()].flatMap(room => room.baselineItems),
            ];
            for (const item of allItems) {
                const identity = item.consumableId ?? item.identityId;
                if (identity) {
                    seenItems.add(identity);
                    expect(inventedItems.has(identity), `D${depth}: ${identity}`).toBe(false);
                }
                if (item.runicType) {
                    seenRunics.add(item.runicType);
                    expect(inventedRunics.has(item.runicType), `D${depth}: ${item.runicType}`).toBe(false);
                }
            }

            if (category === 'blueprints') {
                const ids = [...game.testRooms.values()].map(room => room.blueprintId);
                for (const id of ids) {
                    expect(id, `D${depth}: missing blueprint identity`).toBeDefined();
                    expect(inventedBlueprints.has(id!), `D${depth}: ${id}`).toBe(false);
                    expect(blueprintData.find(bp => bp.id === id)?.ceBlueprintId, `D${depth}: ${id}`).not.toBeNull();
                }
                expect(ids.length).toBe(48); // Room grid capacity; later CE entries are not displayed.
            }

            // Use the real pickup action on each item exhibit; the item then becomes player content.
            if (game.items.length && pickedUp < 5) {
                const item = game.items[0]!;
                game.player.loc = { ...item.loc };
                game.handlePlayerAction('pickup', undefined, 'system');
                expect(game.player.inventory.items).toContain(item);
                pickedUp++;
            }

            game.player.loc = { x: 5, y: 3 };
            expect(game.grid.getCell(5, 3)?.layers).toContain(TerrainType.STAIRS_DOWN);
            game.handlePlayerAction('stairs_down', undefined, 'system');
        }

        expect(seenCategories).toEqual(new Set([
            'weapons', 'wands', 'scrolls', 'potions', 'other',
            'terrain', 'enemies', 'blueprints', 'runics',
        ]));
        expect(seenItems.has('dagger')).toBe(true);
        expect(seenItems.has('potion_of_life')).toBe(true);
        expect(seenItems.has('potion_of_darkness')).toBe(true);
        expect(seenRunics.has('paralyzing')).toBe(true);
        expect(seenRunics.has('reflection')).toBe(true);
        expect(pickedUp).toBe(5);
        expect(game.player.inventory.items.some(item => item.category === ItemCategory.WAND)).toBe(true);
    });
});
