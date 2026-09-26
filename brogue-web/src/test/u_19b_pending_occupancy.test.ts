import {afterEach, describe, expect, it, vi} from 'vitest';
import {BlueprintEngine, mapMachineInterior, resetMachineCounter, type BlueprintDef, type FeatureDef, type MachineResult} from '../engine/Generator/BlueprintEngine';
import {Grid, TerrainType as T, DungeonLayer, DCOLS, DROWS} from '../engine/Map/Grid';
import * as auto from '../engine/Map/AutoGenerator';
import {Architect} from '../engine/Generator/Architect';
import {analyzeChokeMap} from '../engine/Map/LoopMap';
import {rng} from '../engine/Random';
import {createHeadlessGame} from './harness';
import {machineScene} from './fixtures/u19a-machine-scenes';
import {ItemCategory} from '../engine/Items/Item';
import oracle from './fixtures/u19b-ce-occupancy.json';

const origin={x:10,y:10}, neighbor={x:11,y:10};
const key=(p:{x:number;y:number})=>p.y*DCOLS+p.x;
const feature=(over:Partial<FeatureDef>={}):FeatureDef=>({instanceCount:[1,1],minimumInstanceCount:1,personalSpace:1,flags:['MF_BUILD_AT_ORIGIN'],...over});
const blueprint=(over:Partial<BlueprintDef>={}):BlueprintDef=>({id:'pending-probe',ceBlueprintId:999,name:'pending probe',category:'thematic',depthRange:[1,26],roomSize:[1,1],frequency:1,flags:[],features:[],...over});
function setup(rows:BlueprintDef[]=[]){
 resetMachineCounter();rng.seedRandomGenerator(19);
 const grid=new Grid(DCOLS,DROWS);
 for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)grid.setTerrain(x,y,T.GRANITE);
 for(const p of [origin,neighbor])grid.setTerrain(p.x,p.y,T.FLOOR);
 const engine:any=new BlueprintEngine(grid,10,rows);
 const apply=(bp:BlueprintDef,at=origin,adoptiveItem:unknown=null):MachineResult|null=>engine.applyBlueprint(bp,{cells:[at],center:at,door:null},{adoptiveItem});
 return {grid,engine,apply};
}
const ground=()=>feature({itemCategory:'POTION',itemId:'potion_of_life',flags:['MF_BUILD_AT_ORIGIN','MF_GENERATE_ITEM']});
const vestibule=()=>blueprint({id:'child',ceBlueprintId:998,flags:['BP_VESTIBULE','BP_NO_INTERIOR_FLAG'],category:'vestibule',features:[ground()]});
const flatten=(m:MachineResult):MachineResult[]=>[m,...m.subMachines.flatMap(flatten)];
afterEach(()=>vi.restoreAllMocks());

it('matches 64 compiled CE room/vestibule/candidate truth-table rows (five entity flags, two positions)',()=>{
 for(const row of oracle.rows){
  const {grid,engine}=setup(),p={x:row.x,y:10};grid.setTerrain(12,10,T.FLOOR);
  if(row.mask&1)engine.pendingItems.add(key(p));if(row.mask&2)engine.pendingMonsters.add(key(p));
  // Player/dormant flags have no BlueprintEngine carrier; CE proves they are
  // irrelevant in these three consumers. Stairs are represented by terrain.
  if(row.mask&8)grid.setTerrain(p.x,p.y,T.STAIRS_UP);
  const analysis=analyzeChokeMap(grid);
  for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)analysis.chokeMap[x]![y]=30000;
  for(let x=10;x<=12;x++)analysis.chokeMap[x]![10]=1;
  expect(engine.cellIsFeatureCandidate(p.x,p.y,{x:12,y:10},new Set([key(p)]),1,new Set(),new Set()),JSON.stringify(row)).toBe(row.candidate);
  expect(engine.fillVestibuleInterior(blueprint({roomSize:[2,2]}),origin)!==null,JSON.stringify(row)).toBe(row.vestibule);
  expect(mapMachineInterior(grid,analysis,origin,(x,y)=>engine.pendingItems.has(key({x,y})))!==null,JSON.stringify(row)).toBe(row.room);
 }
});

