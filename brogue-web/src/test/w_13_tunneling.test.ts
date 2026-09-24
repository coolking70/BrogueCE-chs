import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, DungeonLayer as L, TerrainType as T } from '../engine/Map/Grid';
import { tunnelize } from '../engine/Map/Promotion';
import { cellTerrainFlags, setDormantAwakener } from '../engine/Map/DungeonFeature';
import { T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION } from '../engine/Map/TerrainCatalog';
import { analyzeLoopMap } from '../engine/Map/LoopMap';
import { WaypointSystem } from '../engine/Map/WaypointMap';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';
import { Pathfind } from '../engine/Map/Pathfind';
import { BlueprintEngine } from '../engine/Generator/BlueprintEngine';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { Player } from '../entities/Player';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { BoltEffect, getBoltForItem, type BoltConfig } from '../engine/Combat/Bolt';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { boltLine, traceBolt } from '../engine/Combat/BoltTrajectory';
import * as reflection from '../engine/Combat/BoltReflection';
import { rng } from '../engine/Random';
import { DCOLS, DROWS } from '../types';
import { createHeadlessGame } from './harness';

// Explicit effect/config only: tunneling's item identity stays out of the pool.
const TUNNEL: BoltConfig = { id: 'w13_explicit_tunnel', name: 'tunneling', ceType: CEBoltType.TUNNELING,
    effect: BoltEffect.TUNNELING, magnitude: 999, char: '*', color: 0xcc8855,
    maxRange: 0, piercing: true, selfTargeting: false };
function scene() {
    const g = Object.create(Game.prototype) as Game;
    g.grid = new Grid(DCOLS, DROWS);
    for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
        g.grid.setTerrain(x, y, x === 0 || y === 0 || x === DCOLS - 1 || y === DROWS - 1 ? T.WALL : T.FLOOR);
        Object.assign(g.grid.getCell(x, y)!, { isVisible: true, hasMemory: true });
    }
    g.player = new Player(4, 5); g.monsters = []; g.dormantMonsters = []; g.items = []; g.levels = new Map();
    g.environment = new EnvironmentManager(g.grid); g.waypoints = new WaypointSystem();
    g.fov = new FOVSys(g.grid); g.lightMap = new LightMap(g.grid);
    g.spawnFloatingText = vi.fn(); (g as any).updateVision = vi.fn();
    return g;
}
function item(E = 2) {
    const result = ItemLoader.spawnStaff('staff_of_fire', -1, -1)!;
    Object.assign(result, { enchantment: E, charges: 1, maxCharges: 99 }); return result;
}
function cast(g: Game, E = 2, aim = { x: 6, y: 5 }, maxRange = 0) {
    return g.zapBoltFromPlayer({ ...TUNNEL, maxRange }, item(E), aim);
}
function mon(g: Game, x: number, y = 5, id = 'rat') {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(d => d.id === id)!);
    m.hp = m.maxHp = 100; g.monsters.push(m); return m;
}
const layer = (g: Game, x: number, y = 5) => g.grid.getCell(x, y)!.layers[L.DUNGEON];
const protect = (g: Game, x: number, y = 5) => g.grid.impregnableCells.add(y * DCOLS + x);
beforeEach(() => { vi.restoreAllMocks(); rng.seedRandomGenerator(13013); ItemLoader.identifiedItems.clear(); });

