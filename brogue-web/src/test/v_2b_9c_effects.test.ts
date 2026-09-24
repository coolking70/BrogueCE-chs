import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import data from '../data/blueprints.json';
import { BlueprintEngine, blueprintQualifies, type BlueprintDef, type MachineResult } from '../engine/Generator/BlueprintEngine';
import { Grid, DungeonLayer as L, TerrainType as C, DRAW_PRIORITY, TERRAIN_HOME_LAYER, type Cell } from '../engine/Map/Grid';
import { TERRAIN_FLAGS as T, T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_ITEMS, T_OBSTRUCTS_GAS, T_OBSTRUCTS_SURFACE_EFFECTS, T_OBSTRUCTS_EVERYTHING, T_PATHING_BLOCKER, TM_STAND_IN_TILE, TM_VANISHES_UPON_PROMOTION, TM_IS_WIRED, TM_ALLOWS_SUBMERGING, TM_LIST_IN_SIDEBAR } from '../engine/Map/TerrainCatalog';
import { DF, DUNGEON_FEATURE_CATALOG as D, DF_MISSING_TILES, DFF_ACTIVATE_DORMANT_MONSTER } from '../engine/Map/DungeonFeatureCatalog';
import { catalogFeature } from '../engine/Map/DungeonFeature';
import { promoteTile, resolveDFName, runPromotionUpdate } from '../engine/Map/Promotion';
import { LightKind } from '../engine/Map/LightCatalog';
import { getBoltForItem, BoltEffect, type BoltResult, type BoltConfig } from '../engine/Combat/Bolt';
import { createHeadlessGame } from './harness';
import { ItemLoader } from '../engine/Items/ItemLoader';
import type { Item } from '../engine/Items/Item';
import type { Game } from '../engine/Core/Game';
import { Monster, type MonsterData } from '../entities/Monster';
import monsterData from '../data/monsters.json';
import { rng } from '../engine/Random';
import type { Pos } from '../types';

const bp = (id: number) => (data as BlueprintDef[]).find(b => b.ceBlueprintId === id)!;
const activated = [DF.DF_MUD_DORMANT, DF.DF_DARKENING_FLOOR, DF.DF_DARK_FLOOR,
    DF.DF_ECTOPLASM_DROPLET, DF.DF_HAUNTED_TORCH_TRANSITION, DF.DF_HAUNTED_TORCH, DF.DF_ELECTRIC_CRYSTAL_ON];

type Internals = {
    computeBoltResult(bolt: BoltConfig, origin: Pos, target: Pos): BoltResult;
    applyBoltResult(result: BoltResult, item: Item): void;
    populateLevel(depth: number, up: boolean, first: boolean, machines: MachineResult[]): void;
    updateVision(): void;
    canMoveTo(x: number, y: number): boolean;
};
const inside = (g: Game) => g as unknown as Internals;

function stage(): Game {
    const g = createHeadlessGame(0x29c, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, C.FLOOR, '.', 0x888888);
        const c = g.grid.getCell(x, y)!;
        c.machineNumber = 0; c.hasDormantMonster = false;
    }
    g.player.loc = { x: 4, y: 10 };
    return g;
}
function cast(g: Game, effect: BoltEffect, from: Pos, to: Pos): BoltResult {
    const bolt = { ...getBoltForItem('staff_of_lightning')!, effect };
    const result = inside(g).computeBoltResult(bolt, from, to);
    inside(g).applyBoltResult(result, ItemLoader.spawnStaff('staff_of_lightning', from.x, from.y)!);
    return result;
}

