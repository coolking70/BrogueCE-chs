import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import data from '../data/blueprints.json';
import { BlueprintEngine, BP_ADOPT_ITEM, resetMachineCounter, type BlueprintDef, type FeatureDef, type MachineItemSpawn, type MachineResult } from '../engine/Generator/BlueprintEngine';
import { Grid, TerrainType as T, DCOLS, DROWS } from '../engine/Map/Grid';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Architect } from '../engine/Generator/Architect';
import { ItemLoader } from '../engine/Items/ItemLoader';

const ownership = ['MF_ADOPT_ITEM','MF_OUTSOURCE_ITEM_TO_MACHINE','MF_MONSTER_TAKE_ITEM'];
const semantic = [...ownership,'MF_GENERATE_ITEM','MF_GENERATE_HORDE','MF_SKELETON_KEY','MF_KEY_DISPOSABLE','MF_MONSTERS_DORMANT'];
const catalog=data as BlueprintDef[];
function key():MachineItemSpawn { return {instanceId:'parent:key',category:'KEY',id:'iron_key',pos:{x:1,y:1},keyLoc:[{loc:{x:2,y:2},machine:7,disposableHere:true}]}; }
function fixture(features:FeatureDef[], adopt=true) {
    rng.seedRandomGenerator(7); resetMachineCounter();
    const grid=new Grid(DCOLS,DROWS), cells=[];
    for(let x=4;x<44;x++) for(let y=4;y<24;y++){ grid.setTerrain(x,y,T.FLOOR,'.',0x888888);cells.push({x,y}); }
    const engine:any=new BlueprintEngine(grid,12);
    let n=0;
    engine.findFeaturePosition=()=>({x:6+n++%30,y:8+Math.floor(n/30)});
    const bp:BlueprintDef={id:'ownership-fixture',name:'ownership',category:'key',depthRange:[1,26],roomSize:[1,900],frequency:1,flags:adopt?[BP_ADOPT_ITEM]:[],features};
    const room={cells,center:{x:20,y:15},door:null};
    return {engine,grid,bp,room,apply:(item:MachineItemSpawn|null=key())=>engine.applyBlueprint(bp,room,{adoptiveItem:item}) as MachineResult|null};
}
function flatten(r:MachineResult):MachineResult[]{return [r,...r.subMachines.flatMap(flatten)];}
function destinations(r:MachineResult){return flatten(r).flatMap(m=>[...m.itemSpawns,...m.monsterSpawns.flatMap(n=>n.carriedItem?[n.carriedItem]:[])]);}
afterEach(()=>vi.restoreAllMocks());

