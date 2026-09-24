import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, DungeonLayer as L, TerrainType as T } from '../engine/Map/Grid';
import { obstructionDecrement, spawnObstruction, runPromotionUpdate, promoteTile } from '../engine/Map/Promotion';
import { catalogFeature, cellTerrainFlags, spawnDungeonFeature } from '../engine/Map/DungeonFeature';
import { DF, DUNGEON_FEATURE_CATALOG } from '../engine/Map/DungeonFeatureCatalog';
import { AUTO_GENERATOR_CATALOG } from '../engine/Map/AutoGenerator';
import { T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION } from '../engine/Map/TerrainCatalog';
import { WaypointSystem } from '../engine/Map/WaypointMap';
import { FOVSys } from '../engine/Lighting/FOV';
import * as reflection from '../engine/Combat/BoltReflection';
import { Pathfind } from '../engine/Map/Pathfind';
import { Player } from '../entities/Player';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import blueprints from '../data/blueprints.json';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { BoltEffect, getBoltForItem, type BoltConfig } from '../engine/Combat/Bolt';
import { CEBoltType, CE_BOLT_CATALOG } from '../engine/Combat/BoltCatalog';
import { rng } from '../engine/Random';
import { DCOLS, DROWS } from '../types';
import { createHeadlessGame } from './harness';

// W-26 owns identity/pool entry; use an explicit effect with an existing staff.
const OBSTRUCTION: BoltConfig = { id: 'w14_explicit_obstruction', name: 'obstruction', ceType: CEBoltType.OBSTRUCTION,
    effect: BoltEffect.OBSTRUCTION, magnitude: 999, char: '*', color: 0x55ff55,
    maxRange: 0, piercing: false, selfTargeting: false };
function floorGrid(w = 25, h = 15) {
    const grid = new Grid(w, h);
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
        grid.setTerrain(x, y, x === 0 || y === 0 || x === w - 1 || y === h - 1 ? T.WALL : T.FLOOR);
        Object.assign(grid.getCell(x, y)!, { isVisible: true, hasMemory: true });
    }
    return grid;
}
function scene() {
    const g = Object.create(Game.prototype) as Game;
    g.grid = floorGrid(DCOLS, DROWS); g.player = new Player(4, 5); g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.fov = new FOVSys(g.grid); g.waypoints = new WaypointSystem(); g.spawnFloatingText = vi.fn(); (g as any).updateVision = vi.fn();
    return g;
}
function staff(E = 2) {
    const item = ItemLoader.spawnStaff('staff_of_fire', -1, -1)!;
    Object.assign(item, { enchantment: E, charges: 1, maxCharges: 99 }); return item;
}
function mon(g: Game, x: number, y = 5) {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(d => d.id === 'rat')!);
    g.monsters.push(m); return m;
}
const surface = (grid: Grid, x: number, y: number) => grid.getCell(x, y)!.layers[L.SURFACE];
const count = (grid: Grid, tile: T) => {
    let total = 0;
    for (let x = 0; x < grid.width; x++) for (let y = 0; y < grid.height; y++) if (grid.getCell(x, y)!.layers.includes(tile)) total++;
    return total;
};
beforeEach(() => { vi.restoreAllMocks(); rng.seedRandomGenerator(14014); ItemLoader.identifiedItems.clear(); });