// Real CE features, real applyBlueprint, real populateLevel; only site selection is fixed.
function buildStage(id: number): { g: Game; built: MachineResult; key: Item } {
    const g = stage(); g.depth = bp(id).depthRange[0];
    g.levelSeeds[g.depth - 1]!.upStairsLoc = { ...g.player.loc }; // Explicit synthetic generation origin.
    let built: MachineResult | null = null;
    for (let seed = 1; seed <= 30 && !built; seed++) {
        rng.seedRandomGenerator(seed);
        const cells: Pos[] = [];
        for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
            g.grid.setTerrain(x, y, C.GRANITE);
            g.grid.getCell(x, y)!.machineNumber = 0;
        }
        const right = id === 32 ? 24 : 20; // 150 / 90 cells, within literal CE room ranges.
        for (let x = 10; x <= right; x++) for (let y = 7; y <= (id === 32 ? 16 : 14); y++) {
            cells.push({ x, y }); g.grid.setTerrain(x, y, C.FLOOR);
        }
        const door = { x: 9, y: 10 };
        for (let x = 2; x <= 9; x++) g.grid.setTerrain(x, 10, C.FLOOR);
        const engine = new BlueprintEngine(g.grid, g.depth, [bp(id)]);
        built = (engine as unknown as { applyBlueprint(b: BlueprintDef, r: {cells: Pos[]; center: Pos; door: Pos}, ctx: {adoptiveItem: MachineResult['itemSpawns'][number]}): MachineResult | null })
            .applyBlueprint(bp(id), { cells, center: { x: 15, y: 10 }, door }, {
                adoptiveItem: { category: 'KEY', id: 'iron_key', pos: door, keyLoc: [{ loc: { x: 2, y: 10 }, machine: 0, disposableHere: true }] },
            });
    }
    expect(built, `CE #${id} must build on a legal room`).not.toBeNull();
    inside(g).populateLevel(g.depth, false, true, [built!]);
    const key = g.items.find(i => i.keyLoc?.some(k => k.loc.x === 2 && k.loc.y === 10));
    expect(key, 'adopted item must survive final terrain validation and materialize').toBeDefined();
    return { g, built: built!, key: key! };
}

function reachable(g: Game, start: Pos, end: Pos, avoidHazards = false): boolean {
    const q = [start], seen = new Set([`${start.x},${start.y}`]);
    for (let i = 0; i < q.length; i++) {
        const p = q[i]!;
        if (p.x === end.x && p.y === end.y) return true;
        for (const [dx, dy] of [[0,1],[0,-1],[1,0],[-1,0]]) {
            const n = { x: p.x + dx!, y: p.y + dy! }, k = `${n.x},${n.y}`;
            if (seen.has(k) || !g.grid.getCell(n.x, n.y) || !inside(g).canMoveTo(n.x, n.y)) continue;
            if (avoidHazards && g.grid.getCell(n.x,n.y)!.layers.some(t => T[t].flags & T_PATHING_BLOCKER)) continue;
            seen.add(k); q.push(n);
        }
    }
    return false;
}

