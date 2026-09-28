import {afterEach, describe, expect, it, vi} from 'vitest';
import {Grid, TerrainType as T, DungeonLayer as L, DCOLS, DROWS} from '../engine/Map/Grid';
import {fillLakes, cleanUpLakeBoundaries} from '../engine/Map/LakeSystem';
import {BlueprintEngine, type BlueprintDef, resetMachineCounter} from '../engine/Generator/BlueprintEngine';
import {setMachineObservationHook, type MachineTrace} from '../engine/Generator/MachineObservation';
import blueprints from '../data/blueprints.json';
import hordes from '../data/hordes.json';
import {createHeadlessGame} from './harness';
import {ItemCategory} from '../engine/Items/Item';
import {rng} from '../engine/Random';

const bp = (id: number) => (blueprints as BlueprintDef[]).find(b => b.ceBlueprintId === id)!;
function openGrid(): Grid {
    const grid = new Grid(DCOLS, DROWS);
    for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
        grid.setTerrain(x, y, x && y && x < DCOLS - 1 && y < DROWS - 1 ? T.FLOOR : T.WALL, '.', 0);
    }
    return grid;
}
afterEach(() => {vi.restoreAllMocks(); setMachineObservationHook(null);});

describe('X4-R2 CE generation content', () => {
    it('lake writes retain FLOOR, surfaces and gas; wreaths keep walls blocking and remove doors', () => {
        const grid = openGrid(), center = grid.getCell(20, 10)!;
        center.layers[L.SURFACE] = T.URINE;
        center.layers[L.GAS] = T.STEAM;
        grid.setTerrain(21, 10, T.WALL, '#', 0);
        grid.setTerrain(19, 10, T.DOOR, '+', 0);
        rng.seedRandomGenerator(123);
        fillLakes(grid, new Set([10 * DCOLS + 20]), 40);
        expect(center.layers).toEqual([T.FLOOR, T.WATER_DEEP, T.STEAM, T.URINE]);
        expect(grid.getCell(21, 10)!.layers[L.LIQUID]).toBe(T.WATER_SHALLOW);
        expect(grid.getCell(21, 10)!.layers[L.DUNGEON]).toBe(T.WALL);
        expect(grid.getCell(21, 10)!.isPassable).toBe(false);
        expect(grid.getCell(19, 10)!.layers[L.DUNGEON]).toBe(T.FLOOR);
        for (const x of [30, 32]) {
            grid.getCell(x, 10)!.layers[L.LIQUID] = T.WATER_DEEP;
            grid.getCell(x, 10)!.refreshTerrainProperties();
        }
        grid.setTerrain(31, 10, T.WALL, '#', 0);
        cleanUpLakeBoundaries(grid);
        expect(grid.getCell(31, 10)!.layers.slice(0, 2)).toEqual([T.FLOOR, T.WATER_DEEP]);
    });

    it('CE15 forced entry stops on success, caps failures at 50, and only runs on D26', () => {
        const calls: number[] = [];
        vi.spyOn(BlueprintEngine.prototype, 'buildAMachine').mockImplementation((id) => {
            calls.push(id);
            return id === 15 && calls.filter(x => x === 15).length === 3
                ? {subMachines: []} as any : null;
        });
        new BlueprintEngine(openGrid(), 26).buildMachines();
        expect(calls.slice(0, 3)).toEqual([15, 15, 15]);
        expect(calls.filter(x => x === 15)).toHaveLength(3);
        vi.mocked(BlueprintEngine.prototype.buildAMachine).mockImplementation(id => {calls.push(id); return null;});
        calls.length = 0;
        new BlueprintEngine(openGrid(), 26).buildMachines();
        expect(calls.filter(x => x === 15)).toHaveLength(50);
        calls.length = 0;
        new BlueprintEngine(openGrid(), 25).buildMachines();
        expect(calls).not.toContain(15);
    });

    it('all four machine=62 hordes build real camp products before the leader', () => {
        const game: any = createHeadlessGame(777);
        const entries = hordes.filter(h => h.machine === 62);
        expect(entries).toHaveLength(4);
        for (const [i, horde] of entries.entries()) {
            game.grid = openGrid(); game.items = []; game.monsters = []; game.dormantMonsters = [];
            const traces: MachineTrace[] = [];
            setMachineObservationHook(t => {if (t.status === 'committed') {
                expect(game.monsters).toHaveLength(0);
                traces.push(t);
            }});
            rng.seedRandomGenerator(900 + i); resetMachineCounter();
            expect(game.spawnHordeAt(horde, {x: 30, y: 15}, 10, false)).toBe(true);
            expect(traces.map(t => t.ceBlueprintId)).toContain(62);
            expect(traces[0]!.features.filter(f => f.status === 'placed').map(f => f.index)).toEqual([0, 1, 2, 3]);
            for (const tile of [T.HAY, T.JUNK, T.URINE]) expect(game.grid.cells.flat().some((c: any) => c.layers.includes(tile))).toBe(true);
            expect(game.monsters[0].typeId).toBe(horde.leader.toLowerCase());
        }
    });

    it('a failed camp restores its terrain and products while its horde still spawns', () => {
        const game: any = createHeadlessGame(777);
        game.grid = openGrid(); game.items = []; game.monsters = []; game.dormantMonsters = [];
        const before = game.grid.cells.flat().map((c: any) => [...c.layers]);
        const camp = bp(62), old = camp.features;
        // Exercise a real late minimum failure after the normal camp products.
        camp.features = [...old, {itemCategory: 'POTION', itemId: 'potion_of_life',
            instanceCount: [1, 1], minimumInstanceCount: 1, flags: ['MF_GENERATE_ITEM']},
            {instanceCount: [0, 0], minimumInstanceCount: 1, flags: []}];
        try {
            expect(game.spawnHordeAt(hordes.find(h => h.machine === 62), {x: 30, y: 15}, 10, false)).toBe(true);
            expect(game.grid.cells.flat().map((c: any) => c.layers)).toEqual(before);
            expect(game.items).toHaveLength(0);
            expect(game.dormantMonsters).toHaveLength(0);
            expect(game.monsters.length).toBeGreaterThan(0);
            expect(game.grid.cells.flat().every((c: any) => c.machineNumber === 0)).toBe(true);
        } finally {camp.features = old;}
    });

    it('CE9/10 truncate inactive storage rows and CE19 actually produces each alternative exclusively', () => {
        expect(bp(9).features).toHaveLength(5);
        expect(bp(10).features).toHaveLength(4);
        expect(bp(19).features).toHaveLength(3);
        const kinds = new Set<string>();
        for (let seed = 1; seed <= 30; seed++) {
            rng.seedRandomGenerator(seed);
            const machine = new BlueprintEngine(openGrid(), 3).buildAMachine(19, [], null, {x: 30, y: 15});
            expect(machine).not.toBeNull();
            expect(machine!.itemSpawns).toHaveLength(1);
            kinds.add(machine!.itemSpawns[0]!.id!);
        }
        expect([...kinds].sort()).toEqual(['incendiary_dart', 'potion_of_incineration']);
    });

    it('real sequential generation supplies a single D26 amulet, its switch and dormant Warden', () => {
        for (const seed of [1191900, 1199819]) {
            const game: any = createHeadlessGame(seed);
            for (let depth = 2; depth <= 26; depth++) {game.depth = depth; game.generateDepth(false, false);}
            const amulets = game.items.filter((item: any) => item.category === ItemCategory.AMULET);
            expect(amulets).toHaveLength(1);
            expect(game.grid.getCell(amulets[0].x, amulets[0].y).layers).toContain(T.AMULET_SWITCH);
            expect(game.dormantMonsters.filter((m: any) => m.typeId.toLowerCase() === 'warden_of_yendor')).toHaveLength(1);
            const warden = game.dormantMonsters.find((m: any) => m.typeId.toLowerCase() === 'warden_of_yendor');
            game.placeAmuletForLevel([{x: 1, y: 1}]);
            expect(game.items.filter((item: any) => item.category === ItemCategory.AMULET)).toHaveLength(1);
            game.player.hp = game.player.maxHp = 10000;
            game.player.loc = {...amulets[0].loc};
            game.handlePlayerAction('pickup', undefined, 'system');
            expect(game.player.inventory.items.filter((item: any) => item.id === amulets[0].id)).toHaveLength(1);
            expect(game.monsters).toContain(warden);
            expect(game.dormantMonsters).not.toContain(warden);
        }
    });
});
