import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Architect } from '../engine/Generator/Architect';
import { BlueprintEngine, blueprintQualifies, type BlueprintDef, type MachineResult } from '../engine/Generator/BlueprintEngine';
import { Grid, DungeonLayer as L, TerrainType as C, DCOLS, DROWS, TERRAIN_HOME_LAYER } from '../engine/Map/Grid';
import { DUNGEON_FEATURE_CATALOG as D, DF, DF_MISSING_TILES } from '../engine/Map/DungeonFeatureCatalog';
import { TERRAIN_FLAGS as T } from '../engine/Map/TerrainCatalog';
import { catalogFeature } from '../engine/Map/DungeonFeature';
import { promoteTile, resolveDFName } from '../engine/Map/Promotion';
import { rng } from '../engine/Random';
import data from '../data/blueprints.json';
import monsters from '../data/monsters.json';
import { createHeadlessGame, terrainFingerprint } from './harness';
import type { Pos } from '../types';

type GameInternals = {
    populateLevel(depth: number, up: boolean, first: boolean, machines: MachineResult[]): void;
    placeStairs(machines: MachineResult[]): boolean;
    generateDepth(up: boolean, first: boolean): void;
    canMoveTo(x: number, y: number): boolean;
};
// Fixed before editing data: C-8's 30 seeds plus the four rolling-baseline seeds.
const SEEDS = [...Array.from({ length: 30 }, (_, i) => i + 1), 424242, 777, 20260913, 31337];
const DIRS = [[0,-1],[0,1],[-1,0],[1,0],[-1,-1],[1,-1],[-1,1],[1,1]] as const;
const bp = (ce: number) => (data as BlueprintDef[]).find(b => b.ceBlueprintId === ce)!;
const sentinelData = monsters.find(m => m.id === 'sentinel')!;
function isSentinel(mon: ReturnType<Game['getMonsterAt']>): boolean {
    // Mutation changes display name (e.g. "grappling Sentinel"). Check stable
    // species data on the actual Monster, never the spawn instruction's id.
    return !!mon && mon.hp > 0 && mon.description === sentinelData.description
        && mon.behaviorFlags.has('MONST_TURRET');
}

function stairsConnected(game: Game): boolean {
    const grid = game.grid;
    let up: Pos | undefined, down: Pos | undefined;
    for (let y=0;y<grid.height;y++) for(let x=0;x<grid.width;x++) {
        const t=grid.getCell(x,y)!.terrain;
        if(t===C.STAIRS_UP) up={x,y};
        if(t===C.STAIRS_DOWN) down={x,y};
    }
    expect(up, 'missing upstairs').toBeDefined();
    // D26 intentionally has no downstairs; it is excluded from the rate.
    if(game.depth===26) return true;
    expect(down, 'missing downstairs').toBeDefined();
    const seen=new Set([up!.y*grid.width+up!.x]), queue=[up!];
    for(let i=0;i<queue.length;i++) for(const [dx,dy] of DIRS) {
        const x=queue[i]!.x+dx,y=queue[i]!.y+dy,k=y*grid.width+x;
        const c=grid.getCell(x,y);
        if(!c || seen.has(k) || !((game as unknown as GameInternals).canMoveTo(x,y) || c.terrain===C.SECRET_DOOR)) continue;
        seen.add(k);queue.push({x,y});
    }
    return seen.has(down!.y*grid.width+down!.x);
}