describe('W-13 CE E budget and distinct travel', () => {
    it.each([2, 3, 8])('E=%s digs that many consecutive cells; config magnitude/charges/maxCharges are not the budget', E => {
        const g = scene(); for (let x = 5; x < 16; x++) g.grid.setTerrain(x, 5, T.WALL);
        const source = item(E), before = { ...g.player.loc };
        const r = g.zapBoltFromPlayer(TUNNEL, source, { x: 5, y: 5 });
        expect(r.path).toHaveLength(E); expect(r.landingPos).toEqual({ x: 4 + E, y: 5 });
        for (let x = 5; x <= 4 + E; x++) expect(layer(g, x)).toBe(T.FLOOR);
        expect(layer(g, 5 + E)).toBe(T.WALL);
        expect(r.outcome).toEqual({ autoID: true, casterMovement: null }); expect(g.player.loc).toEqual(before);
        expect([source.enchantment, source.charges, source.maxCharges]).toEqual([E, 1, 99]);
    });
    it('gaps and creatures cost no E; termination is at the second wall beyond the aim', () => {
        const g = scene(), rat = mon(g, 7); g.grid.setTerrain(6, 5, T.WALL); g.grid.setTerrain(10, 5, T.WALL);
        g.grid.setTerrain(11, 5, T.WALL); const r = cast(g);
        expect(r.path.map(p => p.x)).toEqual([5, 6, 7, 8, 9, 10]); expect(r.hits[0]?.creature).toBe(rat);
        expect(rat.hp).toBe(100); expect(layer(g, 10)).toBe(T.FLOOR); expect(layer(g, 11)).toBe(T.WALL);
    });
    it('origin excavation is free and not itself autoID; same-origin aim is a pure no-op', () => {
        const g = scene(); g.grid.setTerrain(4, 5, T.WALL); g.grid.setTerrain(5, 5, T.WALL); g.grid.setTerrain(6, 5, T.WALL);
        expect(cast(g).landingPos).toEqual({ x: 6, y: 5 }); expect(layer(g, 4)).toBe(T.FLOOR);
        g.grid.setTerrain(4, 5, T.WALL); expect(cast(g, 2, { x: 5, y: 5 }, 1).outcome?.autoID).toBe(false);
        g.grid.setTerrain(4, 5, T.WALL); const source = item();
        const before = JSON.stringify(g.grid), count = rng.randomNumbersGenerated;
        const r = g.zapBoltFromPlayer(TUNNEL, source, { ...g.player.loc });
        expect(r.path).toEqual([]); expect(r.outcome?.autoID).toBe(false); expect(JSON.stringify(g.grid)).toBe(before);
        expect(rng.randomNumbersGenerated).toBe(count);
    });
    it('two diagonal primary walls still cost E=2 when kink repair opens extra cells', () => {
        const g = scene();
        for (const [x, y] of [[5, 6], [6, 7], [5, 5], [4, 6]]) g.grid.setTerrain(x!, y!, T.WALL);
        const r = cast(g, 2, { x: 5, y: 6 });
        expect(r.path).toEqual([{ x: 5, y: 6 }, { x: 6, y: 7 }]);
        expect(layer(g, 5, 6)).toBe(T.FLOOR); expect(layer(g, 6, 7)).toBe(T.FLOOR);
        expect(layer(g, 5, 5) === T.FLOOR || layer(g, 4, 6) === T.FLOOR).toBe(true);
    });
    it('actual excavation identifies even when the wall is unseen', () => {
        const g = scene(); g.grid.setTerrain(5, 5, T.WALL);
        Object.assign(g.grid.getCell(5, 5)!, { isVisible: false, hasMemory: false });
        expect(cast(g, 2, { x: 5, y: 5 }, 1).outcome?.autoID).toBe(true);
    });
    it('preview reaches E walls but never mutates terrain, invokes DF, or rolls RNG', () => {
        const g = scene(); g.grid.setTerrain(5, 5, T.WALL); g.grid.setTerrain(6, 5, T.WALL); g.grid.setTerrain(7, 5, T.WALL);
        const before = JSON.stringify(g.grid), count = rng.randomNumbersGenerated;
        const r = traceBolt(g.grid, { ...TUNNEL, magnitude: 2 }, g.player.loc, { x: 8, y: 5 }, (g as any).boltWorld(g.player));
        expect(r.path).toEqual([{ x: 5, y: 5 }, { x: 6, y: 5 }]); expect(r.outcome).toBeNull();
        expect(JSON.stringify(g.grid)).toBe(before); expect(rng.randomNumbersGenerated).toBe(count);
    });
    it.each(['staff_of_fire', 'staff_of_lightning', 'wand_of_slowness', 'staff_of_conjuration'])('ordinary %s still stops at/before the original obstacle without digging', id => {
        const g = scene(); g.grid.setTerrain(6, 5, T.WALL); const source = id.startsWith('staff') ? item() : ItemLoader.spawnWand(id, -1, -1)!;
        const r = g.zapBoltFromPlayer(getBoltForItem(id)!, source, { x: 9, y: 5 });
        expect(r.landingPos).toEqual({ x: id === 'staff_of_conjuration' ? 5 : 6, y: 5 }); expect(layer(g, 6)).toBe(T.WALL);
    });
    it('known tunneling prefers obstructing cells; hidden details preserve BOLT_NONE scoring', () => {
        const g = scene(), from = { x: 4, y: 5 }, to = { x: 9, y: 7 };
        const w = (g as any).boltWorld(g.player);
        const ordinary = boltLine(g.grid, from, to, { ...TUNNEL, effect: BoltEffect.NONE, ceType: null }, w);
        // A candidate through (8,6) competes with the center line through (8,7).
        g.grid.setTerrain(8, 6, T.WALL);
        const tuned = boltLine(g.grid, from, to, TUNNEL, w);
        expect(tuned).toContainEqual({ x: 8, y: 6 }); expect(tuned).not.toEqual(ordinary);
        expect(boltLine(g.grid, from, to, TUNNEL, { ...w, hideDetails: true })).toEqual(
            boltLine(g.grid, from, to, { ...TUNNEL, effect: BoltEffect.NONE, ceType: null }, w));
        protect(g, 8, 6); expect(boltLine(g.grid, from, to, TUNNEL, w)).not.toContainEqual({ x: 8, y: 6 });
    });
});

