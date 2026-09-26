import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHeadlessGame } from './harness';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Inventory } from '../engine/Items/Inventory';
import { Game } from '../engine/Core/Game';
import { endgameScore, lumenstoneCount } from '../engine/Core/Endgame';
import { readHighScores } from '../engine/Core/HighScores';
import { rng } from '../engine/Random';
import { TerrainType as T, Grid } from '../engine/Map/Grid';
import { DEEPEST_LEVEL, applyLoopDoorSites } from '../engine/Map/LoopMap';
import { dungeonDescentPercent } from '../engine/Generator/Architect';
import { generationDistances } from '../engine/Generator/GenerationPlacement';
import { cellTerrainFlags } from '../engine/Map/DungeonFeature';
import { T_PATHING_BLOCKER, T_OBSTRUCTS_ITEMS } from '../engine/Map/TerrainCatalog';
import { minersLightBaseRadiusFixpt, minersLightColorAtDepth, updateMinersLightRadius } from '../engine/Map/LightCatalog';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const distribution = [3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1];
const gems = (g: Game) => g.items.filter(i => i.category === ItemCategory.GEM);
function terminal(g: Game, type: T) {
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++)
        if (g.grid.getCell(x, y)!.layers.includes(type)) return { x, y };
    throw Error(`Missing ${T[type]} on D${g.depth}`);
}