describe('V-2b-9c CE data and complete promotion closure', () => {
    it('four blueprint rows match every supported CE column; #52 is excluded in engine only', () => {
        // Fails for wrong category/frequency, omitted turret supply, altered CE feature flags/counts.
        const ce = readFileSync(new URL('../../../BrogueCE-master/src/variants/GlobalsBrogue.c', import.meta.url), 'utf8').split('\n');
        for (const [id, line, count] of [[32,383,5],[51,509,3],[52,514,5],[54,531,4]]) {
            const b = bp(id!);
            const head = ce[line!]!.match(/\{(\d+),\s*AMULET_LEVEL\},\s*\{(\d+),\s*(\d+)\},\s*(\d+),\s*(\d+),\s*0,\s*\(([^)]+)\)/)!;
            expect([b.depthRange, b.roomSize, b.frequency, b.features.length, b.category, b.flags]).toEqual([
                [Number(head[1]),26], [Number(head[2]),Number(head[3])], Number(head[4]), Number(head[5]), 'key_guard', head[6]!.split(/\s*\|\s*/),
            ]);
            expect(b.name).toBe(ce[line! - 1]!.split('"')[1]);
            for (let i = 0; i < count!; i++) {
                const row = ce[line! + 1 + i]!.match(/\{(\w+),\s*(\w+),\s*(\w+),\s*\{(\d+),\s*(\d+)\},\s*(\d+),\s*0,\s*-?\d+,\s*(\w+),\s*(\d+),\s*(\w+),\s*0,\s*(\([^)]*\)|\w+)/)!;
                expect(row, `CE row ${line! + 2 + i}`).not.toBeNull();
                const f = b.features[i]!;
                const opt = (s: string | undefined) => s === '0' ? undefined : s;
                const flags = row[10]!.replace(/[()]/g, '');
                expect([f.featureDF,f.terrain,f.layer,f.instanceCount,f.minimumInstanceCount,f.monsterId,f.personalSpace,f.hordeFlags,f.flags])
                    .toEqual([opt(row[1]),opt(row[2]),opt(row[3]),[Number(row[4]),Number(row[5])],Number(row[6]),
                        opt(row[7])?.replace('MK_','').toLowerCase(),Number(row[8]),opt(row[9]) ? [row[9]] : undefined,flags === '0' ? [] : flags.split(/\s*\|\s*/)]);
            }
            expect(blueprintQualifies(b, b.depthRange[0], ['BP_ADOPT_ITEM'])).toBe(id !== 52);
        }
    });

    it('55 retains CE data but cannot consume an adopted key behind unimplemented tunnels', () => {
        // Fails if a generation-stream change exposes the old permanent key enclosure again.
        const tunnels = (data as BlueprintDef[]).find(b => b.id === 'key_worm_tunnels')!;
        expect(tunnels.frequency).toBe(10);
        expect(tunnels.flags).toContain('BP_ADOPT_ITEM');
        expect(tunnels.features.map(f => f.terrain)).toEqual(['ALTAR', undefined, 'GRANITE', 'GRANITE', 'WORM_TUNNEL_OUTER_WALL', 'WALL_LEVER_HIDDEN']);
        expect(blueprintQualifies(tunnels, 19, ['BP_ADOPT_ITEM'])).toBe(false);
    });

    it('seven tiles retain all CE flag, priority, home-layer, chance and light columns', () => {
        // Fails when dark terrain becomes a path blocker, chance is scaled incorrectly, or light omitted.
        const V = TM_VANISHES_UPON_PROMOTION, S = TM_STAND_IN_TILE;
        const cases: Array<[C, number, number, string, number, number, L, LightKind]> = [
            [C.MACHINE_MUD_DORMANT,0,S|V|TM_IS_WIRED|TM_ALLOWS_SUBMERGING,'DF_MUD_ACTIVATE',0,55,L.LIQUID,0],
            [C.DARK_FLOOR_DARKENING,0,V,'DF_DARK_FLOOR',1500,95,L.DUNGEON,0],
            [C.DARK_FLOOR,0,0,'',0,95,L.DUNGEON,LightKind.DARKNESS_CLOUD_LIGHT],
            [C.ECTOPLASM,0,S,'',0,70,L.SURFACE,LightKind.ECTOPLASM_LIGHT],
            [C.HAUNTED_TORCH_TRANSITIONING,T_OBSTRUCTS_EVERYTHING,S|V,'DF_HAUNTED_TORCH',2000,0,L.DUNGEON,LightKind.TORCH_LIGHT],
            [C.HAUNTED_TORCH,T_OBSTRUCTS_EVERYTHING,S,'',0,0,L.DUNGEON,LightKind.HAUNTED_TORCH_LIGHT],
            [C.ELECTRIC_CRYSTAL_ON,T_OBSTRUCTS_PASSABILITY|T_OBSTRUCTS_ITEMS|T_OBSTRUCTS_GAS|T_OBSTRUCTS_SURFACE_EFFECTS,S|TM_LIST_IN_SIDEBAR,'',0,0,L.DUNGEON,LightKind.CRYSTAL_WALL_LIGHT],
        ];
        for (const [t, flags, mech, promote, chance, prio, layer, light] of cases) {
            const e = T[t];
            expect([e.flags,e.mechFlags,e.fireType,e.discoverType,e.chanceToIgnite,e.promoteType,e.promoteChance,DRAW_PRIORITY[t],TERRAIN_HOME_LAYER[t],e.glowLight], C[t])
                .toEqual([flags,mech,'DF_PLAIN_FIRE','',0,promote,chance,prio,layer,light]);
        }
        expect([D[DF.DF_ECTOPLASM_DROPLET]!.ceLine,D[DF.DF_ECTOPLASM_DROPLET]!.startProbability,D[DF.DF_ECTOPLASM_DROPLET]!.probabilityDecrement]).toEqual([673,0,0]);
        expect(D[DF.DF_DARK_FLOOR]!.flags).toBe(DFF_ACTIVATE_DORMANT_MONSTER);
        expect(D[DF.DF_DARK_FLOOR]!.subsequentDF).toBe(DF.DF_ECTOPLASM_DROPLET);
        expect(D[DF.DF_ELECTRIC_CRYSTAL_ON]!.lightFlare).toBe('CHARGE_FLASH_LIGHT');
    });

    it('walks new DF tiles, propagationTerrain, subsequentDF, and reverse promote/fire parents without missing carriers', () => {
        // Fails for a 9b-style half-open gate, including forgotten haunted torch intermediates.
        const todo = [...activated], dfs = new Set<DF>(), terrains = new Set<C>();
        const visitTerrain = (t: C) => {
            if (terrains.has(t)) return;
            terrains.add(t);
            for (const name of [T[t].promoteType,T[t].fireType]) {
                const id = resolveDFName(name); if (id !== null) todo.push(id);
            }
        };
        for (const [t,e] of Object.entries(T)) if ([e.promoteType,e.fireType].some(n => activated.includes(resolveDFName(n)!))) visitTerrain(Number(t));
        while (todo.length) {
            const id = todo.pop()!; if (dfs.has(id)) continue; dfs.add(id);
            const e = D[id]!;
            expect(e, DF[id]).toBeDefined();
            expect(DF_MISSING_TILES, DF[id]).not.toContain(id);
            expect(() => catalogFeature(id), DF[id]).not.toThrow();
            if (e.tile !== null) visitTerrain(e.tile);
            if (e.cePropagationTerrain) { expect(e.propagationTerrain).not.toBeNull(); visitTerrain(e.propagationTerrain!); }
            if (e.subsequentDF !== null) todo.push(e.subsequentDF);
        }
        expect(terrains.has(C.HAUNTED_TORCH_TRANSITIONING)).toBe(true);
        for (const t of terrains) for (const fire of [false,true]) {
            const g = new Grid(9,9), layer = TERRAIN_HOME_LAYER[t];
            g.setTerrainLayer(4,4,layer,t);
            expect(promoteTile(g,4,4,layer,fire).deferred, `${C[t]} fire=${fire}`).toBeNull();
        }
    });
});