describe('W-13 semantic layer writer, protected walls and diagonal connectivity', () => {
    it.each([T.WALL, T.GRANITE, T.DOOR, T.LOCKED_DOOR, T.SECRET_DOOR, T.CRYSTAL_WALL, T.PORTCULLIS_CLOSED, T.FORCEFIELD])('removes obstructing %s by its flags on any layer', terrain => {
        const g = scene(); g.grid.setTerrainLayer(5, 5, L.SURFACE, terrain);
        cast(g, 2, { x: 6, y: 5 }, 1);
        expect(cellTerrainFlags(g.grid, 5, 5) & (T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION)).toBe(0);
        expect(g.grid.getCell(5, 5)!.isPassable).toBe(true); expect(g.grid.getCell(5, 5)!.isOpaque).toBe(false);
    });
    it('multiple blocked layers spend one E; liquids/gas and metadata survive the semantic write', () => {
        const g = scene(); g.grid.setTerrainLayer(5, 5, L.DUNGEON, T.WALL); g.grid.setTerrainLayer(5, 5, L.SURFACE, T.FORCEFIELD);
        g.grid.setTerrainLayer(5, 5, L.LIQUID, T.WATER_DEEP); g.grid.setTerrainLayer(5, 5, L.GAS, T.POISON_GAS);
        const c = g.grid.getCell(5, 5)!; c.volume = 80; c.machineNumber = 11;
        g.grid.setTerrain(6, 5, T.WALL); g.grid.setTerrain(7, 5, T.WALL);
        const r = cast(g); expect(r.landingPos).toEqual({ x: 6, y: 5 });
        expect(c.layers[L.DUNGEON]).toBe(T.FLOOR); expect(c.layers[L.LIQUID]).toBe(T.WATER_DEEP);
        expect(c.layers[L.GAS]).toBe(T.POISON_GAS); expect(c.volume).toBe(80); expect(c.machineNumber).toBe(11);
        expect(layer(g, 7)).toBe(T.WALL);
    });
    it.each([[0, 5], [DCOLS - 1, 5], [5, 0], [5, DROWS - 1]])('boundary (%s,%s) becomes impassable transparent crystal, never floor', (x, y) => {
        const g = scene(); expect(tunnelize(g.grid, x, y)).toBe(true);
        const c = g.grid.getCell(x, y)!; expect(c.layers[L.DUNGEON]).toBe(T.CRYSTAL_WALL);
        expect(c.isPassable).toBe(false); expect(c.isOpaque).toBe(false);
    });
    it('actual edge shot terminates on crystal even with remaining E', () => {
        const g = scene(); const r = cast(g, 8, { x: 3, y: 5 });
        expect(r.landingPos).toEqual({ x: 0, y: 5 }); expect(layer(g, 0)).toBe(T.CRYSTAL_WALL);
    });
    it('point-blank IMPREGNABLE blocks without reflection, excavation, release, DF or autoID', () => {
        const g = scene(), m = mon(g, 5); m.isCaged = true; g.grid.setTerrain(5, 5, T.WALL); protect(g, 5);
        const before = JSON.stringify(g.grid), release = vi.spyOn(g, 'freeCaptive'), awake = vi.fn(); setDormantAwakener(g.grid, awake);
        const r = cast(g); expect(r.path).toEqual([{ x: 5, y: 5 }]); expect(r.reflections).toEqual([]);
        expect(r.outcome?.autoID).toBe(false); expect(JSON.stringify(g.grid)).toBe(before);
        expect(release).not.toHaveBeenCalled(); expect(awake).not.toHaveBeenCalled();
    });
    it('IMPREGNABLE also protects the boundary before crystalization', () => {
        const g = scene(); protect(g, 0); expect(tunnelize(g.grid, 0, 5)).toBe(false); expect(layer(g, 0)).toBe(T.WALL);
    });
    it.each(['horizontal', 'vertical', 'both', 'none'])('repairs diagonal kinks with %s arm protected, no extra budget', protectedArm => {
        const g = scene(); g.grid.setTerrain(5, 5, T.WALL); g.grid.setTerrain(6, 5, T.WALL); g.grid.setTerrain(5, 6, T.WALL);
        if (protectedArm === 'horizontal' || protectedArm === 'both') protect(g, 6, 5);
        if (protectedArm === 'vertical' || protectedArm === 'both') protect(g, 5, 6);
        vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        expect(tunnelize(g.grid, 5, 5)).toBe(true);
        if (protectedArm === 'horizontal') { expect(layer(g, 6, 5)).toBe(T.WALL); expect(layer(g, 5, 6)).toBe(T.FLOOR); }
        if (protectedArm === 'vertical' || protectedArm === 'none') { expect(layer(g, 6, 5)).toBe(T.FLOOR); }
        if (protectedArm === 'both') { expect(layer(g, 6, 5)).toBe(T.WALL); expect(layer(g, 5, 6)).toBe(T.WALL); }
    });
});

