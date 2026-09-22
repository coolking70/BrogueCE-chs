import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import data from '../data/blueprints.json';
import monsters from '../data/monsters.json';
import { Architect, DUNGEON_PROFILE_CATALOG as profiles, type DungeonProfileId } from '../engine/Generator/Architect';
import { BlueprintEngine, blueprintQualifies, type BlueprintDef, type MachineResult } from '../engine/Generator/BlueprintEngine';
import { Grid, TerrainType as C, DungeonLayer as L, DCOLS, DROWS, TERRAIN_HOME_LAYER, DRAW_PRIORITY } from '../engine/Map/Grid';
import { addLoopsToWorkGrid } from '../engine/Map/LoopMap';
import { terrainAllowsMove } from '../engine/Map/Connectivity';
import * as loopMap from '../engine/Map/LoopMap';
import { createEmptyRoomGrid } from '../engine/Generator/RoomBuilder';
import { DUNGEON_FEATURE_CATALOG as D, DF, DF_MISSING_TILES } from '../engine/Map/DungeonFeatureCatalog';
import { TERRAIN_FLAGS as T, T_CAUSES_NAUSEA, TM_STAND_IN_TILE, TM_GAS_DISSIPATES_QUICKLY, TM_VANISHES_UPON_PROMOTION, TM_VISUALLY_DISTINCT } from '../engine/Map/TerrainCatalog';
import { catalogFeature } from '../engine/Map/DungeonFeature';
import { promoteTile, resolveDFName, runPromotionUpdate } from '../engine/Map/Promotion';
import { LightKind } from '../engine/Map/LightCatalog';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';
import type { DungeonProfile, Pos } from '../types';

const bp = (id: number) => (data as BlueprintDef[]).find(b => b.ceBlueprintId === id)!;
const key = (x: number, y: number) => y * DCOLS + x;
const nb4 = [[0,-1],[0,1],[-1,0],[1,0]] as const;
type Room = { cells: Pos[]; center: Pos; door: Pos };
type PrivateArchitect = { attachRooms(w: number[][], p: DungeonProfile, attempts: number, max: number): void };
type PrivateEngine = { applyBlueprint(b: BlueprintDef, r: Room): MachineResult | null; expandMachineInterior(s: Set<number>, n: number): void };

function roomGrid(): { grid: Grid; room: Room; interior: Set<number> } {
    const grid = new Grid(DCOLS,DROWS), cells: Pos[] = [];
    for (let x=0;x<DCOLS;x++) for(let y=0;y<DROWS;y++) grid.setTerrain(x,y,C.GRANITE);
    // 150 cells including the gate, within both CE size ranges before MAXIMIZE.
    for(let x=10;x<25;x++) for(let y=10;y<20;y++) { cells.push({x,y}); grid.setTerrain(x,y,C.FLOOR); }
    for(let x=2;x<10;x++) grid.setTerrain(x,15,C.FLOOR);
    const room = { cells, center:{x:17,y:15}, door:{x:10,y:15} };
    return { grid,room,interior:new Set(cells.map(p=>key(p.x,p.y))) };
}
function flood(grid: Grid, origin: Pos): Set<number> {
    const seen = new Set([key(origin.x,origin.y)]), q=[origin];
    for(let i=0;i<q.length;i++) for(const [dx,dy] of nb4) {
        const p={x:q[i]!.x+dx,y:q[i]!.y+dy}, k=key(p.x,p.y);
        const c=grid.getCell(p.x,p.y);
        if(!c || seen.has(k) || !c.layers.every(terrainAllowsMove)) continue;
        seen.add(k); q.push(p);
    }
    return seen;
}