describe('V-2b-9c electrical trigger, isolated from turn promotion', () => {
    it('non-electric / off-ray crystals stay off; only the last direct lightning hit releases the cage', () => {
        // Fails if arbitrary bolts promote, turn updates impersonate lightning, circuit breaker is ignored,
        // or the whole machine is activated by the first hit. No turn update or manual promote occurs here.
        const g = stage();
        for (const [x,y,t] of [[10,10,C.ELECTRIC_CRYSTAL_OFF],[10,12,C.ELECTRIC_CRYSTAL_OFF],[14,10,C.ALTAR_CAGE_RETRACTABLE]]) {
            g.grid.setTerrain(x!,y!,t!); g.grid.getCell(x!,y!)!.machineNumber = 71;
        }
        cast(g,BoltEffect.HEALING,{x:4,y:10},{x:20,y:10});
        expect(g.grid.getCell(10,10)!.terrain).toBe(C.ELECTRIC_CRYSTAL_OFF);
        const first = cast(g,BoltEffect.LIGHTNING,{x:4,y:10},{x:20,y:10});
        expect(first.impactPos).toEqual({x:10,y:10});
        expect(g.grid.getCell(10,10)!.terrain).toBe(C.ELECTRIC_CRYSTAL_ON);
        expect(g.grid.getCell(10,12)!.terrain).toBe(C.ELECTRIC_CRYSTAL_OFF);
        expect(g.grid.getCell(14,10)!.terrain).toBe(C.ALTAR_CAGE_RETRACTABLE);
        cast(g,BoltEffect.LIGHTNING,{x:4,y:12},{x:20,y:12});
        expect(g.grid.getCell(10,12)!.terrain).toBe(C.ELECTRIC_CRYSTAL_ON);
        expect(g.grid.getCell(14,10)!.terrain).toBe(C.ALTAR);
    });

    it('a wall stops player electricity; monster SPARK lights the crystal and stops before its target', () => {
        // Fails if terrain behind a wall is exposed, SPARK omitted, or a target behind a crystal is damaged.
        const g = stage();
        g.grid.setTerrain(8,10,C.WALL); g.grid.setTerrain(10,10,C.ELECTRIC_CRYSTAL_OFF);
        cast(g,BoltEffect.LIGHTNING,{x:4,y:10},{x:20,y:10});
        expect(g.grid.getCell(10,10)!.terrain).toBe(C.ELECTRIC_CRYSTAL_OFF);
        g.grid.setTerrain(8,10,C.FLOOR); g.player.loc = {x:14,y:10};
        const turret = new Monster(4,10,(monsterData as unknown as MonsterData[]).find(m => m.id === 'spark_turret')!);
        g.monsters.push(turret);
        const hp = g.player.hp;
        g.castMonsterBolt(turret,g.player,'SPARK');
        expect(g.grid.getCell(10,10)!.terrain).toBe(C.ELECTRIC_CRYSTAL_ON);
        expect(g.player.hp).toBe(hp);
    });
});