describe('W-13 reflection, creatures, maps and persistence', () => {
    it('an impregnable wall reflects randomly at the preceding cell, preserving the budget', () => {
        const g = scene(); g.grid.setTerrain(7, 5, T.WALL); protect(g, 7); g.grid.setTerrain(6, 7, T.WALL); g.grid.setTerrain(6, 8, T.WALL);
        vi.spyOn(reflection, 'randomReflectionOffset').mockReturnValue({ x: 0, y: 5 });
        const r = cast(g); expect(r.path.slice(0, 4)).toEqual([{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 6, y: 7 }]);
        expect(r.reflections[0]).toMatchObject({ pos: { x: 6, y: 5 }, creature: null, towardCaster: false });
        expect(r.landingPos).toEqual({ x: 6, y: 8 }); expect(layer(g, 7)).toBe(T.WALL);
    });
    it('reflective creatures turn tunneling back through the caster; return walls use the remaining E', () => {
        const g = scene(), guardian = mon(g, 8, 5, 'stone_guardian'); g.grid.setTerrain(6, 5, T.WALL); g.grid.setTerrain(2, 5, T.WALL); g.grid.setTerrain(1, 5, T.WALL);
        const r = cast(g); expect(r.reflections[0]?.creature).toBe(guardian); expect(r.hits.some(h => h.creature === g.player)).toBe(true);
        expect(r.landingPos).toEqual({ x: 2, y: 5 }); expect(layer(g, 1)).toBe(T.WALL); expect(g.player.hp).toBe(g.player.maxHp);
    });
    it('TM_REFLECTS_BOLTS crystal walls use the existing terrain reflection, with bounded repeated bounces', () => {
        const g = scene(); g.grid.setTerrain(7, 5, T.CRYSTAL_WALL); g.grid.setTerrain(3, 5, T.CRYSTAL_WALL);
        vi.spyOn(reflection, 'randomReflectionOffset').mockReturnValue({ x: -5, y: 0 });
        const r = cast(g, 2); expect(r.reflections.length).toBeGreaterThan(0); expect(r.path.length).toBeLessThanOrEqual(DCOLS * 10);
    });
    it('DF rubble activates a dormant embedded turret before the tunnel kills it; ordinary creatures survive', () => {
        const g = scene(), turret = mon(g, 5, 5, 'arrow_turret'), rat = mon(g, 6);
        turret.isDormant = true; g.monsters = [rat]; g.dormantMonsters = [turret]; g.grid.setTerrain(5, 5, T.WALL);
        const awake = vi.fn(() => { turret.isDormant = false; g.monsters.push(turret); g.dormantMonsters = []; });
        setDormantAwakener(g.grid, awake); cast(g, 2, { x: 6, y: 5 }, 2);
        expect(awake).toHaveBeenCalled(); expect(turret.hp).toBe(0); expect(rat.hp).toBe(100);
        expect(g.grid.getCell(5, 5)!.layers[L.SURFACE]).toBe(T.RUBBLE);
    });
    it('embedded captives are released before terrain opens; exposed captives stay captive', () => {
        const g = scene(), embedded = mon(g, 5), exposed = mon(g, 6); embedded.isCaged = exposed.isCaged = true;
        g.grid.setTerrain(5, 5, T.WALL); const release = vi.spyOn(g, 'freeCaptive'); cast(g, 2, { x: 6, y: 5 }, 2);
        expect(release).toHaveBeenCalledExactlyOnceWith(embedded); expect(embedded.isAlly).toBe(true); expect(exposed.isCaged).toBe(true);
    });
    it('new corridor connects navigation immediately and refreshes waypoint/loop/safety/auto-travel caches', () => {
        const g = scene(); for (let y = 1; y < DROWS - 1; y++) g.grid.setTerrain(7, y, T.WALL);
        const pass = (x: number, y: number) => g.grid.getCell(x, y)?.isPassable ?? false;
        expect(Pathfind.findPath(g.grid, 4, 5, 9, 5, pass)).toBeNull();
        g.rebuildWaypoints(); const oldMaps = g.waypoints.distanceMaps;
        g.loopMap = []; g.updatedSafetyMapThisTurn = true; g.autoPath = [{ x: 6, y: 5 }]; (g as any).isMouseTraveling = true;
        const wp = vi.spyOn(g, 'rebuildWaypoints'); cast(g, 2, { x: 9, y: 5 }, 6);
        expect(Pathfind.findPath(g.grid, 4, 5, 9, 5, pass)).not.toBeNull();
        expect(wp).toHaveBeenCalledOnce(); expect(g.waypoints.distanceMaps).not.toBe(oldMaps);
        expect(g.waypoints.distanceMaps.some(map => map[4]![5]! < 30000 && map[9]![5]! < 30000)).toBe(true);
        expect(g.loopMap).toEqual(analyzeLoopMap(g.grid)); expect(g.updatedSafetyMapThisTurn).toBe(false);
        expect(g.autoPath).toEqual([]); expect((g as any).isMouseTraveling).toBe(false); expect((g as any).updateVision).toHaveBeenCalled();
    });
    it('blueprint ownership/rollback shares flags with the runtime grid, including a replacement set', () => {
        const g = scene(), engine = new BlueprintEngine(g.grid, 5);
        (engine as any).impregnableCells.add(5 * DCOLS + 5); expect(g.grid.isImpregnable(5, 5)).toBe(true);
        const backup = (engine as any).backupLevel(); (engine as any).impregnableCells.add(6 * DCOLS + 5);
        (engine as any).restoreLevel(backup); expect(g.grid.isImpregnable(5, 6)).toBe(false); expect(g.grid.isImpregnable(5, 5)).toBe(true);
        expect(new BlueprintEngine(g.grid, 5).isImpregnable(5, 5)).toBe(true);
    });
    it('runtime detonation consumes waypoint shuffle RNG; generation/revisit callers retain isolation', () => {
        const g = scene(), source = item();
        const beforeGeneration = rng.randomNumbersGenerated;
        g.rebuildWaypoints(); expect(rng.randomNumbersGenerated).toBe(beforeGeneration);
        const beforeCast = rng.randomNumbersGenerated;
        const rebuild = vi.spyOn(g, 'rebuildWaypoints');
        // Open first step, bounded to one cell: no tunnel DF, repair or reflection
        // random calls. CE still rebuilds waypoints at detonation on a miss.
        g.zapBoltFromPlayer({ ...TUNNEL, maxRange: 1 }, source, { x: 5, y: 5 });
        expect(rebuild).toHaveBeenCalledExactlyOnceWith(true);
        expect(rng.randomNumbersGenerated - beforeCast).toBe(DCOLS * DROWS - 1);
    });
    it('current flags round-trip through a real snapshot; legacy saves clear flags instead of retaining another map', () => {
        const g = createHeadlessGame(13013, 'test'); protect(g, 5); const snapshot = g.toSnapshot();
        expect(snapshot.impregnableCells).toContain(5 * DCOLS + 5); g.loadSnapshot(snapshot); expect(g.grid.isImpregnable(5, 5)).toBe(true);
        delete snapshot.impregnableCells; g.loadSnapshot(snapshot); expect(g.grid.impregnableCells.size).toBe(0);
    });
    it('W-25 exposes tunneling as an item with its existing effect', () => {
        expect(getBoltForItem('staff_of_tunneling')?.effect).toBe(BoltEffect.TUNNELING); expect(ItemLoader.staffs.some(i => i.id === 'staff_of_tunneling')).toBe(true);
    });
});
