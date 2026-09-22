import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import data from '../data/blueprints.json';
import { BlueprintEngine, blueprintQualifies, type BlueprintDef, type MachineResult } from '../engine/Generator/BlueprintEngine';
import { DCOLS, DROWS, Grid, DungeonLayer, TerrainType as T } from '../engine/Map/Grid';
import { levelIsDisconnectedWithBlockingMap, createSpawnMap } from '../engine/Map/DungeonFeature';
import { AUTO_GENERATOR_CATALOG, RETIRED_AUTOGENERATOR_MACHINES, runAutogenerators } from '../engine/Map/AutoGenerator';
import { Game } from '../engine/Core/Game';
import { createHeadlessGame, terrainFingerprint } from './harness';
import { rng } from '../engine/Random';
import { exposeTileToFire } from '../engine/Map/Promotion';
import { terrainAllowsMove } from '../engine/Map/Connectivity';
import type { Pos } from '../types';

// Independently transcribed from GlobalsBrogue.c:233–238, before adding the row.
const CE8: BlueprintDef = {
    "id": "reward_outsourced_item",
    "ceBlueprintId": 8,
    "name": "Outsourced item -- same item possibilities as in the good permanent item reward room (plus charms), but directly adopted by 1-2 key machines.",
    "depthRange": [5, 17],
    "roomSize": [0, 0],
    "frequency": 20,
    "category": "reward",
    "flags": ["BP_REWARD", "BP_NO_INTERIOR_FLAG"],
    "features": [
        {
            "layer": "DUNGEON", "itemCategory": "WEAPON", "instanceCount": [1, 1], "minimumInstanceCount": 1, "personalSpace": 0,
            "itemFlags": ["ITEM_IDENTIFIED", "ITEM_PLAYER_AVOIDS"],
            "flags": ["MF_GENERATE_ITEM", "MF_ALTERNATIVE", "MF_REQUIRE_GOOD_RUNIC", "MF_NO_THROWING_WEAPONS", "MF_OUTSOURCE_ITEM_TO_MACHINE", "MF_BUILD_ANYWHERE_ON_LEVEL"]
        },
        {
            "layer": "DUNGEON", "itemCategory": "ARMOR", "instanceCount": [1, 1], "minimumInstanceCount": 1, "personalSpace": 0,
            "itemFlags": ["ITEM_IDENTIFIED", "ITEM_PLAYER_AVOIDS"],
            "flags": ["MF_GENERATE_ITEM", "MF_ALTERNATIVE", "MF_REQUIRE_GOOD_RUNIC", "MF_OUTSOURCE_ITEM_TO_MACHINE", "MF_BUILD_ANYWHERE_ON_LEVEL"]
        },
        {
            "layer": "DUNGEON", "itemCategory": "STAFF", "instanceCount": [2, 2], "minimumInstanceCount": 2, "personalSpace": 0,
            "itemFlags": ["ITEM_KIND_AUTO_ID", "ITEM_PLAYER_AVOIDS"],
            "flags": ["MF_GENERATE_ITEM", "MF_ALTERNATIVE", "MF_OUTSOURCE_ITEM_TO_MACHINE", "MF_BUILD_ANYWHERE_ON_LEVEL"]
        },
        {
            "layer": "DUNGEON", "itemCategory": "CHARM", "instanceCount": [1, 2], "minimumInstanceCount": 1, "personalSpace": 0,
            "itemFlags": ["ITEM_KIND_AUTO_ID", "ITEM_PLAYER_AVOIDS"],
            "flags": ["MF_GENERATE_ITEM", "MF_ALTERNATIVE", "MF_OUTSOURCE_ITEM_TO_MACHINE", "MF_BUILD_ANYWHERE_ON_LEVEL"]
        }
    ]
};
const SIX = [67, 68, 65, 66, 69, 70];
const SEEDS = [1,2,3,7,42,100,123,456,777,1234,5678,9999,31337,424242,20260913,8675309];
interface Internals {
    grid: Grid;
    fillAreaInterior(bp: BlueprintDef, origin: Pos): Pos[] | null;
    interiorSatisfiesBlockingFlags(bp: BlueprintDef, cells: readonly Pos[]): boolean;
}
function openGrid(): Grid {
    const grid = new Grid(DCOLS, DROWS);
    for (let x=0;x<DCOLS;x++) for (let y=0;y<DROWS;y++) {
        grid.setTerrain(x,y,x>0 && y>0 && x<DCOLS-1 && y<DROWS-1 ? T.FLOOR : T.GRANITE);
    }
    return grid;
}
afterEach(() => vi.restoreAllMocks());