describe('W-14 CE catalog and enchantment diffusion', () => {
    it('copies the original row without filling pathDF/targetDF or adding a generation consumer', () => {
        expect(DF.DF_FORCEFIELD).toBe(51);
        expect(DUNGEON_FEATURE_CATALOG[DF.DF_FORCEFIELD]).toEqual({ id: 51, ceLine: 674, ceTile: 'FORCEFIELD', tile: T.FORCEFIELD,
            layer: L.SURFACE, startProbability: 100, probabilityDecrement: 50, flags: 0, cePropagationTerrain: '', propagationTerrain: null,
            subsequentDF: null, description: '', lightFlare: '', flashColor: '', effectRadius: 0 });
        expect(CE_BOLT_CATALOG[CEBoltType.OBSTRUCTION]).toMatchObject({ pathDF: null, targetDF: null });
        expect(AUTO_GENERATOR_CATALOG.some(e => e.df === DF.DF_FORCEFIELD || e.ceDfId === 51)).toBe(false);
        expect(JSON.stringify(blueprints)).not.toContain('DF_FORCEFIELD');
        expect(getBoltForItem('staff_of_obstruction')!.ceType).toBe(CEBoltType.OBSTRUCTION); // W-26 catalog
        expect(ItemLoader.spawnStaff('staff_of_obstruction', 0, 0)).not.toBeNull();
    });
    it.each([[2, 47], [3, 38], [4, 30], [8, 12], [10, 8], [19, 1], [40, 1], [99, 1], [0, 47], [1, 47], [NaN, 47]])('E=%s yields CE integer decrement %s', (E, decrement) => {
        expect(obstructionDecrement(E)).toBe(decrement);
    });
    it('E changes actual spread and random footprint, while the shared row stays 100/50', () => {
        const areas: number[] = [], draws: number[] = [];
        for (const E of [2, 3, 8]) {
            let area = 0, draw = 0;
            for (let seed = 0; seed < 12; seed++) {
                const grid = floorGrid(); rng.seedRandomGenerator(seed + 14);
                const before = rng.randomNumbersGenerated;
                area += spawnObstruction(grid, 12, 7, E, () => false).builtCells.length;
                draw += rng.randomNumbersGenerated - before;
            }
            areas.push(area); draws.push(draw);
        }
        expect(areas[1]).toBeGreaterThan(areas[0]!); expect(areas[2]).toBeGreaterThan(areas[1]!);
        expect(draws[2]).toBeGreaterThan(draws[0]!);
        expect(catalogFeature(DF.DF_FORCEFIELD)).toMatchObject({ startProbability: 100, probabilityDecrement: 50, flags: 0 });
    });
});