describe('V-2b-9d CE profiles, blueprint rows and closed terrain chains',()=>{
    it('both headers and all 19 features match CE including item/monster aliases and literal flags',()=>{
        // Wrong category, profile, bounds, aliases, any omitted feature/flag/item column goes red.
        const ce=readFileSync(new URL('../../../BrogueCE-master/src/variants/GlobalsBrogue.c',import.meta.url),'utf8').split('\n');
        for(const [id,line,count] of [[13,264,9],[14,275,10]]) {
            const b=bp(id!);
            const h=ce[line!]!.match(/\{(\d+),\s*(\d+)\},\s*\{(\d+),\s*(\d+)\},\s*(\d+),\s*(\d+),\s*(\w+),\s*\(([^)]+)\)/)!;
            expect([b.name,b.depthRange,b.roomSize,b.frequency,b.features.length,b.category,b.dungeonProfile,b.flags]).toEqual([
                ce[line!-1]!.split('"')[1],[+h[1]!,+h[2]!],[+h[3]!,+h[4]!],+h[5]!,+h[6]!,'reward',h[7],h[8]!.split(/\s*\|\s*/)]);
            for(let i=0;i<count!;i++) {
                const row=ce[line!+1+i]!.match(/\{(\w+),\s*(\w+),\s*(\w+),\s*\{(\d+),\s*(\d+)\},\s*(\d+),\s*(\([^)]*\)|\w+),\s*(-?\w+),\s*(\w+),\s*(\d+),\s*(\w+),\s*(\([^)]*\)|\w+),\s*(\([^)]*\)|\w+)/)!;
                expect(row).not.toBeNull();
                const optional=(s:string)=>s==='0'?undefined:s;
                const flags=(s:string)=>s==='0'?[]:s.replace(/[()]/g,'').split(/\s*\|\s*/);
                const monster=optional(row[9]!)?.replace('MK_','').toLowerCase();
                const alias:Record<string,string>={goblin_chieftan:'goblin_warlord',guardian:'stone_guardian'};
                const f=b.features[i]!;
                expect([f.featureDF,f.terrain,f.layer,f.instanceCount,f.minimumInstanceCount,f.itemCategory,f.itemId,f.monsterId,f.personalSpace,f.hordeFlags,f.itemFlags,f.flags])
                    .toEqual([optional(row[1]!),optional(row[2]!),optional(row[3]!),[+row[4]!,+row[5]!],+row[6]!,
                        optional(row[7]!)?.replace(/[()\s]/g,''),({SCROLL_ENCHANTING:'scroll_of_enchantment',POTION_LIFE:'potion_of_life'} as Record<string,string>)[row[8]!],
                        monster?(alias[monster]??monster):undefined,+row[10]!,optional(row[11]!)?[row[11]]:undefined,row[12]==='0'?undefined:flags(row[12]!),flags(row[13]!)]);
                if(f.monsterId) expect(monsters.some(m=>m.id===f.monsterId),f.monsterId).toBe(true);
            }
            expect(blueprintQualifies(b,b.depthRange[0],['BP_REWARD'])).toBe(true);
            expect(blueprintQualifies(b,b.depthRange[0]-1,['BP_REWARD'])).toBe(false);
            expect(blueprintQualifies(b,b.depthRange[1]+1,['BP_REWARD'])).toBe(false);
        }
        expect(profiles.DP_GOBLIN_WARREN).toEqual({roomFrequencies:[0,0,1,0,0,0,0,0],corridorChance:0});
        expect(profiles.DP_SENTINEL_SANCTUARY).toEqual({roomFrequencies:[0,5,0,1,0,0,0,0],corridorChance:0});
        expect((data as BlueprintDef[]).filter(b=>b.flags.includes('BP_MAXIMIZE_INTERIOR')).map(b=>b.ceBlueprintId)).toEqual([13,14]);
        for(const id of [65,66]) expect(bp(id).frequency).toBe(0); // Existing 9b quarantine, untouched this round.
    });

    it('recurses every feature terrain, DF tile, propagation terrain, successor and promote/fire edge',()=>{
        // A missing smoke/glyph carrier or a deferred normal/fire promotion is detected before generation.
        const todo: DF[]=[], terrains=new Set<C>(), dfs=new Set<DF>();
        const terrain=(t:C)=>{
            if(terrains.has(t))return; terrains.add(t);
            for(const name of [T[t].promoteType,T[t].fireType]) {
                if(!name)continue;
                const d=resolveDFName(name);expect(d,name).not.toBeNull();todo.push(d!);
            }
        };
        for(const b of [bp(13),bp(14)])for(const f of b.features) {
            if(f.terrain)terrain(C[f.terrain as keyof typeof C]);
            if(f.featureDF)todo.push(resolveDFName(f.featureDF)!);
        }
        while(todo.length) {
            const d=todo.pop()!;if(dfs.has(d))continue;dfs.add(d);
            const e=D[d]!;expect(e,DF[d]).toBeDefined();expect(DF_MISSING_TILES).not.toContain(d);
            expect(()=>catalogFeature(d)).not.toThrow();expect(e.tile).not.toBeNull();terrain(e.tile!);
            if(e.cePropagationTerrain){expect(e.propagationTerrain).not.toBeNull();terrain(e.propagationTerrain!);}
            if(e.subsequentDF!==null)todo.push(e.subsequentDF);
        }
        expect([...terrains]).toEqual(expect.arrayContaining([C.MACHINE_GLYPH_INACTIVE,C.STENCH_SMOKE_GAS]));
        for(const t of terrains)for(const fire of [false,true]) {
            const g=new Grid(9,9),l=TERRAIN_HOME_LAYER[t];g.setTerrainLayer(4,4,l,t);
            expect(promoteTile(g,4,4,l,fire).deferred,`${C[t]} fire=${fire}`).toBeNull();
        }
    });

    it('glyph re-arms and mud smolders to gas + EMBERS with literal CE fields',()=>{
        // Detects inactive glyph stuck forever, missing light/nausea/dissipation, and old :930/P L A I N_FIRE miscopy.
        const glyph=T[C.MACHINE_GLYPH_INACTIVE],gas=T[C.STENCH_SMOKE_GAS];
        expect([glyph.flags,glyph.mechFlags,glyph.promoteChance,glyph.promoteType,glyph.glowLight,DRAW_PRIORITY[C.MACHINE_GLYPH_INACTIVE]])
            .toEqual([0,TM_VANISHES_UPON_PROMOTION|TM_VISUALLY_DISTINCT,10000,'DF_ACTIVE_GLYPH',LightKind.GLYPH_LIGHT_BRIGHT,42]);
        expect([gas.flags,gas.mechFlags,gas.chanceToIgnite,gas.fireType,DRAW_PRIORITY[C.STENCH_SMOKE_GAS],TERRAIN_HOME_LAYER[C.STENCH_SMOKE_GAS]])
            .toEqual([T_CAUSES_NAUSEA,TM_STAND_IN_TILE|TM_GAS_DISSIPATES_QUICKLY,0,'DF_GAS_FIRE',35,L.GAS]);
        expect([D[DF.DF_STENCH_SMOLDER]!.ceLine,D[DF.DF_STENCH_SMOLDER]!.subsequentDF,DF.DF_ACTIVE_GLYPH]).toEqual([931,DF.DF_EMBERS,90]);
        const g=new Grid(9,9);g.setTerrain(4,4,C.MACHINE_GLYPH);
        expect(promoteTile(g,4,4,L.DUNGEON,false).deferred).toBeNull();expect(g.getCell(4,4)!.terrain).toBe(C.MACHINE_GLYPH_INACTIVE);
        runPromotionUpdate(g,{keyOnTileAt:()=>false});expect(g.getCell(4,4)!.terrain).toBe(C.MACHINE_GLYPH);
        g.setTerrain(4,4,C.MUD_FLOOR);promoteTile(g,4,4,L.DUNGEON,true);
        expect(g.getCell(4,4)!.layers[L.GAS]).toBe(C.STENCH_SMOKE_GAS);
        expect(g.getCell(4,4)!.volume).toBe(50);expect(g.getCell(4,4)!.layers[L.SURFACE]).toBe(C.EMBERS);
    });
});