describe('V-2b-9e-2 empty interior preflight', () => {
    // Kills zero -> one clamping, [] -> failure, or an unconditional blocking requirement.
    it('empty interior grows to [], has no blocking region, and is accepted without inventing cells', () => {
        const grid = openGrid(), engine = new BlueprintEngine(grid,10,[CE8]);
        const i = engine as unknown as Internals;
        expect(i.fillAreaInterior(CE8,{x:10,y:10})).toEqual([]);
        expect(levelIsDisconnectedWithBlockingMap(grid,createSpawnMap(grid),true)).toBe(0);
        expect(i.interiorSatisfiesBlockingFlags(CE8,[])).toBe(true);
        expect(i.interiorSatisfiesBlockingFlags({...CE8,flags:['BP_REQUIRE_BLOCKING']},[])).toBe(false);
    });
    // Real area/feature/outsourcing code, including all four alternatives. The
    // synthetic child only removes rare key-machine geometry from this probe.
    it('empty interior supports full-level candidates, 1–2 adopted items, and marker cleanup', () => {
        const categories = new Set<string>();
        for (let seed=1;seed<=32;seed++) {
            const grid = openGrid();
            const child: BlueprintDef = {id:'adopter',ceBlueprintId:999,name:'adopter',
                depthRange:[1,26],roomSize:[1,1],frequency:1,category:'key_guard',
                flags:['BP_ADOPT_ITEM'],features:[{instanceCount:[1,1],minimumInstanceCount:1,
                    flags:['MF_BUILD_AT_ORIGIN','MF_ADOPT_ITEM']}]};
            const engine = new BlueprintEngine(grid,10,[CE8,child]);
            rng.seedRandomGenerator(seed);
            const built = engine.buildAMachine(8,[],null,{x:10,y:10});
            expect(built).not.toBeNull();
            expect(built!.cells).toEqual([]); expect(built!.door).toBeNull();
            expect(built!.itemSpawns).toEqual([]);
            const selected = new Set(built!.featureSpawns.map(f=>f.featureIndex));
            expect(selected.size).toBe(1);
            const feature = CE8.features[[...selected][0]!]!;
            categories.add(feature.itemCategory!);
            expect(built!.subMachines.length).toBeGreaterThanOrEqual(feature.minimumInstanceCount!);
            expect(built!.subMachines.length).toBeLessThanOrEqual(feature.instanceCount[1]);
            expect(built!.featureSpawns.length).toBe(built!.subMachines.length);
            for (const sub of built!.subMachines) {
                expect(sub.itemSpawns).toHaveLength(1);
                expect(sub.itemSpawns[0]!.category).toBe(feature.itemCategory);
                expect(sub.itemSpawns[0]!.viaAdoption).toBe(true);
                expect(sub.itemSpawns[0]!.itemQualifiers ?? []).toEqual(feature.flags.filter(f=>
                    ['MF_REQUIRE_GOOD_RUNIC','MF_NO_THROWING_WEAPONS'].includes(f)).sort((a,b)=>
                        ['MF_NO_THROWING_WEAPONS','MF_REQUIRE_GOOD_RUNIC'].indexOf(a)-['MF_NO_THROWING_WEAPONS','MF_REQUIRE_GOOD_RUNIC'].indexOf(b)));
            }
            for (let x=0;x<DCOLS;x++) for(let y=0;y<DROWS;y++)
                expect(grid.getCell(x,y)!.machineNumber).not.toBe(built!.machineNumber);
        }
        expect([...categories].sort()).toEqual(['ARMOR','CHARM','STAFF','WEAPON']);
    });
    // Kills accepting an empty shell after outsourcing failed, or leaking feature markers.
    it('empty interior still fails and rolls back when no child can adopt', () => {
        const grid=openGrid(), engine=new BlueprintEngine(grid,10,[CE8]);
        const before=terrainFingerprint(grid);
        expect(engine.buildAMachine(8,[],null,{x:10,y:10})).toBeNull();
        expect(terrainFingerprint(grid)).toBe(before);
        for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)expect(grid.getCell(x,y)!.machineNumber).toBe(0);
    });
});

interface BlockingRead { ce: number; size: number; value: number; accepted: boolean }
interface BuildTrace { ce: number; reads: BlockingRead[]; result: MachineResult | null }
interface GameInternals {
    populateLevel(depth: number, goingUp: boolean, first: boolean, machines: MachineResult[]): void;
    generateDepth(goingUp: boolean, first: boolean): void;
}

