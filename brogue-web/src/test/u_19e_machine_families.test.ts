import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import crypto from 'node:crypto';
import blueprints from '../data/blueprints.json';
import golden from './fixtures/u19e-ce-catalog.json';
import cases from './fixtures/u19e-natural-cases.json';
import {BlueprintEngine,blueprintQualifies,type BlueprintDef} from '../engine/Generator/BlueprintEngine';
import {rng} from '../engine/Random';
import {AUTO_GENERATOR_CATALOG} from '../engine/Map/AutoGenerator';
import {TerrainType as T,DungeonLayer as L} from '../engine/Map/Grid';
import {createHeadlessGame} from './harness';
import {setMachineObservationHook,type MachineTrace} from '../engine/Generator/MachineObservation';
import {runAltarActions} from './fixtures/u19e-machine-actions';
import {machineScene} from './fixtures/u19a-machine-scenes';
const bps=blueprints as BlueprintDef[];
afterEach(()=>{setMachineObservationHook(null);vi.restoreAllMocks();});

describe('U19e independent CE selection contract',()=>{
 it('literal frequency/depth/room/feature flags and all autoGen entries retain local CE values',()=>{
  for(const [file,sha] of [[golden.file,golden.sha256],[golden.headerFile,golden.headerSHA256]])expect(crypto.createHash('sha256').update(readFileSync(file!)).digest('hex')).toBe(sha);
  for(const row of golden.machines){const bp=bps.find(b=>b.ceBlueprintId===row.ce)!;
   expect(bp.frequency).toBe(row.frequency);expect(bp.depthRange).toEqual(row.depthRange);expect(bp.roomSize).toEqual(row.roomSize);
   const flags=new Set(bp.flags);if(bp.category==='key_guard')flags.add('BP_ADOPT_ITEM');expect([...flags].sort()).toEqual([...row.flags].sort());expect(bp.features).toHaveLength(row.featureCount);
   row.features.forEach((f,i)=>expect(bp.features[i]!.flags).toEqual(f.flags));
  }
  for(const row of golden.autogen){const a=AUTO_GENERATOR_CATALOG.find(a=>a.index===row.index)!;
   expect(a).toMatchObject({ceMachine:row.machine,minDepth:row.minDepth,maxDepth:row.maxDepth,frequency:row.frequency,minNumberIntercept:row.minNumberIntercept,minNumberSlope:row.minNumberSlope,maxNumber:row.maxNumber});
  }
  const family=golden.machines.filter(r=>[1,2,6,7,26,47].includes(r.ce));
  expect(golden.autogen.filter(a=>family.some(m=>m.machineType===a.machine))).toEqual([]);
 });
 it.each([1,2,6,7,26,47])('CE%i qualifies only within CE depth and its reward/adoption pool',ce=>{
  const bp=bps.find(b=>b.ceBlueprintId===ce)!,flag=[26,47].includes(ce)?'BP_ADOPT_ITEM':'BP_REWARD';
  for(let d=0;d<=40;d++)expect(blueprintQualifies(bp,d,[flag])).toBe(d>=bp.depthRange[0]&&d<=bp.depthRange[1]);
  expect(blueprintQualifies(bp,Math.max(13,bp.depthRange[0]),[flag==='BP_REWARD'?'BP_ADOPT_ITEM':'BP_REWARD'])).toBe(false);
  for(const restored of [52,55])expect(blueprintQualifies(bps.find(b=>b.ceBlueprintId===restored)!,10,['BP_ADOPT_ITEM'])).toBe(true);
 });
 it.each([[6,7,'BP_REWARD',13],[27,47,'BP_ADOPT_ITEM',10]] as const)('exact integer selection tickets CE%i/%i retain their original weights',(a,b,flag,depth)=>{
  const g=createHeadlessGame(19,'test'),rows=[a,b].map(ce=>bps.find(b=>b.ceBlueprintId===ce)!);
  const e:any=new BlueprintEngine(g.grid,depth,rows),origin={x:35,y:14},total=rows.reduce((n,b)=>n+b.frequency,0),hits=new Map<string,number>();
  e.findGateRoom=()=>({kind:'success',cells:[origin],center:origin,door:origin});e.fillAreaInterior=()=>[origin];
  e.applyBlueprint=(bp:BlueprintDef)=>({blueprintId:bp.id});let ticket=1;
  vi.spyOn(rng,'randRange').mockImplementation((lo,hi)=>{expect([lo,hi]).toEqual([1,total]);return ticket;});
  for(ticket=1;ticket<=total;ticket++){const r=e.buildAMachine(0,[flag],flag==='BP_ADOPT_ITEM'?{category:'KEY',id:'iron_key',pos:origin}:null,origin);expect(r).not.toBeNull();hits.set(r.blueprintId,(hits.get(r.blueprintId)??0)+1);}
  for(const bp of rows)expect(hits.get(bp.id)).toBe(bp.frequency);
 });
});