describe('W-14 detonation and terrain boundaries', () => {
    it('detonates once at the final landing, not along the path; instance E overrides config/charges', () => {
        const g = scene(); g.grid.setTerrain(15, 5, T.WALL);
        const source = staff(2), calls = vi.spyOn(rng, 'randPercent');
        const r = g.zapBoltFromPlayer(OBSTRUCTION, source, { x: 7, y: 5 });
        expect(r.landingPos).toEqual({ x: 14, y: 5 }); expect(r.path[0]).toEqual({ x: 5, y: 5 });
        expect(surface(g.grid, 14, 5)).toBe(T.FORCEFIELD); expect(surface(g.grid, 5, 5)).toBe(T.NOTHING);
        expect(new Set(calls.mock.calls.map(c => c[0]))).toEqual(new Set([100, 53, 6]));
        expect(r.outcome).toEqual({ autoID: true, casterMovement: null });
        expect([source.enchantment, source.charges, source.maxCharges]).toEqual([2, 1, 99]);
    });
    it('stops before a nonadjacent creature; occupied spread cells dissolve immediately without evacuation or damage', () => {
        const g = scene(), m = mon(g, 10), hp = m.hp; m.setStatusDuration('levitating', 10);
        const r = g.zapBoltFromPlayer(OBSTRUCTION, staff(), { x: 10, y: 5 });
        expect(r.landingPos).toEqual({ x: 9, y: 5 }); expect(r.hits).toEqual([]);
        expect(surface(g.grid, 9, 5)).toBe(T.FORCEFIELD); expect(surface(g.grid, 10, 5)).toBe(T.NOTHING);
        expect(m.loc).toEqual({ x: 10, y: 5 }); expect(m.hp).toBe(hp); expect(g.grid.getCell(10, 5)!.isPassable).toBe(true);
    });
    it('first-cell creature contact still detonates after travel, once; player and monster occupied cells clear', () => {
        const g = scene(), m = mon(g, 5); const hp = m.hp;
        const r = g.zapBoltFromPlayer(OBSTRUCTION, staff(), { x: 5, y: 5 });
        expect(r.landingPos).toEqual({ x: 5, y: 5 }); expect(r.hits[0]?.creature).toBe(m);
        expect(surface(g.grid, 5, 5)).toBe(T.NOTHING); expect(surface(g.grid, 4, 5)).toBe(T.NOTHING);
        expect(surface(g.grid, 5, 4)).toBe(T.FORCEFIELD); expect(m.hp).toBe(hp);
        expect(r.outcome?.autoID).toBe(true);
    });
    it('adjacent reflection detonates on the return landing, without harming the caster', () => {
        const g = scene(), m = mon(g, 5), hp = g.player.hp;
        vi.spyOn(reflection, 'projectileReflects').mockImplementation(target => target === m);
        const r = g.zapBoltFromPlayer(OBSTRUCTION, staff(), { x: 5, y: 5 });
        expect(r.reflections).toHaveLength(1); expect(r.landingPos).toEqual(g.player.loc);
        expect(surface(g.grid, 4, 4)).toBe(T.FORCEFIELD); expect(surface(g.grid, 4, 5)).toBe(T.NOTHING);
        expect(g.player.hp).toBe(hp); expect(r.outcome?.autoID).toBe(true);
    });
    it('preview and same-origin cast are pure; adjacent solid wall still autoIDs despite building zero cells', () => {
        const g = scene(); g.grid.setTerrain(5, 5, T.WALL); const source = staff();
        const before = JSON.stringify(g.grid), rngBefore = rng.randomNumbersGenerated;
        (g as any).computeBoltResult(OBSTRUCTION, g.player.loc, { x: 10, y: 5 });
        const same = g.zapBoltFromPlayer(OBSTRUCTION, source, { ...g.player.loc });
        expect(same.landingPos).toBeNull(); expect(same.outcome?.autoID).toBe(false);
        expect(JSON.stringify(g.grid)).toBe(before); expect(rng.randomNumbersGenerated).toBe(rngBefore);
        // Enclose the first-cell wall to prevent its CE origin-wave from reaching floor.
        for (const [x, y] of [[4, 5], [6, 5], [5, 4], [5, 6]]) g.grid.setTerrain(x!, y!, T.WALL);
        expect(g.zapBoltFromPlayer(OBSTRUCTION, source, { x: 9, y: 5 }).outcome?.autoID).toBe(true);
        expect(count(g.grid, T.FORCEFIELD)).toBe(0);
    });
    it('allows sealing a one-cell corridor; the generation connectivity veto remains effective', () => {
        const corridor = () => {
            const grid = floorGrid(17, 9);
            for (let x = 1; x < 16; x++) for (let y = 1; y < 8; y++) grid.setTerrain(x, y, y === 4 ? T.FLOOR : T.WALL);
            return grid;
        };
        const grid = corridor(); const destination = { x: 14, y: 4 };
        const path = () => Pathfind.findPath(grid, 2, 4, destination.x, destination.y, (x, y) => !!grid.getCell(x, y)?.isPassable);
        expect(path()).not.toBeNull();
        expect(spawnObstruction(grid, 8, 4, 2, () => false).succeeded).toBe(true);
        expect(surface(grid, 8, 4)).toBe(T.FORCEFIELD); expect(path()).toBeNull();
        const gen = corridor(); const feat = catalogFeature(DF.DF_FORCEFIELD); feat.probabilityDecrement = 47;
        rng.seedRandomGenerator(14014);
        expect(spawnDungeonFeature(gen, 8, 4, feat, true).succeeded).toBe(false);
        expect(count(gen, T.FORCEFIELD)).toBe(0);
    });
    it('IMPREGNABLE alone permits fields; surface-obstructing walls and all layers are respected', () => {
        const grid = floorGrid(); grid.impregnableCells.add(7 * DCOLS + 12);
        grid.impregnableCells.add(7 * DCOLS + 13); grid.setTerrain(13, 7, T.WALL);
        grid.setTerrainLayer(12, 6, L.GAS, T.WALL);
        grid.setTerrainLayer(12, 7, L.LIQUID, T.WATER_DEEP); grid.setTerrainLayer(12, 7, L.GAS, T.POISON_GAS);
        const cell = grid.getCell(12, 7)!; cell.volume = 82; cell.machineNumber = 7;
        spawnObstruction(grid, 12, 7, 2, () => false);
        expect(cell.layers).toEqual([T.FLOOR, T.WATER_DEEP, T.POISON_GAS, T.FORCEFIELD]);
        expect([cell.volume, cell.machineNumber, grid.isImpregnable(12, 7)]).toEqual([82, 7, true]);
        expect(surface(grid, 13, 7)).toBe(T.NOTHING); expect(surface(grid, 12, 6)).toBe(T.NOTHING);
        expect(cellTerrainFlags(grid, 12, 7) & T_OBSTRUCTS_PASSABILITY).not.toBe(0);
        expect(cellTerrainFlags(grid, 12, 7) & T_OBSTRUCTS_VISION).toBe(0);
        expect(cell.isPassable).toBe(false); expect(cell.isOpaque).toBe(false);
    });
    it('invalidates active path/safety caches without adding a non-CE waypoint rebuild', () => {
        const g = scene(); g.grid.setTerrain(12, 5, T.WALL);
        g.autoPath = [{ x: 10, y: 5 }]; g.isMouseTraveling = true; g.updatedSafetyMapThisTurn = true;
        const rebuild = vi.spyOn(g, 'rebuildWaypoints'); g.zapBoltFromPlayer(OBSTRUCTION, staff(), { x: 9, y: 5 });
        expect(g.autoPath).toEqual([]); expect(g.isMouseTraveling).toBe(false); expect(g.updatedSafetyMapThisTurn).toBe(false);
        expect(rebuild).not.toHaveBeenCalled(); expect(g.loopMap).toBeDefined(); expect((g as any).needsRender).toBe(true);
    });
});