describe('V-2b-9e-2 production census', () => {
    // Kills leaving a carrier disconnected, removing the REQUIRE check, accepting
    // <100, or returning after the first rejected location. Count only committed
    // flattened handoffs: rolled-back children and time-seeded constructor D1
    // must not inflate evidence. Extra connectivity calls consume no RNG.
    it('observes five active forced carriers, CE66 quarantine, blocking retry, and empty rewards', () => {
        const proto=BlueprintEngine.prototype;
        const ip=proto as unknown as Internals;
        const validate=ip.interiorSatisfiesBlockingFlags;
        const build=proto.buildAMachine;
        const stack: BuildTrace[]=[];
        let pending: BuildTrace[]=[];
        let handoff: {machines:MachineResult[]; traces:BuildTrace[]} | null=null;
        vi.spyOn(ip,'interiorSatisfiesBlockingFlags').mockImplementation(function(this: Internals,b,cells) {
            const ok=validate.call(this,b,cells);
            if(b.ceBlueprintId===65 || b.ceBlueprintId===66) {
                const band=createSpawnMap(this.grid);
                for(const p of cells)band[p.y*this.grid.width+p.x]=1;
                const value=levelIsDisconnectedWithBlockingMap(this.grid,band,true);
                expect(ok).toBe(value>=100);
                stack[stack.length-1]!.reads.push({ce:b.ceBlueprintId,size:cells.length,value,accepted:ok});
            }
            return ok;
        });
        vi.spyOn(proto,'buildAMachine').mockImplementation(function(this: BlueprintEngine,...args) {
            const trace:BuildTrace={ce:args[0],reads:[],result:null};
            stack.push(trace);
            try { trace.result=build.apply(this,args); return trace.result; }
            finally { stack.pop(); if(trace.reads.length)pending.push(trace); }
        });
        const gp=Game.prototype as unknown as GameInternals;
        const populate=gp.populateLevel;
        vi.spyOn(gp,'populateLevel').mockImplementation(function(this: GameInternals,...args) {
            handoff={machines:args[3],traces:pending};pending=[];
            return populate.apply(this,args);
        });
        const counts:Record<string,number>={}, levels=[];
        const observations:unknown[]=[];
        const observed=new Set<number>();
        let recovered=0;
        for(const seed of SEEDS) {
            const game=createHeadlessGame(seed);
            for(let depth=1;depth<=26;depth++) {
                if(depth>1) {game.depth=depth;(game as unknown as GameInternals).generateDepth(false,false);}
                const frame=handoff! as {machines:MachineResult[];traces:BuildTrace[]};
                const committed=new Set(frame.machines);
                expect(new Set(frame.machines.map(m=>m.machineNumber)).size).toBe(frame.machines.length);
                for(const m of frame.machines) {
                    counts[m.blueprintId]=(counts[m.blueprintId]??0)+1;
                    const bp=(data as BlueprintDef[]).find(b=>b.id===m.blueprintId)!;
                    if(SIX.includes(bp.ceBlueprintId!))observed.add(bp.ceBlueprintId!);
                    if(bp.ceBlueprintId===8) {
                        expect(m.cells).toEqual([]);expect(m.door).toBeNull();expect(m.itemSpawns).toEqual([]);
                        expect(m.subMachines.length).toBeGreaterThan(0);
                    }
                }
                for(const trace of frame.traces) {
                    const isCommitted=!!trace.result && committed.has(trace.result);
                    if(isCommitted) {
                        expect(trace.reads[trace.reads.length-1]!.accepted).toBe(true);
                        if(trace.reads.some(r=>!r.accepted))recovered++;
                    }
                    observations.push({seed,depth,ce:trace.ce,reads:trace.reads,committed:isCommitted,
                        machine:trace.result?.machineNumber ?? null});
                }
                levels.push({seed,depth,machines:frame.machines.map(m=>({id:m.blueprintId,category:m.category,number:m.machineNumber})),
                    fp:terrainFingerprint(game.grid),n:game.monsters.length,
                    species:[...new Set(game.monsters.map(m=>m.name))].sort().join(','),items:game.items.length});
            }
        }
        if(process.env.V9E2_SCAN_OUTPUT)writeFileSync(process.env.V9E2_SCAN_OUTPUT,
            JSON.stringify({seeds:SEEDS,counts,levels,observations,recovered},null,2)+'\n');
        expect([...observed].sort()).toEqual(SIX.filter(ce=>ce!==66).sort());
        expect(counts.ce_66_environment ?? 0).toBe(0);
        expect(recovered,'must observe <100 rejection followed by a committed bridge').toBeGreaterThan(0);
    },600_000);
});