describe('B2 production census', () => {
    it('observes committed CE71 machines and their actual occupants on 34 seed × D1–D26', () => {
        const handoff=vi.spyOn(Game.prototype as unknown as GameInternals,'populateLevel');
        // U17c: CE prepareForStairs (:3663-3668) also overwrites non-wired
        // statues. Record the real writer; do not accept arbitrary TORCH_WALL.
        const torchOverwrites = new WeakMap<Grid, Set<number>>();
        const prepareStairLoc = Architect.prepareStairLoc;
        const stairs = vi.spyOn(Architect, 'prepareStairLoc').mockImplementation((grid, pos) => {
            const prior: Pos[] = [];
            for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) {
                const p={x:pos.x+dx,y:pos.y+dy};
                if (grid.getCell(p.x,p.y)?.layers[L.DUNGEON] === C.STATUE_INERT) prior.push(p);
            }
            prepareStairLoc(grid,pos);
            for (const p of prior) if (grid.getCell(p.x,p.y)!.layers[L.DUNGEON] === C.TORCH_WALL) {
                let written=torchOverwrites.get(grid);
                if (!written) { written=new Set(); torchOverwrites.set(grid,written); }
                written.add(p.y*grid.width+p.x);
            }
        });
        const levels=[];
        let built=0, realized=0, bad=0;
        try {
            for(const seed of SEEDS) {
                const game=createHeadlessGame(seed);
                for(let depth=1;depth<=26;depth++) {
                    if(depth>1) {game.depth=depth;(game as unknown as GameInternals).generateDepth(false,false);}
                    const call=handoff.mock.calls[handoff.mock.calls.length-1]!;
                    expect(call[0]).toBe(depth);
                    const machines=call[3].filter(m=>m.blueprintId==='ce_71_sentinels');
                    const observations=machines.map(m=>({
                        number:m.machineNumber,
                        spawns:m.monsterSpawns.map(s=>({
                            pos:s.pos, requested:s.monsterId,
                            terrain:game.grid.getCell(s.pos.x,s.pos.y)!.terrain,
                            actual:game.getMonsterAt(s.pos.x,s.pos.y)?.name ?? null,
                            home:game.getMonsterAt(s.pos.x,s.pos.y)?.machineHome ?? null,
                            isSentinel:isSentinel(game.getMonsterAt(s.pos.x,s.pos.y)),
                        })),
                    }));
                    for(const machine of observations) {
                        expect(machine.spawns).toHaveLength(3); // CE71 {3,3}, min 3.
                        expect(new Set(machine.spawns.map(s=>`${s.pos.x},${s.pos.y}`)).size).toBe(3);
                        for(const spawn of machine.spawns) {
                            expect(spawn.isSentinel,'CE71 request exists but living sentinel grid occupant is missing').toBe(true);
                            expect(spawn.home).toBe(machine.number);
                            if (spawn.terrain === C.TORCH_WALL) {
                                const k=spawn.pos.y*game.grid.width+spawn.pos.x;
                                expect(torchOverwrites.get(game.grid)?.has(k),
                                    `seed${seed}/D${depth}: only a recorded stair-preparation write may replace the statue`).toBe(true);
                                expect(game.grid.getCell(spawn.pos.x,spawn.pos.y)!.machineNumber).toBe(0);
                                expect(game.grid.impregnableCells.has(k)).toBe(true);
                            } else if (spawn.terrain !== C.STATUE_INERT) {
                                // CE71 clears its non-wired statue's machine flag.
                                // CE70 runs later and may reuse that wall (:558–575).
                                // Keep the living sentinel/home/three distinct spawns
                                // checks above; require the exact committed overwriter.
                                expect(spawn.terrain).toBe(C.WALL_MONSTER_DORMANT);
                                const ownerIndex = call[3].findIndex(m => m.machineNumber === machine.number);
                                const later = call[3].slice(ownerIndex + 1).filter(m => m.blueprintId === 'area_worm');
                                const overwriter = later.find(m => m.featureSpawns.some(f =>
                                    f.featureIndex === 0 && f.terrain === 'WALL_MONSTER_DORMANT'
                                    && f.pos.x === spawn.pos.x && f.pos.y === spawn.pos.y));
                                expect(overwriter, `seed${seed}/D${depth}: no later CE70 feature explains the changed statue`).toBeDefined();
                                expect(game.grid.getCell(spawn.pos.x, spawn.pos.y)!.machineNumber).toBe(overwriter!.machineNumber);
                                expect(game.dormantMonsters.some(m => m.machineHome === overwriter!.machineNumber
                                    && m.loc.x === spawn.pos.x && m.loc.y === spawn.pos.y)).toBe(true);
                            }
                        }
                    }
                    built+=machines.length;
                    realized+=observations.flatMap(m=>m.spawns).filter(s=>s.isSentinel).length;
                    const connected=stairsConnected(game);if(!connected)bad++;
                    levels.push({seed,depth,connected,machines:observations,
                        fp:terrainFingerprint(game.grid),n:game.monsters.length,
                        species:[...new Set(game.monsters.map(m=>m.name))].sort().join(','),items:game.items.length});
                    handoff.mockClear();
                }
            }
        } finally {handoff.mockRestore();stairs.mockRestore();}
        const result={seeds:SEEDS,built,realized,bad,connectivityLevels:SEEDS.length*25,levels};
        if(process.env.B2_SCAN_OUTPUT)writeFileSync(process.env.B2_SCAN_OUTPUT,JSON.stringify(result,null,2)+'\n');
        expect(levels).toHaveLength(SEEDS.length*26);
        expect(built,'natural CE71 construction coverage').toBeGreaterThan(0);
        expect(realized).toBe(3*built);
        expect(bad).toBe(0);
    });
});