describe('U19b CE-specific pending occupancy consumers',()=>{
 it.each([origin,neighbor])('vestibule aborts, rather than skipping, a real pending ground item at %j',at=>{
  const {grid,engine,apply}=setup();
  const result=apply(blueprint({flags:['BP_NO_INTERIOR_FLAG'],features:[ground()]}),at)!;
  expect(result.itemSpawns).toHaveLength(1);expect(grid.getCell(at.x,at.y)!.machineNumber).toBe(0);
  expect(engine.fillVestibuleInterior(blueprint({roomSize:[2,2]}),origin)).toBeNull();
  expect(result.itemSpawns[0]!.pos).toEqual(at); // No relocation/deletion to conceal collision.
 });
 it('room flood checks pending HAS_ITEM even outside its descending choke shell',()=>{
  const {grid,engine,apply}=setup();
  apply(blueprint({flags:['BP_NO_INTERIOR_FLAG'],features:[ground()]}),neighbor);
  grid.setTerrain(9,10,T.FLOOR);
  const analysis=analyzeChokeMap(grid);
  for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++){analysis.gateSite[x]![y]=false;analysis.chokeMap[x]![y]=30000;}
  analysis.gateSite[origin.x]![origin.y]=true;analysis.chokeMap[origin.x]![origin.y]=1;
  analysis.chokeMap[9]![10]=1;
  vi.spyOn(engine,'gateSealsOnlyInterior').mockReturnValue(true);
  // The item is a neighbor, not a qualifying interior cell: CE checks it first.
  expect(engine.findGateRoom(blueprint(),analysis)).toEqual({kind:'retry'});
  expect(engine.pendingItems.has(key(neighbor))).toBe(true);
 });
 it.each(['active','dormant','carried'] as const)('vestibule does not invent a HAS_MONSTER/HAS_DORMANT/carried-item ban: %s',kind=>{
  const {engine,apply}=setup();
  const flags=['MF_BUILD_AT_ORIGIN',...(kind==='active'?[]:['MF_MONSTERS_DORMANT']),...(kind==='carried'?['MF_GENERATE_ITEM','MF_MONSTER_TAKE_ITEM']:[])];
  const r=apply(blueprint({flags:['BP_NO_INTERIOR_FLAG'],features:[feature({flags,monsterId:'rat',itemCategory:kind==='carried'?'POTION':undefined})]}))!;
  expect(r.monsterSpawns).toHaveLength(1);expect(engine.fillVestibuleInterior(blueprint(),origin)).toEqual([origin]);
  expect(engine.fillAreaInterior(blueprint(),origin)).toEqual(kind==='active'?null:[origin]);
 });
 it.each([false,true])('area sees real active %s requests after membership is cleared',horde=>{
  const {engine,apply}=setup();
  apply(blueprint({flags:['BP_NO_INTERIOR_FLAG'],features:[feature(horde?{flags:['MF_BUILD_AT_ORIGIN','MF_GENERATE_HORDE'],hordeFlags:['HORDE_MACHINE_THIEF']}:{monsterId:'rat'})]}));
  expect(engine.fillAreaInterior(blueprint(),origin)).toBeNull();
 });
 it.each(['item','monster','dormant'] as const)('Architect second autogenerator pass sees live pending %s after BP_NO_INTERIOR_FLAG',kind=>{
  const grid=new Grid(DCOLS,DROWS);
  vi.spyOn(Architect.prototype,'generateTerrain').mockImplementation(()=>{
   for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)grid.setTerrain(x,y,T.GRANITE);
   for(const p of [origin,neighbor])grid.setTerrain(p.x,p.y,T.FLOOR);
   return grid;
  });
  vi.spyOn(BlueprintEngine.prototype,'buildMachines').mockImplementation(function(this:BlueprintEngine){
   const f=kind==='item'?ground():feature({monsterId:'rat',flags:['MF_BUILD_AT_ORIGIN',...(kind==='dormant'?['MF_MONSTERS_DORMANT']:[])]});
   return [(this as any).applyBlueprint(blueprint({flags:['BP_NO_INTERIOR_FLAG'],features:[f]}),{cells:[origin],center:origin,door:null})];
  });
  const run=auto.runAutogenerators;
  let calls=0;
  vi.spyOn(auto,'runAutogenerators').mockImplementation((g,depth,area,_catalog,_buildMachine,isOccupied)=>{
   if(!area)return {buildAreaMachines:false,depth,entries:[],totalBuilt:0};
   calls++;
   const row={...auto.AUTO_GENERATOR_CATALOG[1]!,index:1,machine:999,df:null,terrain:T.CARPET,layer:DungeonLayer.SURFACE,requiredDungeonFoundationType:T.FLOOR,requiredLiquidFoundationType:T.NOTHING,minDepth:1,maxDepth:26,minNumberIntercept:100,minNumberSlope:0,maxNumber:1,frequency:0,carrier:'wired' as const};
   vi.spyOn(rng,'randPercent').mockReturnValue(false);
   const roll=vi.spyOn(rng,'randRange');
   for(const n of [origin.x,origin.y,neighbor.x,neighbor.y])roll.mockReturnValueOnce(n);
   const result=run(g,depth,area,[row,row],()=>true,isOccupied);
   expect(g.getCell(origin.x,origin.y)!.layers[DungeonLayer.SURFACE]).toBe(kind==='dormant'?T.CARPET:T.NOTHING);
   expect(g.getCell(neighbor.x,neighbor.y)!.layers[DungeonLayer.SURFACE]).toBe(kind==='dormant'?T.NOTHING:T.CARPET);
   expect(roll).toHaveBeenCalledTimes(kind==='dormant'?2:4);
   return result;
  });
  new Architect(grid).generateLevel(1);expect(calls).toBe(1);
 });
 it('parent item precedes child selection, preventing a same-cell double product',()=>{
  const child=vestibule(),parent=blueprint({features:[feature({itemCategory:'POTION',flags:['MF_BUILD_AT_ORIGIN','MF_GENERATE_ITEM','MF_BUILD_VESTIBULE']})]});
  const {engine}=setup([parent,child]);
  const result=engine.buildAMachine(999,[],null,origin) as MachineResult|null;
  const products=result?flatten(result).flatMap(m=>m.itemSpawns):[];
  const positions=products.map(p=>key(p.pos));
  expect(positions.length-new Set(positions).size).toBe(0);
  expect(result).toBeNull();expect([...engine.pendingItems]).toEqual([]);
 });
 it('a committed child item is visible to later parent features; failed parent restores all child reservations',()=>{
  const child=vestibule(),parent=blueprint({features:[feature({flags:['MF_BUILD_AT_ORIGIN','MF_BUILD_VESTIBULE']}),feature({flags:['MF_BUILD_AT_ORIGIN','MF_BUILD_VESTIBULE']})]});
  const {engine}=setup([parent,child]);
  const committed=key({x:2,y:2});engine.pendingItems.add(committed);engine.pendingMonsters.add(committed);
  const result=engine.buildAMachine(999,[],null,origin);
  expect(result).toBeNull();expect([...engine.pendingItems]).toEqual([committed]);expect([...engine.pendingMonsters]).toEqual([committed]);
 });
 it('outsourced item reserves only its adopted destination, survives child commit, and blocks a later vestibule',()=>{
  const child=blueprint({id:'adopter',ceBlueprintId:998,category:'key',flags:['BP_ROOM','BP_ADOPT_ITEM','BP_NO_INTERIOR_FLAG'],features:[feature({flags:['MF_BUILD_AT_ORIGIN','MF_ADOPT_ITEM']})]});
  const parent=blueprint({features:[feature({itemCategory:'POTION',flags:['MF_BUILD_AT_ORIGIN','MF_GENERATE_ITEM','MF_OUTSOURCE_ITEM_TO_MACHINE']})]});
  const {engine,apply}=setup([parent,child]);
  vi.spyOn(engine,'findGateRoom').mockReturnValue({kind:'room',cells:[neighbor],center:neighbor,door:neighbor});
  const result=apply(parent)!;
  expect(result.itemSpawns).toHaveLength(0);expect(result.subMachines).toHaveLength(1);
  const adopted=result.subMachines[0]!.itemSpawns[0]!;
  expect(adopted.instanceId).toBe(result.generatedItems![0]!.instanceId);
  expect([...engine.pendingItems]).toEqual([key(neighbor)]);
  expect(engine.fillVestibuleInterior(blueprint(),origin)).toEqual([origin]);
  expect(engine.fillVestibuleInterior(blueprint(),neighbor)).toBeNull();
 });
 it('failed child retries leak neither item nor active monster reservations',()=>{
  const child=blueprint({id:'failing-child',ceBlueprintId:998,category:'vestibule',flags:['BP_VESTIBULE'],features:[feature({itemCategory:'POTION',monsterId:'rat',flags:['MF_BUILD_AT_ORIGIN','MF_GENERATE_ITEM']}),feature({flags:['MF_BUILD_IN_WALLS'],minimumInstanceCount:999,instanceCount:[1,1]})]});
  const parent=blueprint({features:[feature({flags:['MF_BUILD_AT_ORIGIN','MF_BUILD_VESTIBULE']})]});
  const {engine}=setup([parent,child]);
  expect(engine.buildAMachine(999,[],null,origin)).toBeNull();expect([...engine.pendingItems]).toEqual([]);expect([...engine.pendingMonsters]).toEqual([]);
 });
 it('CE candidate selection permits zero-space item/monster co-location and BUILD_AT_ORIGIN overlays',()=>{
  const {engine,apply}=setup();
  const b=blueprint({features:[ground(),feature({monsterId:'rat'}),ground()]});
  const r=apply(b)!;
  expect(r.itemSpawns.map(s=>s.pos)).toEqual([origin,origin]);expect(r.monsterSpawns[0]!.pos).toEqual(origin);
  // Literal Architect.c cellIsFeatureCandidate has no HAS_* predicate.
  expect(engine.cellIsFeatureCandidate(origin.x,origin.y,neighbor,new Set([key(origin)]),r.machineNumber,new Set(),new Set())).toBe(true);
  engine.grid.setTerrain(origin.x,origin.y,T.STAIRS_UP);
  expect(engine.cellIsFeatureCandidate(origin.x,origin.y,origin,new Set(),0,new Set(['MF_BUILD_AT_ORIGIN']),new Set())).toBe(true);
 });
});