describe('U26a CE deep-level contracts', () => {
    it('matches the CE 26/40 constants and all fourteen lumenstone quotas', () => {
        const ce = readFileSync('../BrogueCE-master/src/variants/GlobalsBrogue.c', 'utf8');
        expect(ce).toMatch(/#define AMULET_LEVEL\s+26/);
        expect(ce).toMatch(/#define DEEPEST_LEVEL\s+40/);
        const literal = ce.match(/lumenstoneDistribution_Brogue[^=]+=\s*\{([^}]+)\}/)![1]!;
        expect(literal.split(',').map(Number)).toEqual(distribution);
        expect(ItemLoader.CE_LUMENSTONE_DISTRIBUTION).toEqual(distribution);
        expect(distribution.reduce((a, b) => a + b)).toBe(25);
        expect(DEEPEST_LEVEL).toBe(40);
        expect([26, 27, 40].map(dungeonDescentPercent)).toEqual([100, 100, 100]);
    });

    it('D26 and D39 retain doors; D40 consumes the door roll but places floor', () => {
        const roll = vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        for (const depth of [26, 27, 39, 40]) {
            const grid = new Grid(10, 10);
            grid.setTerrain(5, 5, T.FLOOR);
            applyLoopDoorSites(grid, [{ x: 5, y: 5 }], depth);
            expect(grid.getCell(5, 5)!.terrain).toBe(depth < 40 ? T.DOOR : T.FLOOR);
        }
        expect(roll.mock.calls).toEqual([[60], [60], [60], [60]]);
    });

    it('real movement can swim across a deep-water connection between dry rooms', () => {
        const g: any = createHeadlessGame(26, 'test');
        g.monsters = []; g.dormantMonsters = []; g.items = [];
        g.grid.setTerrain(5, 5, T.FLOOR); g.grid.setTerrain(6, 5, T.WATER_DEEP); g.grid.setTerrain(7, 5, T.FLOOR);
        g.player.loc = { x: 5, y: 5 };
        g.handlePlayerAction('move', { x: 1, y: 0 });
        expect(g.player.loc).toEqual({ x: 6, y: 5 });
        g.handlePlayerAction('move', { x: 1, y: 0 });
        expect(g.player.loc).toEqual({ x: 7, y: 5 });
    });

    it('a real levitation potion permits movement across lava and chasm without falling', () => {
        const g: any = createHeadlessGame(26, 'test');
        g.monsters = []; g.dormantMonsters = []; g.items = [];
        g.grid.setTerrain(5, 5, T.FLOOR); g.grid.setTerrain(6, 5, T.LAVA); g.grid.setTerrain(7, 5, T.CHASM);
        g.grid.setTerrain(8, 5, T.FLOOR); g.player.loc = { x: 5, y: 5 };
        const potion = ItemLoader.spawnPotion('potion_of_levitation', 0, 0)!;
        g.player.inventory.addItem(potion); g.executeItemCommand('quaff', potion);
        expect(g.player.hasStatus('levitating')).toBe(true);
        const hp = g.player.hp, depth = g.depth;
        for (let x = 6; x <= 8; x++) {
            g.handlePlayerAction('move', { x: 1, y: 0 });
            expect(g.player.loc).toEqual({ x, y: 5 });
            expect(g.player.hp).toBe(hp); expect(g.depth).toBe(depth);
        }
    });

    it('GEM birth is identified, single, depth-tagged and consumes neither RNG stream', () => {
        createHeadlessGame(26, 'test');
        const before = rng.getState();
        const gem = ItemLoader.spawnGem(37, 5, 6);
        expect(gem).toMatchObject({ category: ItemCategory.GEM, identityId: 'lumenstone', quantity: 1,
            originDepth: 37, identified: true, canBeIdentified: false, loc: { x: 5, y: 6 } });
        expect(gem.displayName).toContain('37');
        expect(ItemLoader.itemMagicPolarity(gem)).toBe(0);
        expect(rng.getState()).toEqual(before);
        expect(ItemLoader.CE_ITEM_GENERATION_PROBABILITIES.find(p => p.category === ItemCategory.GEM)?.weight).toBe(0);
    });

    it('food has priority, then gems bypass metered guarantees and ordinary category draws', () => {
        const g: any = createHeadlessGame(26, 'test');
        g.foodSpawned = 0;
        const food = g.spawnPopulateItem(40, 0);
        expect(food.category).toBe(ItemCategory.FOOD);
        g.foodSpawned = 1000000;
        const before = structuredClone(g.meteredItems);
        const choose = vi.spyOn(ItemLoader, 'pickItemCategory');
        expect(g.spawnPopulateItem(27, 0).category).toBe(ItemCategory.GEM);
        expect(g.spawnPopulateItem(40, 0).originDepth).toBe(40);
        expect(choose).not.toHaveBeenCalled();
        expect(g.meteredItems).toEqual(before);
    });

    it('same-depth stacks take one slot and merge at capacity; other depths remain distinct', () => {
        const pack = new Inventory();
        const gem = ItemLoader.spawnGem(27, 0, 0);
        pack.addItem(gem);
        for (let i = 0; i < 25; i++) pack.addItem(new Item(`fixture ${i}`, '[', 0, ItemCategory.ARMOR));
        expect(pack.addItem(ItemLoader.spawnGem(27, 0, 0))).toBe(true);
        expect(pack.addItem(ItemLoader.spawnGem(28, 0, 0))).toBe(false);
        expect(gem.quantity).toBe(2);
        expect(pack.packCount()).toBe(26);
        pack.removeItem(pack.items[1]!);
        expect(pack.addItem(ItemLoader.spawnGem(28, 0, 0))).toBe(true);
        expect(lumenstoneCount(pack.items)).toBe(2);
        expect(endgameScore(0, pack.items, false, false, false)).toBe(1000);
        expect(endgameScore(0, pack.items, true, false, false)).toBe(15000);
    });

    it('a real drop command moves the entire GEM stack, survives save/load and can be picked up', () => {
        const g: any = createHeadlessGame(26, 'test');
        g.monsters = []; g.dormantMonsters = []; g.items = [];
        g.player.inventory.items = []; g.player.equippedWeapon = null; g.player.equippedArmor = null;
        g.grid.setTerrain(5, 5, T.FLOOR); g.player.loc = { x: 5, y: 5 };
        const gem = ItemLoader.spawnGem(27, 0, 0); gem.quantity = 3;
        g.player.inventory.addItem(gem);
        g.executeItemCommand('drop', gem);
        expect(g.player.inventory.items).not.toContain(gem);
        expect(g.items).toEqual([gem]); expect(gem.quantity).toBe(3);
        expect(g.exportRecording().events.at(-1)).toMatchObject({ action: 'item:command', data: `drop|${gem.inventoryLetter}|` });
        expect(g.loadSnapshot(g.toSnapshot())).toBe(true);
        g.handlePlayerAction('pickup');
        expect(g.items).toHaveLength(0);
        expect(g.player.inventory.items).toHaveLength(1);
        expect(g.player.inventory.items[0]).toMatchObject({ id: gem.id, quantity: 3, originDepth: 27 });
        expect(g.player.inventory.packCount()).toBe(1);
    });

    it('a real wait in deep water washes away the entire GEM stack (CE dropItem)', () => {
        const g: any = createHeadlessGame(26, 'test');
        g.monsters = []; g.dormantMonsters = []; g.items = [];
        g.player.inventory.items = []; g.player.equippedWeapon = null; g.player.equippedArmor = null;
        g.grid.setTerrain(5, 5, T.WATER_DEEP); g.player.loc = { x: 5, y: 5 };
        const gem = ItemLoader.spawnGem(27, 0, 0); gem.quantity = 3;
        g.player.inventory.addItem(gem);
        // Force only the documented 50%-per-100-ticks current check; keep all other rolls real.
        const realPercent = rng.randPercent.bind(rng);
        vi.spyOn(rng, 'randPercent').mockImplementation(p => p === 50 || realPercent(p));
        g.handlePlayerAction('wait');
        expect(g.player.inventory.items).not.toContain(gem);
        expect(g.items).toContain(gem);
        expect(g.items).toHaveLength(1);
        expect(gem).toMatchObject({ quantity: 3, originDepth: 27 });
        // The same environment update may subsequently drift this entire floor stack.
        expect(g.grid.isValidPos(gem.x, gem.y)).toBe(true);
    });

    it('deep hordes and mining light use actual depth, with CE color/profile saturation only', () => {
        const g: any = createHeadlessGame(26, 'test');
        vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        vi.spyOn(rng, 'randRange').mockReturnValue(5);
        expect(g.rollSpawnDepth(25).depth).toBe(26);
        for (const d of [27, 30, 39, 40]) {
            expect(g.rollSpawnDepth(d).depth).toBe(d);
            expect(g.hordeCandidates(d, []).every((h: any) => h.minLevel <= d && d <= h.maxLevel)).toBe(true);
            let expected = 78 * 65536; // CE DCOLS=79 (Light.c fixed point).
            for (let i = 0; i < d; i++) expected = Math.trunc(expected * 85 / 100);
            expected += 65536 * 225 / 100;
            expect(minersLightBaseRadiusFixpt(d)).toBe(expected);
            expect(minersLightColorAtDepth(d)).toEqual(minersLightColorAtDepth(26));
        }
        expect(minersLightBaseRadiusFixpt(40)).toBeLessThan(minersLightBaseRadiusFixpt(26));
        expect(updateMinersLightRadius(minersLightBaseRadiusFixpt(40), { darknessStatus: 10, darknessMax: 10 }).radiusHundredths).toBe(11);
    });
});

describe('U26a natural maps and real player commands', () => {
    it.each([777, 31337, 424242])('seed %i: D26–40, all gems, upstairs/cache/save and terminal victory', seed => {
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
        const g: any = createHeadlessGame(seed);
        // Position/health are fixtures; maps, monsters, loot and all operations are real.
        g.player.hp = g.player.maxHp = 100000;
        g.animationEnabled = false;
        for (let d = 1; d < 26; d++) {
            expect(gems(g)).toHaveLength(0);
            g.player.loc = terminal(g, T.STAIRS_DOWN);
            g.handlePlayerAction('stairs_down');
            expect(g.depth).toBe(d + 1);
        }
        const amulet = g.items.find((i: Item) => i.category === ItemCategory.AMULET)!;
        expect(amulet).toBeDefined();
        g.player.loc = { ...amulet.loc };
        g.handlePlayerAction('pickup');
        expect(g.player.inventory.items).toContain(amulet);
        const metered = structuredClone(g.meteredItems), gold = g.goldGenerated;
        let total = 0;
        for (let d = 27; d <= 40; d++) {
            g.player.loc = terminal(g, T.STAIRS_DOWN);
            g.handlePlayerAction('stairs_down');
            expect(g.depth).toBe(d);
            const down = terminal(g, d === 40 ? T.DUNGEON_PORTAL : T.STAIRS_DOWN);
            // CE permits swimming/levitation; test physical reachability, not a resource-free route.
            // Hazard traversal is exercised with real commands below. Walls still block this map.
            const distances = generationDistances({ ...g, monsters: [] }, terminal(g, T.STAIRS_UP), 0, true);
            expect(distances[down.x]![down.y], `seed${seed} D${d} stair path`).toBeLessThan(30000);
            const loot = [...gems(g)];
            expect(loot).toHaveLength(distribution[d - 27]!);
            expect(g.items.every((i: Item) => i.category === ItemCategory.GEM || i.category === ItemCategory.FOOD)).toBe(true);
            expect(g.meteredItems).toEqual(metered);
            expect(g.goldGenerated).toBe(gold);
            for (const item of loot) {
                expect(item.originDepth).toBe(d);
                expect(g.grid.getCell(item.x, item.y)!.machineNumber).toBe(0);
                expect(cellTerrainFlags(g.grid, item.x, item.y) & (T_PATHING_BLOCKER | T_OBSTRUCTS_ITEMS)).toBe(0);
                expect(distances[item.x]![item.y], `seed${seed} D${d} gem path`).toBeLessThan(30000);
                g.player.loc = { ...item.loc };
                g.handlePlayerAction('pickup');
                expect(g.items).not.toContain(item);
                total++;
            }
            expect(g.player.inventory.items.filter((i: Item) => i.category === ItemCategory.GEM).reduce((n: number, i: Item) => n + i.quantity, 0)).toBe(total);
            expect(g.isGameOver).toBe(false);
            if (d === 28) {
                const saved = g.toSnapshot();
                expect(g.loadSnapshot(saved)).toBe(true);
                g.player.loc = terminal(g, T.STAIRS_UP); g.handlePlayerAction('stairs_up');
                expect(g.depth).toBe(27); expect(gems(g)).toHaveLength(0);
                g.player.loc = terminal(g, T.STAIRS_DOWN); g.handlePlayerAction('stairs_down');
                expect(g.depth).toBe(28); expect(gems(g)).toHaveLength(0);
                expect(lumenstoneCount(g.player.inventory.items)).toBe(2);
            }
        }
        expect(total).toBe(25);
        expect(lumenstoneCount(g.player.inventory.items)).toBe(14);
        expect(g.monsters).toHaveLength(0);
        g.player.loc = terminal(g, T.DUNGEON_PORTAL);
        g.handlePlayerAction('wait_or_stairs_down');
        expect(g.depth).toBe(40);
        expect(g.gameOverWon).toBe(true);
        expect(g.gameOverSuperVictory).toBe(true);
        expect(g.gameOverScore).toBe(g.stats.gold + 70000 + 25 * 5000);
        expect(readHighScores()[0]!.description).toBe('Mastered the Dungeons of Doom with 14 lumenstones!');
    });

    it.each([0, 1, 2])('D40 portal rejects an empty pack, then settles %i gem stacks and description', count => {
        const store = new Map<string, string>();
        vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) });
        const g: any = createHeadlessGame(777);
        g.depth = 40; g.generateDepth(false, false);
        g.player.loc = terminal(g, T.DUNGEON_PORTAL);
        g.handlePlayerAction('stairs_down');
        expect(g.isGameOver).toBe(false); expect(g.depth).toBe(40);
        g.player.inventory.addItem(ItemLoader.spawnAmulet('amulet_of_yendor', 0, 0)!);
        for (let i = 0; i < count; i++) g.player.inventory.addItem(ItemLoader.spawnGem(27 + i, 0, 0));
        g.handlePlayerAction('stairs_down');
        expect(g.gameOverSuperVictory).toBe(true);
        expect(g.exportRecording().events.at(-1).end).toMatchObject({ won: true, superVictory: true });
        expect(g.gameOverScore).toBe(70000 + count * 5000);
        expect(readHighScores()[0]!.description).toBe(count === 0 ? 'Mastered the Dungeons of Doom!'
            : count === 1 ? 'Mastered the Dungeons of Doom with a lumenstone!' : 'Mastered the Dungeons of Doom with 2 lumenstones!');
    });
});