describe('B2 literal transcription and registered deferrals', () => {
    it.each([[31,1,5],[39,0,2],[44,3,2],...[0,1,2,3,4].map(f=>[40,f,2])])(
        'CE %i/F%i has personalSpace %i', (ce, f, space) => {
            expect(bp(ce!).features[f!]!.personalSpace).toBe(space);
        });
    it('retains CE40 F5/F6=1 and fills CE31 hallway flag, CE10 weight, CE71 exact monster id', () => {
        expect(bp(40).features.slice(5).map(f=>f.personalSpace)).toEqual([1,1]);
        expect(bp(31).features[1]!.flags).toEqual([
            'MF_ADOPT_ITEM','MF_FAR_FROM_ORIGIN','MF_TREAT_AS_BLOCKING','MF_NOT_IN_HALLWAY',
        ]);
        expect(bp(10).frequency).toBe(12);
        expect(bp(71).features[0]!.monsterId).toBe('sentinel');
    });
    it('CE55 MAXIMIZE is present while its preexisting engine quarantine remains effective', () => {
        expect(bp(55).flags).toContain('BP_MAXIMIZE_INTERIOR');
        expect(bp(55).frequency).toBe(10);
        for(let depth=8;depth<=26;depth++) expect(blueprintQualifies(bp(55),depth,['BP_ADOPT_ITEM'])).toBe(false);
    });
    it.each([[6,2,DF.DF_MAGIC_PIPING]])(
        'CE %i/F%i starts U17e DF %i; full-room drops consume the generated pipes', (ce,f,df) => {
            // U17e proves the former deferral on HEAD; u_17e_altars exercises
            // full blueprint construction through user drops to inert pipes.
            expect(bp(ce!).features[f!]!.featureDF).toBe(DF[df as DF]);
            expect(DF_MISSING_TILES).not.toContain(df);
            expect(D[df as DF]!.tile).toBe(C.PIPE_GLOWING);
            expect(catalogFeature(df as DF)).toMatchObject({tile:C.PIPE_GLOWING});
        });
    it.each([[7,2,144,C.MACHINE_TRIGGER_FLOOR_REPEATING],[22,0,152,C.TRAP_DOOR],[28,1,152,C.TRAP_DOOR]])(
        'CE %i/F%i now starts the closed U17c DF %i', (ce,f,df,tile) => {
            expect(bp(ce!).features[f!]!.featureDF).toBe(DF[df!]);
            expect(DF_MISSING_TILES).not.toContain(df);
            expect(D[df as DF]!.tile).toBe(tile);
            expect(catalogFeature(df as DF).tile).toBe(tile);
        });
    it('CE15 fungus follows tile, promote/fire, propagation and subsequentDF edges without deferred promotion', () => {
        expect(bp(15).features[0]!.featureDF).toBe('DF_LUMINESCENT_FUNGUS');
        const todo=[DF.DF_LUMINESCENT_FUNGUS], dfs=new Set<DF>(), terrains=new Set<C>();
        const terrain=(t:C) => {
            if(terrains.has(t))return;
            terrains.add(t);
            for(const name of [T[t].promoteType,T[t].fireType]) if(name) {
                const df=resolveDFName(name);expect(df,name).not.toBeNull();todo.push(df!);
            }
        };
        while(todo.length) {
            const df=todo.pop()!;if(dfs.has(df))continue;dfs.add(df);
            const e=D[df]!;expect(e,DF[df]).toBeDefined();
            expect(DF_MISSING_TILES).not.toContain(df);
            expect(()=>catalogFeature(df)).not.toThrow();
            expect(e.tile).not.toBeNull();terrain(e.tile!);
            if(e.cePropagationTerrain) {expect(e.propagationTerrain).not.toBeNull();terrain(e.propagationTerrain!);}
            if(e.subsequentDF!==null)todo.push(e.subsequentDF);
        }
        expect(terrains.has(C.LUMINESCENT_FUNGUS)).toBe(true);
        for(const t of terrains)for(const fire of [false,true]) {
            rng.seedRandomGenerator(222);
            const grid=new Grid(9,9), layer=TERRAIN_HOME_LAYER[t];
            grid.setTerrainLayer(4,4,layer,t);
            expect(promoteTile(grid,4,4,layer,fire).deferred,`${C[t]} fire=${fire}`).toBeNull();
        }
        if(process.env.B2_CLOSURE_OUTPUT)writeFileSync(process.env.B2_CLOSURE_OUTPUT,
            JSON.stringify({dfs:[...dfs].map(d=>DF[d]),terrains:[...terrains].map(t=>C[t])},null,2)+'\n');
    });
});