// Enumerate the authoritative C table, including CE48 (disabled in CE itself).
const ceRows:{ce:number,feature:number,source:string}[]=[];
let ce=0,feature=0,inTable=false;
for(const line of fs.readFileSync('../BrogueCE-master/src/variants/GlobalsBrogue.c','utf8').split('\n')){
    if(line.startsWith('const blueprint blueprintCatalog_Brogue'))inTable=true;
    if(!inTable)continue;
    if(line.startsWith('};'))break;
    if(/^    \{"/.test(line)){ce++;feature=0;}
    if(/^        \{/.test(line)){
        if(ownership.some(f=>line.includes(f)))ceRows.push({ce,feature,source:line});
        feature++;
    }
}

describe('U05a CE feature ownership matrix (spatial/DF algorithms covered by V regression)',()=>{
    it('CE inventory is complete, disabled CE48 remains absent from web pool',()=>{
        expect(ceRows).toHaveLength(41);
        expect(catalog.filter(b=>b.ceBlueprintId===48)).toHaveLength(0);
        const web=catalog.flatMap(b=>b.features.flatMap((f,i)=>ownership.some(k=>f.flags.includes(k))?[`${b.ceBlueprintId}/${i}`]:[]));
        expect(web.sort()).toEqual(ceRows.filter(r=>r.ce!==48).map(r=>`${r.ce}/${r.feature}`).sort());
        for(const row of ceRows.filter(r=>r.ce!==48)){
            const f=catalog.find(b=>b.ceBlueprintId===row.ce)!.features[row.feature]!;
            expect(ownership.filter(k=>f.flags.includes(k))).toEqual(ownership.filter(k=>row.source.includes(k)));
        }
    });
    for(const row of ceRows) it(`CE${row.ce}/F${row.feature}: generation/adoption/outsourcing/carry conserves identity`,()=>{
        const original=catalog.find(b=>b.ceBlueprintId===row.ce)?.features[row.feature]
            ?? {flags:['MF_ADOPT_ITEM'],instanceCount:[1,1] as [number,number],minimumInstanceCount:1};
        // Exercise both count endpoints; isolate geography/DF while retaining all
        // item/monster fields and ownership flags, including retired machines.
        for (const count of new Set(original.instanceCount)) {
        const f:FeatureDef={...original,instanceCount:[count,count],terrain:undefined,featureDF:undefined,personalSpace:0,flags:original.flags.filter(k=>semantic.includes(k))};
        const {engine,apply}=fixture([f],f.flags.includes('MF_ADOPT_ITEM'));
        engine.buildAMachine=(_id:number,_flags:string[],item:MachineItemSpawn)=>({blueprintId:'child',category:'key',machineNumber:99,cells:[],center:{x:1,y:1},door:null,needsKey:false,subMachines:[],monsterSpawns:[],featureSpawns:[],itemSpawns:[{...item,viaAdoption:true,pos:{x:10,y:10}}]});
        const incoming=key(),before=JSON.stringify(incoming),r=apply(f.flags.includes('MF_ADOPT_ITEM')?incoming:null)!;
        expect(r).not.toBeNull(); expect(JSON.stringify(incoming)).toBe(before);
        const owners=destinations(r),generated=r.generatedItems!;
        const expected=f.flags.includes('MF_ADOPT_ITEM')?1:count;
        expect(r.featureSpawns).toHaveLength(count);
        expect(expected).toBeGreaterThan(0);expect(owners).toHaveLength(expected);
        expect(new Set(owners.map(i=>i.instanceId)).size).toBe(expected);
        if(f.flags.includes('MF_ADOPT_ITEM')){expect(generated).toHaveLength(0);expect(owners[0]!.instanceId).toBe(incoming.instanceId);expect(owners[0]!.keyLoc).toEqual(incoming.keyLoc);}
        else expect(owners.map(i=>i.instanceId).sort()).toEqual(generated.map(i=>i.instanceId).sort());
        if(f.flags.includes('MF_MONSTER_TAKE_ITEM')){expect(r.itemSpawns).toHaveLength(0);expect(r.monsterSpawns.filter(m=>m.carriedItem)).toHaveLength(1);}
        if(f.flags.includes('MF_OUTSOURCE_ITEM_TO_MACHINE')){expect(r.itemSpawns).toHaveLength(0);expect(r.monsterSpawns.filter(m=>m.carriedItem)).toHaveLength(0);expect(r.subMachines).toHaveLength(expected);}
        }
    });
});

describe('U05a adversarial ownership',()=>{
    it('adopt only once; later itemless instances/features do not erase the last valid torch pair',()=>{
        const f:FeatureDef={instanceCount:[3,3],flags:['MF_ADOPT_ITEM','MF_MONSTER_TAKE_ITEM'],monsterId:'rat'};
        const r=fixture([f,{...f,instanceCount:[1,1]}]).apply()!;
        expect(r.monsterSpawns).toHaveLength(4);expect(r.itemSpawns).toHaveLength(0);
        expect(r.monsterSpawns.map(m=>m.carriedItem?.instanceId)).toEqual(['parent:key',undefined,undefined,undefined]);
    });
    it('reject orphaned earlier torch in malformed multiple-generation TAKE features',()=>{
        const f:FeatureDef={instanceCount:[1,1],flags:['MF_GENERATE_ITEM','MF_MONSTER_TAKE_ITEM'],itemCategory:'KEY',itemId:'iron_key',monsterId:'rat'};
        // CE's torch assignment is last-pair-only. Current CE catalog has no
        // multiple generated torches; reject this malformed graph, don't leak it.
        expect(fixture([f,{...f,monsterId:'goblin'}],false).apply(null)).toBeNull();
        expect(fixture([{...f,monsterId:undefined}],false).apply(null)).toBeNull();
    });
    it('adopt + outsource + carry transfers only to child, never parent ground/carrier',()=>{
        const f:FeatureDef={instanceCount:[1,1],flags:[...ownership],monsterId:'rat'};
        const {engine,apply}=fixture([f]);
        engine.buildAMachine=(_id:number,_flags:string[],item:MachineItemSpawn)=>({subMachines:[],itemSpawns:[item],monsterSpawns:[]});
        const r=apply()!;expect(r.itemSpawns).toHaveLength(0);expect(r.monsterSpawns[0]!.carriedItem).toBeUndefined();expect(destinations(r)).toHaveLength(1);
    });
    for(const lateParentFailure of [false,true])it(`recursive ${lateParentFailure?'child succeeds, parent later fails':'child adopts then fails'} rolls back terrain, pending items/monsters and external item`,()=>{
        const outsource:FeatureDef={instanceCount:[1,1],flags:['MF_ADOPT_ITEM','MF_OUTSOURCE_ITEM_TO_MACHINE']};
        const fail:FeatureDef={instanceCount:[1,1],flags:[],monsterId:'rat'};
        const {engine,room,bp}=fixture(lateParentFailure?[outsource,fail]:[outsource],true);
        engine.blueprints=[{...bp,ceBlueprintId:900}]; engine.fillAreaInterior=()=>room.cells;
        const incoming=key(),originalItem=JSON.stringify(incoming),before=engine.backupLevel();
        const build=BlueprintEngine.prototype.buildAMachine; let attempts=0,childCalls=0;
        engine.findFeaturePosition=(_a:any,_b:any,_c:any,_d:any,f:FeatureDef)=>f===fail?null:{x:8,y:8};
        engine.buildAMachine=function(id:number,flags:string[],item:MachineItemSpawn|null,origin:any){
            if(id===900)return build.call(this,id,flags,item,origin);
            childCalls++;
            const backup=this.backupLevel();
            const child=this.applyBlueprint({...bp,flags:[BP_ADOPT_ITEM],features:[{instanceCount:[1,1],monsterId:'rat',flags:['MF_ADOPT_ITEM','MF_MONSTER_TAKE_ITEM']}]},room,{adoptiveItem:item});
            expect(child.monsterSpawns[0].carriedItem.instanceId).toBe(item!.instanceId);attempts++;
            if(lateParentFailure)return child;
            this.restoreLevel(backup);return null;
        };
        const r=engine.buildAMachine(900,[],incoming,{x:8,y:8});
        expect(r).toBeNull();expect(attempts).toBeGreaterThan(0);expect(childCalls).toBe(lateParentFailure?9:90);
        expect(engine.backupLevel()).toEqual(before);expect(JSON.stringify(incoming)).toBe(originalItem);
        // A succeeding retry receives a clean item/owner graph; no failed result is published.
        engine.findFeaturePosition=()=>({x:9,y:9});
        const retry=engine.applyBlueprint({...bp,flags:[BP_ADOPT_ITEM],features:[{instanceCount:[1,1],flags:['MF_ADOPT_ITEM']}]},room,{adoptiveItem:incoming});
        expect(destinations(retry)).toHaveLength(1);expect(destinations(retry)[0]!.instanceId).toBe(incoming.instanceId);
    });
});

// Use the production populateLevel consumer with a deterministic machine result.
function materializedGame(horde:boolean,duplicate=false){
    const f:FeatureDef={instanceCount:[1,1],flags:['MF_ADOPT_ITEM','MF_MONSTER_TAKE_ITEM',...(horde?['MF_GENERATE_HORDE']:[])],monsterId:horde?undefined:'rat',hordeFlags:horde?['HORDE_MACHINE_THIEF']:undefined};
    const r=fixture([f]).apply()!;
    if(duplicate)r.itemSpawns.push(r.monsterSpawns[0]!.carriedItem!);
    const g:any=createHeadlessGame(42);g.depth=12;
    const generate=Architect.prototype.generateLevel;
    vi.spyOn(Architect.prototype,'generateLevel').mockImplementation(function(this:Architect,...args:Parameters<Architect['generateLevel']>){
        const v=generate.apply(this,args);(this as any).machineResults=[r];
        for(const p of r.monsterSpawns)v.setTerrain(p.pos.x,p.pos.y,T.FLOOR,'.',0x888888);
        return v;
    });
    g.generateDepth(false,false);
    return {g,r};
}
describe('U05a real consumer and U01 snapshot contract',()=>{
    for(const horde of [false,true])it(`${horde?'horde leader':'ordinary monster'} owns one item before death, after reload/death, after pickup/reload`,()=>{
        const {g,r}=materializedGame(horde);
        const carrier=g.monsters.find((m:any)=>m.machineHome===r.machineNumber&&m.carriedItem);
        expect(carrier).toBeDefined();const id=carrier.carriedItem.id;
        const owners=()=>[...g.items,...g.monsters.flatMap((m:any)=>m.carriedItem?[m.carriedItem]:[]),...g.dormantMonsters.flatMap((m:any)=>m.carriedItem?[m.carriedItem]:[]),...g.player.inventory.items].filter(i=>i.id===id);
        expect(owners()).toHaveLength(1);expect(g.items.some((i:any)=>i.id===id)).toBe(false);
        const before=JSON.parse(JSON.stringify(g.toSnapshot()));
        carrier.hp=0;g.removeDeadMonsters();
        const continuousDrop=JSON.parse(JSON.stringify(g.toSnapshot().items.find((i:any)=>i.id===id)));
        expect(g.loadSnapshot(before)).toBe(true);expect(owners()).toHaveLength(1);
        const live=g.monsters.find((m:any)=>m.id===carrier.id);live.hp=0;g.removeDeadMonsters();g.removeDeadMonsters();
        expect(owners()).toHaveLength(1);expect(g.items.filter((i:any)=>i.id===id)).toHaveLength(1);
        const after=JSON.parse(JSON.stringify(g.toSnapshot()));
        expect(after.items.find((i:any)=>i.id===id)).toEqual(continuousDrop);
        expect(g.loadSnapshot(after)).toBe(true);expect(owners()).toHaveLength(1);
        const item=g.items.find((i:any)=>i.id===id);g.player.loc={...item.loc};g.pickUpItemAfterDisplacement();
        expect(g.player.inventory.items.some((i:any)=>i.id===id)).toBe(true);
        expect(g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);expect(owners()).toHaveLength(1);
        expect(g.player.inventory.items.find((i:any)=>i.id===id).keyLoc).toEqual(key().keyLoc);
        expect(g.player.inventory.items.find((i:any)=>i.id===id).originDepth).toBe(12);
    });
    it('handoff replaces the horde leader’s existing item without a second floor/inventory owner',()=>{
        const proto=Game.prototype as any,spawn=proto.spawnHordeAtFeature;
        const displaced=ItemLoader.spawnKey('cage_key',3,3)!;
        vi.spyOn(proto,'spawnHordeAtFeature').mockImplementation(function(this:any,...args:any[]){
            const leader=spawn.apply(this,args);if(leader)leader.carriedItem=displaced;return leader;
        });
        const {g,r}=materializedGame(true);
        const leader=g.monsters.find((m:any)=>m.machineHome===r.machineNumber&&m.carriedItem);
        expect(leader.carriedItem).not.toBe(displaced);
        expect(leader.carriedItem.keyLoc).toEqual(key().keyLoc);
        expect([...g.items,...g.player.inventory.items,...g.monsters.map((m:any)=>m.carriedItem),...g.dormantMonsters.map((m:any)=>m.carriedItem)]).not.toContain(displaced);
    });
    it('duplicate deferred identity is rejected before either copy is instantiated',()=>{
        const spawn=vi.spyOn(ItemLoader,'spawnKey');
        expect(()=>materializedGame(false,true)).toThrow('Duplicate machine item owner');
        // The duplicate is rejected at the transaction boundary (no two entities).
        expect(spawn.mock.results.filter(r=>r.value?.keyLoc?.some((k:any)=>k.machine===7))).toHaveLength(0);
    });
});
