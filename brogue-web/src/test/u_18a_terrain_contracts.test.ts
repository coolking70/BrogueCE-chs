import { describe, expect, it } from 'vitest';
import { Cell, Grid, TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { terrainBlocksMovement, terrainBlocksVision, terrainBlocksScent,
    terrainPassableOrSecretDoor, genericPathCost, safetyTerrainCosts } from '../engine/Map/TerrainRules';
import { discoveredTerrainFlagsOfCell, terrainFlagsOfCell } from '../engine/Map/DungeonFeature';
import { T_AUTO_DESCENT, T_IS_DF_TRAP, T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION,
    TERRAIN_FLAGS, TM_IS_SECRET } from '../engine/Map/TerrainCatalog';
import { ScentMap } from '../engine/Map/Scent';
import { buildSafetyMap } from '../engine/Map/SafetyMap';
import { WaypointSystem } from '../engine/Map/WaypointMap';
import { FOVSys } from '../engine/Lighting/FOV';
import { obstructsScent } from '../engine/Map/Scent';
import { rng } from '../engine/Random';

const context = { playerLevitating: false, playerImmuneToFire: false, harmlessOccupant: false };
function corridor(): Grid {
    const grid = new Grid(9, 5);
    for (let x = 0; x < 9; x++) for (let y = 0; y < 5; y++) grid.setTerrain(x, y, T.GRANITE);
    for (let x = 1; x < 8; x++) grid.setTerrain(x, 2, T.FLOOR);
    return grid;
}
function cellOf(dungeon: T, liquid = T.NOTHING, surface = T.NOTHING, gas = T.NOTHING): Cell {
    const grid = new Grid(7, 7);
    for (const [layer, tile] of [[L.DUNGEON, dungeon], [L.LIQUID, liquid], [L.SURFACE, surface], [L.GAS, gas]] as const) {
        grid.setTerrainLayer(3, 3, layer, tile);
    }
    return grid.getCell(3, 3)!;
}

// Literal CE flag/branch results, not expectations derived from production helpers.
// [physical block, vision block, scent block, generic cost, player safety, monster safety]
const rows: Array<[string, T, T, T, T, [boolean, boolean, boolean, number, number, number]]> = [
    ['floor', T.FLOOR, T.NOTHING, T.NOTHING, T.NOTHING, [false, false, false, 1, 1, 1]],
    ['closed door', T.DOOR, T.NOTHING, T.NOTHING, T.NOTHING, [false, true, true, 1, 1, 1]],
    ['open door', T.OPEN_DOOR, T.NOTHING, T.NOTHING, T.NOTHING, [false, false, false, 1, 1, 1]],
    ['locked door', T.LOCKED_DOOR, T.NOTHING, T.NOTHING, T.NOTHING, [true, true, true, -2, -2, -2]],
    ['secret door outside FOV', T.SECRET_DOOR, T.NOTHING, T.NOTHING, T.NOTHING, [true, true, true, 1, 100, 1]],
    ['web', T.FLOOR, T.NOTHING, T.WEB, T.NOTHING, [false, false, false, 1, 1, 1]],
    ['deep water', T.FLOOR, T.WATER_DEEP, T.NOTHING, T.NOTHING, [false, false, true, -1, 5, 5]],
    ['shallow water', T.FLOOR, T.WATER_SHALLOW, T.NOTHING, T.NOTHING, [false, false, false, 1, 1, 1]],
    ['lava', T.FLOOR, T.LAVA, T.NOTHING, T.NOTHING, [false, false, true, -1, 1, -1]],
    ['chasm', T.FLOOR, T.CHASM, T.NOTHING, T.NOTHING, [false, false, true, -1, -1, -1]],
    ['brimstone', T.FLOOR, T.INERT_BRIMSTONE, T.NOTHING, T.NOTHING, [false, false, true, -1, 5, 5]],
    ['foliage', T.FLOOR, T.NOTHING, T.FOLIAGE, T.NOTHING, [false, true, true, 1, 1, 1]],
    ['transparent forcefield', T.FLOOR, T.NOTHING, T.FORCEFIELD, T.NOTHING, [true, false, true, -2, -2, -2]],
    ['four layers: water/web/gas', T.FLOOR, T.WATER_DEEP, T.WEB, T.POISON_GAS, [false, false, true, -1, 5, 5]],
    ['four layers: wall/water/web/gas', T.WALL, T.WATER_DEEP, T.WEB, T.POISON_GAS, [true, true, true, -2, -2, -2]],
    ['four layers: door/water/fire/gas', T.DOOR, T.WATER_DEEP, T.PLAIN_FIRE, T.POISON_GAS, [false, true, true, -1, -1, -1]],
    ['trap under web', T.PRESSURE_PLATE, T.NOTHING, T.WEB, T.NOTHING, [false, false, false, -1, -1, -1]],
];

describe('U18a independent caller truth tables', () => {
    it.each(rows)('%s', (_name, d, l, s, g, expected) => {
        const cell = cellOf(d, l, s, g);
        expect([terrainBlocksMovement(cell), terrainBlocksVision(cell), terrainBlocksScent(cell),
            genericPathCost(cell), ...safetyTerrainCosts(cell, context)]).toEqual(expected);
        // Legacy/cache values must not affect the new contracts.
        cell.isPassable = !cell.isPassable; cell.isOpaque = !cell.isOpaque;
        expect([terrainBlocksMovement(cell), terrainBlocksVision(cell), terrainBlocksScent(cell),
            genericPathCost(cell), ...safetyTerrainCosts(cell, context)]).toEqual(expected);
    });

    it('secret exception projects the immediate successor, not explored or promoted state', () => {
        const secret = cellOf(T.SECRET_DOOR);
        secret.isExplored = true;
        expect(safetyTerrainCosts(secret, context)).toEqual([100, 1]);
        secret.isVisible = true;
        expect(safetyTerrainCosts(secret, context)).toEqual([1, 1]);
        expect(discoveredTerrainFlagsOfCell(secret) & T_OBSTRUCTS_VISION).not.toBe(0);
        expect(terrainPassableOrSecretDoor(secret)).toBe(true);
        const lever = cellOf(T.WALL_LEVER_HIDDEN);
        expect(discoveredTerrainFlagsOfCell(lever) & T_OBSTRUCTS_PASSABILITY).not.toBe(0);
        expect(terrainPassableOrSecretDoor(lever)).toBe(false);
        expect(genericPathCost(lever)).toBe(-2);
        // CE only projects secret layers; it does NOT OR unchanged layers here.
        const stacked = cellOf(T.SECRET_DOOR, T.LAVA, T.FORCEFIELD);
        expect(terrainPassableOrSecretDoor(stacked)).toBe(true);
        expect(genericPathCost(stacked)).toBe(-1);
    });

    it('all current secret discovery successors have explicit flag facts, without running DFs', () => {
        for (const [terrain, entry] of Object.entries(TERRAIN_FLAGS)) {
            if (entry.mechFlags & TM_IS_SECRET) expect(() => discoveredTerrainFlagsOfCell(cellOf(Number(terrain) as T))).not.toThrow();
        }
        expect(discoveredTerrainFlagsOfCell(cellOf(T.TRAP_DOOR_HIDDEN))).toBe(T_AUTO_DESCENT);
        expect(discoveredTerrainFlagsOfCell(cellOf(T.GAS_TRAP_POISON_HIDDEN))).toBe(T_IS_DF_TRAP);
    });

    it('safety branch order and literal lava immunity condition differ from generic path cost', () => {
        const lava = cellOf(T.FLOOR, T.LAVA);
        expect(safetyTerrainCosts(lava, { ...context, playerImmuneToFire: true })).toEqual([-1, -1]);
        expect(safetyTerrainCosts(lava, { ...context, playerImmuneToFire: true, playerLevitating: true })).toEqual([1, -1]);
        expect(safetyTerrainCosts(lava, { ...context, harmlessOccupant: true })).toEqual([1, -1]);
        const waterFire = cellOf(T.FLOOR, T.WATER_DEEP, T.PLAIN_FIRE);
        expect(safetyTerrainCosts(waterFire, { ...context, playerLevitating: true })).toEqual([-1, -1]);
        expect(safetyTerrainCosts(waterFire, { ...context, playerImmuneToFire: true })).toEqual([1, -1]);
        expect(safetyTerrainCosts(waterFire, { ...context, harmlessOccupant: true })).toEqual([1, -1]);
        expect(safetyTerrainCosts(cellOf(T.FLOOR, T.WATER_DEEP, T.SACRED_GLYPH), context)).toEqual([1, -1]);
    });

    it('scent writes door/water/chasm cells, but blocks propagation beyond them', () => {
        const grid = corridor();
        for (const terrain of [T.DOOR, T.WATER_DEEP, T.CHASM, T.LOCKED_DOOR]) {
            grid.setTerrain(4, 2, terrain);
            const scent = new ScentMap(9, 5);
            scent.update(grid, 2, 2, new FOVSys(grid).computeFOVMask(2, 2, 9, obstructsScent));
            expect(scent.get(6, 2)).toBe(0);
            expect(scent.get(4, 2) > 0).toBe(terrain !== T.LOCKED_DOOR);
        }
        grid.setTerrain(4, 2, T.OPEN_DOOR);
        const scent = new ScentMap(9, 5);
        scent.update(grid, 2, 2, new FOVSys(grid).computeFOVMask(2, 2, 9, obstructsScent));
        expect(scent.get(6, 2)).toBeGreaterThan(0);
    });

    it('real safety and waypoint scans honor a locked door hidden by gas/surface', () => {
        const grid = corridor();
        grid.setTerrain(4, 2, T.LOCKED_DOOR);
        grid.setTerrainLayer(4, 2, L.GAS, T.POISON_GAS);
        grid.setTerrainLayer(4, 2, L.SURFACE, T.WEB);
        const ctx = { grid, playerX: 2, playerY: 2, ...context, monsterAt: () => undefined, isInLoop: () => false };
        expect(buildSafetyMap(ctx)[4]![2]).toBe(30000);
        const wp = new WaypointSystem();
        wp.coordinates = [{ x: 2, y: 2 }]; wp.count = 1;
        const wc = { grid, monsters: [], playerLoc: { x: 1, y: 2 }, isOccupiedByMonster: () => false,
            computeWaypointFOV: (x: number, y: number) => new FOVSys(grid).computeFOVMask(x, y, 10, obstructsScent) };
        wp.refreshWaypoint(0, wc);
        expect(wp.distanceMaps[0]![6]![2]).toBe(30000);
        grid.setTerrain(4, 2, T.OPEN_DOOR);
        wp.refreshWaypoint(0, wc);
        expect(wp.distanceMaps[0]![6]![2]).toBe(4);
    });

    it('queries do not consume either RNG stream or mutate the cell', () => {
        const cell = cellOf(T.SECRET_DOOR, T.WATER_DEEP, T.WEB, T.POISON_GAS);
        const before = JSON.stringify({ cell, rng });
        terrainFlagsOfCell(cell); terrainPassableOrSecretDoor(cell); genericPathCost(cell); safetyTerrainCosts(cell, context);
        expect(JSON.stringify({ cell, rng })).toBe(before);
    });

    it('safety stair override survives surface/gas overlays and activation occupancy stays forbidden', () => {
        const grid = corridor();
        grid.setTerrain(4, 2, T.STAIRS_DOWN);
        grid.setTerrainLayer(4, 2, L.SURFACE, T.WEB);
        grid.setTerrainLayer(4, 2, L.GAS, T.POISON_GAS);
        const ctx = { grid, playerX: 2, playerY: 2, ...context, isInLoop: () => false,
            monsterAt: (x: number, y: number) => x === 5 && y === 2 ? {
                loc: { x, y }, hp: 10, state: 1, isAlly: false,
                hasBehavior: (flag: string) => flag === 'MONST_GETS_TURN_ON_ACTIVATION',
            } : undefined };
        const before = JSON.stringify(rng);
        const map = buildSafetyMap(ctx);
        expect(map[4]![2]).toBe(30000);
        expect(map[5]![2]).toBe(30000);
        expect(JSON.stringify(rng)).toBe(before);
    });
});