type Room = { cells: Pos[]; center: Pos; door: Pos | null };
type EngineInternals = { applyBlueprint(b: BlueprintDef, room: Room): MachineResult | null };
function openRoom(): { grid: Grid; room: Room } {
    const grid=new Grid(DCOLS,DROWS),cells:Pos[]=[];
    for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)grid.setTerrain(x,y,C.GRANITE);
    // A genuine 40-cell CE71 interior; enough width for three spaced statues.
    for(let x=10;x<18;x++)for(let y=10;y<15;y++) {grid.setTerrain(x,y,C.FLOOR);cells.push({x,y});}
    for(let x=2;x<10;x++)grid.setTerrain(x,12,C.FLOOR);
    return {grid,room:{cells,center:{x:14,y:12},door:{x:10,y:12}}};
}

describe('B2 layer semantics and CE71 materialization adversary', () => {
    it.each([[16,0],[17,0],[27,0],[27,1]])('CE %i/F%i layer contract and actual production carrier are distinguished', (ce,f) => {
        const feature=bp(ce!).features[f!]!;
        expect(feature.layer).toBe('DUNGEON');
        const t=C[feature.terrain as keyof typeof C];
        // CE Architect.c:1454 writes only pmap.layers[feature->layer].
        const direct=[];
        for(const explicit of [false,true]) {
            const grid=new Grid(9,9);
            grid.setTerrain(4,4,C.FLOOR);
            grid.setTerrainLayer(4,4,L.LIQUID,C.WATER_SHALLOW);
            grid.setTerrainLayer(4,4,L.SURFACE,C.GRASS);
            grid.setTerrainLayer(4,4,L.GAS,C.METHANE_GAS);
            if(explicit)grid.setTerrainLayer(4,4,L.DUNGEON,t);
            else grid.setTerrain(4,4,t);
            direct.push(grid.getCell(4,4)!.layers.slice());
        }
        expect(direct).toEqual([[t,C.NOTHING,C.NOTHING,C.NOTHING],
            [t,C.WATER_SHALLOW,C.METHANE_GAS,C.GRASS]]);
        const outcomes=[];
        for(const explicit of [false,true]) {
            const {grid,room}=openRoom(),pos=room.center;
            grid.setTerrainLayer(pos.x,pos.y,L.LIQUID,C.WATER_SHALLOW);
            grid.setTerrainLayer(pos.x,pos.y,L.SURFACE,C.GRASS);
            grid.setTerrainLayer(pos.x,pos.y,L.GAS,C.METHANE_GAS);
            // Isolate the real feature terrain/layer branch from item outsourcing
            // and CE16's separate legacy doorTerrain pre-write (which also clears).
            const probe:BlueprintDef={id:'layer-probe',name:'layer-probe',depthRange:[1,26],roomSize:[40,40],
                frequency:0,category:'thematic',flags:[],features:[{
                    terrain:feature.terrain,...(explicit?{layer:feature.layer}:{}),
                    instanceCount:[1,1],minimumInstanceCount:1,personalSpace:1,
                    flags:['MF_BUILD_AT_ORIGIN','MF_PERMIT_BLOCKING'],
                }]};
            rng.seedRandomGenerator(222);
            const result=(new BlueprintEngine(grid,12,[]) as unknown as EngineInternals)
                .applyBlueprint(probe,{...room,door:pos});
            expect(result).not.toBeNull();
            outcomes.push(grid.getCell(pos.x,pos.y)!.layers.slice());
        }
        // U04b: both SECRET_DOOR carriers now perform the same real layer write.
        expect(outcomes).toEqual([[t,C.NOTHING,C.NOTHING,C.NOTHING],
            [t,C.WATER_SHALLOW,C.METHANE_GAS,C.GRASS]]);
    });

    it('the same CE71 machine realizes zero sentinels with the old id, and three living grid occupants with the real id', () => {
        const results=[];
        for(const monsterId of ['MK_SENTINEL',bp(71).features[0]!.monsterId!]) {
            const game=createHeadlessGame(222),{grid,room}=openRoom();
            game.grid=grid;game.depth=12;game.monsters=[];game.dormantMonsters=[];game.items=[];
            const blueprint=structuredClone(bp(71));blueprint.features[0]!.monsterId=monsterId;
            rng.seedRandomGenerator(222);
            const machine=(new BlueprintEngine(grid,12,[blueprint]) as unknown as EngineInternals).applyBlueprint(blueprint,room);
            expect(machine,'CE71 construction coverage').not.toBeNull();
            expect(machine!.monsterSpawns).toHaveLength(3);
            // U04 splits placement from population; exercise the real precondition.
            expect((game as unknown as GameInternals).placeStairs([machine!])).toBe(true);
            (game as unknown as GameInternals).populateLevel(12,false,false,[machine!]);
            const actual=machine!.monsterSpawns.map(s=>game.getMonsterAt(s.pos.x,s.pos.y));
            // The same stable species/behavior predicate used by the production census
            // also accepts legitimate mutation prefixes (e.g. reflective Sentinel).
            results.push(actual.filter(isSentinel).length);
            for(const spawn of machine!.monsterSpawns) {
                expect(grid.getCell(spawn.pos.x,spawn.pos.y)!.layers[L.DUNGEON]).toBe(C.STATUE_INERT);
                if(monsterId==='MK_SENTINEL')continue;
                const mon=game.getMonsterAt(spawn.pos.x,spawn.pos.y);
                expect(mon,'spawn directive without an actual grid occupant').toBeDefined();
                expect(isSentinel(mon)).toBe(true);expect(mon!.hp).toBeGreaterThan(0);
                expect(mon!.machineHome).toBe(machine!.machineNumber);
                expect(game.monsters).toContain(mon);expect(game.dormantMonsters).not.toContain(mon);
            }
            expect(stairsConnected(game)).toBe(true);
        }
        expect(results).toEqual([0,3]);
    });
});