describe('W-14 existing promotion lifetime', () => {
    it('only exposed edges age; each stage still blocks and eventual melt restores passage and underlying layers', () => {
        const grid = floorGrid(17, 13);
        // Force a dense CE diffusion sample, then force the chance rolls to pass.
        vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        spawnObstruction(grid, 8, 6, 2, () => false);
        vi.spyOn(rng, 'randRange').mockReturnValue(0);
        runPromotionUpdate(grid, { keyOnTileAt: () => false });
        expect(surface(grid, 8, 6)).toBe(T.FORCEFIELD); // no open neighbors yet
        expect(surface(grid, 11, 6)).toBe(T.FORCEFIELD_MELT);
        expect(grid.getCell(11, 6)!.isPassable).toBe(false);
        runPromotionUpdate(grid, { keyOnTileAt: () => false });
        expect(surface(grid, 11, 6)).toBe(T.NOTHING); expect(grid.getCell(11, 6)!.isPassable).toBe(true);
        for (let tick = 0; tick < 12; tick++) runPromotionUpdate(grid, { keyOnTileAt: () => false });
        expect(count(grid, T.FORCEFIELD) + count(grid, T.FORCEFIELD_MELT)).toBe(0);
    });
    it('scroll DUNGEON forcefields retain their separate layer semantics through the same melt chain', () => {
        const grid = floorGrid(); grid.setTerrainLayer(12, 7, L.DUNGEON, T.FORCEFIELD);
        promoteTile(grid, 12, 7, L.DUNGEON, false);
        expect(grid.getCell(12, 7)!.layers[L.DUNGEON]).toBe(T.FLOOR);
        expect(surface(grid, 12, 7)).toBe(T.FORCEFIELD_MELT); expect(grid.getCell(12, 7)!.isPassable).toBe(false);
        promoteTile(grid, 12, 7, L.SURFACE, false);
        expect(surface(grid, 12, 7)).toBe(T.NOTHING); expect(grid.getCell(12, 7)!.isPassable).toBe(true);
    });
    it('real objective time consumes the existing melt chain and snapshots retain the field layer', () => {
        const g = createHeadlessGame(14014);
        g.grid = floorGrid(DCOLS, DROWS); g.player.loc = { x: 4, y: 5 }; g.monsters = []; g.items = [];
        spawnObstruction(g.grid, 12, 7, 2, () => false);
        const snapshot = g.toSnapshot();
        const savedCount = count(g.grid, T.FORCEFIELD);
        g.loadSnapshot(snapshot); expect(count(g.grid, T.FORCEFIELD)).toBe(savedCount);
        vi.spyOn(rng, 'randRange').mockReturnValue(0);
        for (let tick = 0; tick < 14; tick++) (g as any).objectiveTimeBlock();
        expect(count(g.grid, T.FORCEFIELD) + count(g.grid, T.FORCEFIELD_MELT)).toBe(0);
    });
});