describe('U19e natural machines: entrance → player commands → original payoff',()=>{
 for(const row of cases)it(`natural CE${row.ce} seed${row.seed}/D${row.depth}`,()=>{
  let traces:MachineTrace[]=[];setMachineObservationHook(()=>{});
  const g:any=createHeadlessGame(19,'test'),populate=g.populateLevel.bind(g);
  g.populateLevel=(...args:any[])=>{const r=populate(...args);traces=args[3].flatMap((m:any)=>m.observation?[m.observation]:[]);return r;};
  g.startNewGame({seed:row.seed,mode:'normal'});for(let d=2;d<=row.depth;d++){g.depth=d;g.generateDepth(false,false);}
  const trace=traces.find(t=>t.ceBlueprintId===row.ce&&t.machineNumber===row.machine);expect(trace,'committed final level, not a discarded generation attempt').toBeDefined();
  const r=runAltarActions(g,trace!,row.entry),phase=(s:string)=>r.phases.find(p=>p.label===s),has=(s:string,t:T)=>phase(s).tiles.some((c:any)=>c.layers.includes(t));
  expect(r.commands.length).toBeGreaterThan(0);expect(r.after.player).toEqual(r.entry);expect(r.after.depth).toBe(row.depth);expect(r.after.hp).toBeGreaterThan(0);
  if(row.ce===6){
   expect(phase('first-drop').items.find((i:any)=>i.id===r.pairIds[0]).enchantment).toBe(5);
   expect(r.pairIds.map(id=>phase('swapped').items.find((i:any)=>i.id===id).enchantment)).toEqual([1,5]);
   expect(phase('swapped').tiles.filter((c:any)=>c.layers.includes(T.COMMUTATION_ALTAR_INERT))).toHaveLength(2);
   expect(has('entry',T.PIPE_GLOWING)).toBe(true);expect(has('swapped',T.PIPE_GLOWING)).toBe(false);expect(has('swapped',T.PIPE_INERT)).toBe(true);
   for(const id of r.pairIds)expect(r.after.inventory.filter((n:number)=>n===id)).toHaveLength(1);
  }else if(row.ce===7){
   expect(phase('death-cleaned').residents.find((m:any)=>m.id===r.allyId)).toMatchObject({purgatory:true,hp:0});
   const ally=phase('resurrected').residents.find((m:any)=>m.id===r.allyId);expect(ally).toMatchObject({purgatory:false,ally:true});expect(ally.hp).toBe(ally.maxHp);
   expect(has('resurrected',T.RESURRECTION_ALTAR_INERT)).toBe(true);expect(has('resurrected',T.RESURRECTION_ALTAR)).toBe(false);
   g.handlePlayerAction('wait');expect(g.monsters.filter((m:any)=>m.id===r.allyId)).toHaveLength(1);
  }else if(row.ce===47){
   expect(phase('entry').residents.find((m:any)=>m.id===r.markedId)).toMatchObject({marked:true,dormant:true,machine:row.machine});
   expect(has('entry',T.SACRIFICE_CAGE_DORMANT)).toBe(true);expect(has('activated',T.SACRIFICE_ALTAR)).toBe(true);expect(has('activated',T.ALTAR_CAGE_RETRACTABLE)).toBe(true);
   expect(phase('awakened').residents.find((m:any)=>m.id===r.markedId)).toMatchObject({dormant:false,hp:expect.any(Number)});
   expect(has('sacrificed',T.SACRIFICE_LAVA)).toBe(true);expect(has('sacrificed',T.ALTAR_CAGE_RETRACTABLE)).toBe(false);
   expect(phase('sacrificed').residents.find((m:any)=>m.id===r.markedId)).toBeUndefined();
   expect(r.after.inventory.filter((id:number)=>id===r.rewardId)).toHaveLength(1);
  }else{
   const count=r.before.tiles.filter((c:any)=>c.layers.includes(T.ALTAR_CAGE_OPEN)).length;expect(count).toBeGreaterThanOrEqual(3);
   expect(phase('closed').tiles.filter((c:any)=>c.layers.includes(T.ALTAR_CAGE_CLOSED))).toHaveLength(count);
   expect(phase('reopened').tiles.filter((c:any)=>c.layers.includes(T.ALTAR_CAGE_OPEN))).toHaveLength(count);
   expect(phase('replaced').items.some((i:any)=>i.id===r.loanId)).toBe(true);expect(phase('replaced').inventory).not.toContain(r.loanId);
   expect(has('replaced',T.ALTAR_CAGE_CLOSED)).toBe(false);expect(r.after.inventory).toContain(r.rewardId);
  }
  expect(g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);
  if(r.rewardId!==undefined)expect(g.player.inventory.items.filter((i:any)=>i.id===r.rewardId)).toHaveLength(1);
 },120000);
});

it.each([28,47])('CE%i immediate and recipe-only population retain a blocked adopted item without observer or blueprint-name exception',ce=>{
 const g:any=createHeadlessGame(19,'test'),s=machineScene(g,ce,1,0,true);expect(s).not.toBeNull();
 const spawn=s!.result.itemSpawns[0]!,original=spawn.entity;expect(original).toBeDefined();
 expect(g.canMoveTo(spawn.pos.x,spawn.pos.y)).toBe(false);
 g.populateLevel(g.depth,false,false,[s!.result]);expect(g.items.filter((i:any)=>i===original)).toHaveLength(1);
 // Compatibility consumer uses the very same explicit feature position, even
 // if the recipe is renamed. No bespoke CE28/47 circuit whitelist is involved.
 delete spawn.entity;g.items=[];s!.result.blueprintId='test_explicit_machine_item';
 g.populateLevel(g.depth,false,false,[s!.result]);expect(g.items.filter((i:any)=>i.x===spawn.pos.x&&i.y===spawn.pos.y)).toHaveLength(1);
 expect(g.grid.getCell(spawn.pos.x,spawn.pos.y)!.layers[L.DUNGEON]).toBe(ce===28?T.ALTAR_CAGE_RETRACTABLE:T.SACRIFICE_CAGE_DORMANT);
});