describe('V-2b-9c blueprint build -> population -> real pickup', () => {
    it('51 mud horde really wakes on pickup; key and exit remain reachable', () => {
        // Fails if DF_MUD_DORMANT, horde terrain matching, dormancy dispatch, wired pickup or DF awakener is missing.
        const {g,built,key} = buildStage(51);
        const sleeping = g.dormantMonsters.filter(m => m.machineHome === built.machineNumber);
        expect(sleeping.length).toBeGreaterThanOrEqual(3);
        expect(sleeping.length).toBeLessThanOrEqual(4);
        const mudNames = (monsterData as unknown as MonsterData[]).filter(m => ['bog_monster','kraken'].includes(m.id)).map(m => ItemLoader.translateName(m.name));
        for (const m of sleeping) expect(mudNames).toContain(m.name);
        expect(sleeping.every(m => g.grid.getCell(m.loc.x,m.loc.y)!.layers.includes(C.MACHINE_MUD_DORMANT))).toBe(true);
        expect(reachable(g,built.door!,key.loc)).toBe(true);
        g.player.loc = {...key.loc};
        const standing = {...g.player.loc};
        g.handlePlayerAction('pickup',undefined,'system');
        expect(g.items).not.toContain(key);
        expect(g.player.inventory.items).toContain(key);
        expect(g.player.loc).toEqual(standing);
        expect(sleeping.every(m => !g.dormantMonsters.includes(m) && g.monsters.includes(m) && !m.isDormant),
            `9c mud: built=${built.blueprintId}, dormant=${sleeping.length}, awake=${sleeping.filter(m=>!m.isDormant).length}`).toBe(true);
        expect(sleeping.every(m => g.grid.getCell(m.loc.x,m.loc.y)!.layers.includes(C.MUD))).toBe(true);
        expect(reachable(g,g.player.loc,built.door!)).toBe(true);
        expect(g.player.hp).toBeGreaterThan(0);
    });

    it('54 pickup drives darkening, torch transition, ectoplasm and all dormant phantoms', () => {
        // Fails for missing intermediate/terminal tiles, subsequent DF, random promotion driver or population.
        const {g,built,key} = buildStage(54);
        const sleeping = g.dormantMonsters.filter(m => m.machineHome === built.machineNumber);
        expect(sleeping.length).toBeGreaterThanOrEqual(4);
        expect(sleeping.length).toBeLessThanOrEqual(5);
        expect(reachable(g,built.door!,key.loc)).toBe(true);
        g.player.loc = {...key.loc};
        g.handlePlayerAction('pickup',undefined,'system');
        expect(g.player.inventory.items).toContain(key);
        const machineCells: Cell[] = [];
        for (let x=0;x<g.grid.width;x++) for (let y=0;y<g.grid.height;y++) {
            const c = g.grid.getCell(x,y)!;
            if (c.machineNumber === built.machineNumber) machineCells.push(c);
        }
        const has = (t: C) => machineCells.some(c => c.layers.includes(t));
        expect(has(C.DARK_FLOOR_DORMANT)).toBe(false);
        expect(has(C.DARK_FLOOR_DARKENING)).toBe(true);
        for (let turn = 0; turn < 150 && (has(C.DARK_FLOOR_DARKENING) || has(C.HAUNTED_TORCH_TRANSITIONING)); turn++) {
            runPromotionUpdate(g.grid,{keyOnTileAt:()=>false});
        }
        expect(has(C.DARK_FLOOR_DARKENING)).toBe(false);
        expect(has(C.DARK_FLOOR)).toBe(true);
        expect(has(C.ECTOPLASM)).toBe(true);
        expect(has(C.HAUNTED_TORCH)).toBe(true);
        expect(sleeping.every(m => !m.isDormant && g.monsters.includes(m)),
            `9c haunted: dormant=${sleeping.length}, awake=${sleeping.filter(m=>!m.isDormant).length}`).toBe(true);
        expect(reachable(g,g.player.loc,built.door!)).toBe(true);
    });

    it('32 builds literal traps/pools and leaves a route to the altar and out', () => {
        // Fails if high minimum trap count makes construction impossible, or water/traps seal the key.
        const {g,built,key} = buildStage(32);
        expect(inside(g).canMoveTo(built.center.x,built.center.y)).toBe(true);
        expect(built.cells.filter(p => g.grid.getCell(p.x,p.y)!.layers.includes(C.FLAMETHROWER_HIDDEN)).length).toBeGreaterThanOrEqual(20);
        expect(reachable(g,built.door!,key.loc,true)).toBe(true);
        g.player.loc = {...key.loc}; g.handlePlayerAction('pickup',undefined,'system');
        expect(g.player.inventory.items).toContain(key);
        expect(reachable(g,g.player.loc,built.door!,true)).toBe(true);
        expect(g.player.hp).toBeGreaterThan(0);
    });

    it('darkness reduces actual light while leaving the movement graph unchanged', () => {
        // Fails when darkness light is positive/unconsumed or visibility is incorrectly used as collision.
        const g = stage(); g.depth = 20; g.player.loc = {x:15,y:12};
        inside(g).updateVision();
        const before = g.lightMap.lightSumAt(16,12);
        for (let x=12;x<=18;x++) for (let y=9;y<=15;y++) g.grid.setTerrain(x,y,C.DARK_FLOOR);
        inside(g).updateVision();
        expect(g.lightMap.lightSumAt(16,12),
            `9c darkness: before=${before}, after=${g.lightMap.lightSumAt(16,12)}`).toBeLessThan(before);
        expect(inside(g).canMoveTo(16,12)).toBe(true);
        expect(reachable(g,g.player.loc,{x:25,y:12})).toBe(true);
    });
});