describe('V-2b-9e-2 catalog and dispatch guards', () => {
    it('transcribes CE 8 exactly and leaves all six forced-only frequencies at zero', () => {
        expect([...RETIRED_AUTOGENERATOR_MACHINES]).toEqual([66]);
        expect(data.find(b=>b.ceBlueprintId===8)).toEqual(CE8);
        expect(data.filter(b=>b.roomSize[0]===0).map(b=>b.ceBlueprintId)).toEqual([8]);
        for(const ce of SIX) {
            const bp=(data as BlueprintDef[]).find(b=>b.ceBlueprintId===ce)!;
            expect(bp.frequency).toBe(0);
        }
        for(let depth=1;depth<=26;depth++)
            expect(blueprintQualifies(CE8,depth,['BP_REWARD'])).toBe(depth>=5 && depth<=17);
    });
    it.each([[16,67,2,6],[23,68,7,39],[44,65,5,39],[45,66,5,39],[46,69,6,39],[48,70,12,39]])(
        'dispatches real index %i to forced CE %i only at depths %i–%i', (index,ce,min,max) => {
            const entry=AUTO_GENERATOR_CATALOG[index!]!;
            expect(entry.carrier).toBe('wired');expect(entry.machine).toBe(ce);
            const seen=new Set<number>();
            // Real catalog and natural scheduler RNG; no rewritten frequency/number formula.
            for(const depth of [min!-1,min!,max!,max!+1]) {
                let count=0;
                for(let seed=1;seed<=32;seed++) {
                    rng.seedRandomGenerator(seed);
                    runAutogenerators(openGrid(),depth,true,AUTO_GENERATOR_CATALOG,m=>{
                        if(m===ce) {count++;seen.add(depth);}return true;
                    });
                }
                expect(count>0).toBe(ce!==66 && (depth===min || depth===max));
            }
            expect([...seen]).toEqual(ce===66 ? [] : [min,max]);
            const callback=vi.fn(()=>true);
            runAutogenerators(openGrid(),min!,false,AUTO_GENERATOR_CATALOG,callback);
            expect(callback).not.toHaveBeenCalled();
        });
    it('quarantines CE66 before RNG while retaining the wired row and literal blueprint', () => {
        const callback=vi.fn(()=>true), grid=openGrid();
        rng.seedRandomGenerator(9);
        const before=rng.randomNumbersGenerated;
        const stats=runAutogenerators(grid,10,true,[AUTO_GENERATOR_CATALOG[0]!,AUTO_GENERATOR_CATALOG[45]!],callback);
        expect(stats.entries).toEqual([]);
        expect(callback).not.toHaveBeenCalled();
        expect(rng.randomNumbersGenerated).toBe(before);
        expect(AUTO_GENERATOR_CATALOG[45]!.carrier).toBe('wired');
        expect(data.find(b=>b.ceBlueprintId===66)!.frequency).toBe(0);
    });
    it('uses dynamic zones beyond CE zoneSizes[200] without byte-sized zone aliases', () => {
        const grid=openGrid(), band=createSpawnMap(grid);
        for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)grid.setTerrain(x,y,T.GRANITE);
        let zones=0;
        for(let x=1;x+2<DCOLS-1;x+=4)for(let y=1;y<DROWS-1;y+=2) {
            for(let dx=0;dx<3;dx++)grid.setTerrain(x+dx,y,T.FLOOR);
            band[y*DCOLS+x+1]=1;zones+=2;
        }
        expect(zones).toBeGreaterThan(200);
        expect(levelIsDisconnectedWithBlockingMap(grid,band,true)).toBe(1);
        expect(levelIsDisconnectedWithBlockingMap(grid,band,false)).toBe(1);
    });
});


describe('V-2b-9e-2 bridge semantics', () => {
    // REQUIRE tests the whole blocked set. It cannot imply each member is a
    // unique passage: either of these two parallel crossings remains usable.
    it('does not confuse an interior cut set with a unique individual bridge', () => {
        const grid=openGrid(), x=Math.floor(DCOLS/2);
        for(let y=1;y<DROWS-1;y++)grid.setTerrain(x,y,T.GRANITE);
        const crossings=[{x,y:5},{x,y:15}];
        for(const p of crossings)grid.setTerrain(p.x,p.y,T.FLOOR);
        const band=createSpawnMap(grid);
        for(const p of crossings)band[p.y*DCOLS+p.x]=1;
        expect(levelIsDisconnectedWithBlockingMap(grid,band,true)).toBeGreaterThanOrEqual(100);
        for(const p of crossings) {
            const single=createSpawnMap(grid);single[p.y*DCOLS+p.x]=1;
            expect(levelIsDisconnectedWithBlockingMap(grid,single,true)).toBe(0);
        }
    });
    // Kills accidentally using the combustible rope bridge for CE65, and
    // verifies the actual fire exposure gate rather than forcing fire promotion.
    it.each([T.STONE_BRIDGE,T.WATER_SHALLOW])('crossing terrain %i is walkable and does not ignite', terrain => {
        const grid=openGrid();grid.setTerrainLayer(10,10,DungeonLayer.LIQUID,terrain);
        const before=[...grid.getCell(10,10)!.layers];
        expect(terrainAllowsMove(terrain)).toBe(true);
        expect(exposeTileToFire(grid,10,10,true).ignited).toBe(false);
        expect(grid.getCell(10,10)!.layers).toEqual(before);
    });
});