describe('U19b AMULET request materialization',()=>{
 it('CE15 complete blueprint reaches populateLevel, then actual pickup transfers its amulet exactly once',()=>{
  const g:any=createHeadlessGame(19,'test'),scene=machineScene(g,15,1)!;
  expect(scene).not.toBeNull();
  const request=(scene.result as MachineResult).itemSpawns.find(s=>s.category==='AMULET')!;expect(request).toBeDefined();
  g.populateLevel(g.depth,false,false,[scene.result]);
  const produced=g.items.filter((i:any)=>i.category===ItemCategory.AMULET&&i.loc.x===request.pos.x&&i.loc.y===request.pos.y);
  expect(produced).toHaveLength(1);expect(produced[0].identified).toBe(true);
  const guardian=g.dormantMonsters.find((m:any)=>m.machineHome===scene.result.machineNumber);
  expect(guardian).toBeDefined();
  g.player.loc={...request.pos};g.handlePlayerAction('pickup',undefined,'system');
  expect(g.player.inventory.items.filter((i:any)=>i.id===produced[0].id)).toHaveLength(1);
  expect(g.items.some((i:any)=>i.id===produced[0].id)).toBe(false);
  expect(g.monsters.some((m:any)=>m.id===guardian.id)).toBe(true);
  expect(g.dormantMonsters.some((m:any)=>m.id===guardian.id)).toBe(false);
 });
});