describe('V-2b-9d redesign algorithm, not a floor fill',()=>{
    it('scratch shields the exterior cell, records the first interior neighbor, uses 40/40 and reconnects >20 orphans',()=>{
        // Catches task §3's mistaken interior=-1, origin=0, 35/35, 20-entry truncation, missing reconnection/clearing/shrink.
        const {grid,room,interior}=roomGrid();
        for(let x=10;x<25;x++) {grid.setTerrain(x,9,C.FLOOR);grid.setTerrain(x,20,C.SECRET_DOOR);}
        for(const k of interior) {
            const x=k%DCOLS,y=Math.floor(k/DCOLS);
            grid.setTerrainLayer(x,y,L.SURFACE,C.BLOOD);grid.setTerrainLayer(x,y,L.GAS,C.POISON_GAS);
            grid.setTerrainLayer(x,y,L.LIQUID,C.WATER_SHALLOW);
        }
        const arch=new Architect(grid);
        const attach=vi.spyOn(arch as unknown as PrivateArchitect,'attachRooms').mockImplementation((work,profile,attempts,max)=>{
            expect([attempts,max]).toEqual([40,40]);expect(profile).toEqual(profiles.DP_GOBLIN_WARREN);
            expect(work[10]![15]).toBe(1);expect(work[12]![9]).toBe(-1);expect(work[12]![10]).toBe(0);
            expect(work[9]![15]).toBe(1); // Adjacent only to origin: no orphan shield.
        });
        arch.redesignInterior(interior,room.door,'DP_GOBLIN_WARREN');attach.mockRestore();
        const reached=flood(grid,room.door);
        for(let x=10;x<25;x++)for(const y of [10,19]) {expect(interior.has(key(x,y))).toBe(true);expect(reached.has(key(x,y))).toBe(true);}
        expect(interior.size).toBeLessThan(room.cells.length);
        for(const p of room.cells) {
            const c=grid.getCell(p.x,p.y)!;
            expect(c.layers[L.SURFACE]).toBe(C.NOTHING);expect(c.layers[L.GAS]).toBe(C.NOTHING);expect(c.layers[L.LIQUID]).toBe(C.WATER_SHALLOW);
            expect(c.layers[L.DUNGEON]).toBe(interior.has(key(p.x,p.y))?C.FLOOR:C.GRANITE);
        }
        expect(grid.getCell(12,20)!.layers[L.DUNGEON]).toBe(C.SECRET_DOOR);
    });

    it('scratch loops keep -1 barriers impassable and never turn them into door candidates',()=>{
        // Old costMap nonzero=>1 silently sees a short path through forbidden film and fails to open this loop.
        const w=createEmptyRoomGrid();for(const col of w)col.fill(-1);
        w[10]![10]=1;w[12]![10]=1;w[11]![10]=0;
        rng.seedRandomGenerator(9);addLoopsToWorkGrid(w,10);
        expect(w[11]![10]).toBe(2);expect(w[11]![11]).toBe(-1);
    });

    it('an exterior notch records only its first NB4 neighbor and loops use distance 10',()=>{
        // Catches recording every neighboring interior cell, changing NB4 tie order,
        // shielding the interior instead of exterior, or calling the dungeon loop threshold 20.
        const {grid,room,interior}=roomGrid();
        interior.delete(key(13,13)); // Exterior floor with four interior neighbors.
        const arch=new Architect(grid);
        const attach=vi.spyOn(arch as unknown as PrivateArchitect,'attachRooms').mockImplementation(()=>{});
        const loops=vi.spyOn(loopMap,'addLoopsToWorkGrid');
        try {
            arch.redesignInterior(interior,room.door,'DP_GOBLIN_WARREN');
            expect(loops).toHaveBeenCalledExactlyOnceWith(expect.any(Array),10);
            expect(interior.has(key(13,12))).toBe(true); // UP is the only recorded neighbor.
            expect(interior.has(key(13,14))).toBe(false);
            expect(interior.has(key(14,13))).toBe(false);
            expect(grid.getCell(13,13)!.terrain).toBe(C.FLOOR); // Exterior untouched.
        } finally { attach.mockRestore();loops.mockRestore(); }
    });

    it.each(['DP_GOBLIN_WARREN','DP_SENTINEL_SANCTUARY'] as DungeonProfileId[])('%s builds separated rooms with its unadjusted room-type distribution',profile=>{
        // A no-op, all-FLOOR fill, wrong profile/depth adjustment, omitted attach or shrink fails geometry/draw assertions.
        for(const seed of [1,42,777,31337]) {
            const {grid,room}=roomGrid(),interior=new Set<number>();
            for(let x=10;x<60;x++)for(let y=3;y<DROWS-2;y++) {interior.add(key(x,y));grid.setTerrain(x,y,C.FLOOR);}
            const arch=new Architect(grid);rng.seedRandomGenerator(seed);
            arch.redesignInterior(interior,room.door,profile);
            expect(arch.roomsBuilt).toBeGreaterThan(1);expect(arch.hallwayRoomsBuilt).toBe(0);
            expect(arch.roomTypeDraws.reduce((a,b)=>a+b,0)).toBe(40);
            for(let t=0;t<8;t++)if(!profiles[profile].roomFrequencies[t])expect(arch.roomTypeDraws[t]).toBe(0);
            expect(interior.size).toBeGreaterThan(30);expect(interior.size).toBeLessThan(50*(DROWS-5)-50);
            const reached=flood(grid,room.door);
            expect([...interior].filter(k=>!reached.has(k)).map(k=>[k%DCOLS,Math.floor(k/DCOLS)]),`seed=${seed}, profile=${profile}`).toEqual([]);
            expect(grid.getCell(room.door.x,room.door.y)!.terrain).toBe(C.FLOOR);
        }
    });

    it('MAXIMIZE wins over OPEN; OPEN alone still uses four neighbors',()=>{
        // Incorrect flag predicate or OPEN precedence fails the production call parameter check.
        for(const [flags,n] of [[['BP_ROOM','BP_MAXIMIZE_INTERIOR','BP_OPEN_INTERIOR'],1],[['BP_ROOM','BP_OPEN_INTERIOR'],4]] as const) {
            const {grid,room}=roomGrid(),engine=new BlueprintEngine(grid,10,[]);
            const spy=vi.spyOn(engine as unknown as PrivateEngine,'expandMachineInterior');
            const b:BlueprintDef={id:'probe',name:'probe',category:'reward',depthRange:[1,26],roomSize:[1,200],frequency:1,flags:[...flags],features:[]};
            expect((engine as unknown as PrivateEngine).applyBlueprint(b,room)).not.toBeNull();
            expect(spy).toHaveBeenCalledExactlyOnceWith(expect.any(Set),n);spy.mockRestore();
        }
    });

    it.each([13,14])('CE %i really builds, materializes reachable rewards and preserves the shrunken machine-cell contract',id=>{
        // Missing integration, original room-cell reuse, wrong item/monster alias, rubble over rewards or failure to spawn goes red.
        let built:MachineResult|null=null,grid:Grid|null=null;
        for(let seed=1;seed<=20&&!built;seed++) {
            const stage=roomGrid();grid=stage.grid;rng.seedRandomGenerator(seed);
            built=(new BlueprintEngine(grid,12,[bp(id)]) as unknown as PrivateEngine).applyBlueprint(bp(id),stage.room);
        }
        expect(built,`CE ${id} must build with its literal feature minima`).not.toBeNull();
        const b=built!,g=createHeadlessGame(123,'test');g.grid=grid!;g.depth=12;g.items=[];g.monsters=[];g.dormantMonsters=[];
        const reached=flood(grid!,b.door!);
        const reward=b.itemSpawns.find(i=>['scroll_of_enchantment','potion_of_life'].includes(i.id??''));expect(reward).toBeDefined();
        for(const item of b.itemSpawns)expect(reached.has(key(item.pos.x,item.pos.y)),JSON.stringify(item)).toBe(true);
        for(const p of b.cells){expect(grid!.getCell(p.x,p.y)!.machineNumber).toBe(b.machineNumber);expect(grid!.getCell(p.x,p.y)!.layers[L.DUNGEON]).not.toBe(C.GRANITE);}
        (g as unknown as {populateLevel(d:number,up:boolean,first:boolean,m:MachineResult[]):void}).populateLevel(12,false,true,[b]);
        expect(g.items.some(i=>(i as unknown as {consumableId?:string}).consumableId===reward!.id&&i.loc.x===reward!.pos.x&&i.loc.y===reward!.pos.y)).toBe(true);
        expect(g.monsters.filter(m=>m.machineHome===b.machineNumber).length).toBeGreaterThanOrEqual(id===13?6:15);
        expect(g.monsters.some(m=>m.machineHome===b.machineNumber&&m.name===ItemLoader.translateName(id===13?'Goblin warlord':'Stone guardian'))).toBe(true);
        // Use item location and actual pickup; no synthetic item insertion.
        g.player.loc={...reward!.pos};g.handlePlayerAction('pickup');
        expect(g.items.some(i=>(i as unknown as {consumableId?:string}).consumableId===reward!.id&&i.loc.x===reward!.pos.x&&i.loc.y===reward!.pos.y)).toBe(false);
        expect(flood(grid!,reward!.pos).has(key(b.door!.x,b.door!.y))).toBe(true);
    });
});
