import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';import crypto from 'node:crypto';
import blueprints from '../data/blueprints.json';import golden from './fixtures/u19d-ce-catalog.json';
import cases from './fixtures/u19d-natural-cases.json';
import {BlueprintEngine,blueprintQualifies,type BlueprintDef} from '../engine/Generator/BlueprintEngine';
import {rng} from '../engine/Random';
import {AUTO_GENERATOR_CATALOG} from '../engine/Map/AutoGenerator';
import {TerrainType as T,DungeonLayer as L} from '../engine/Map/Grid';
import {ItemCategory} from '../engine/Items/Item';
import {createHeadlessGame} from './harness';
import {machineScene} from './fixtures/u19a-machine-scenes';
import {runMachineActions} from './fixtures/u19d-machine-actions';
import {setMachineObservationHook,type MachineTrace} from '../engine/Generator/MachineObservation';
const bps=blueprints as BlueprintDef[];
afterEach(()=>{setMachineObservationHook(null);vi.restoreAllMocks();});

describe('U19d CE selection contract',()=>{
 it('all fifteen family rows retain CE depth, size, frequency and literal feature flags',()=>{
  expect(crypto.createHash('sha256').update(readFileSync(golden.file)).digest('hex')).toBe(golden.sha256);
  for(const row of golden.machines){const bp=bps.find(b=>b.ceBlueprintId===row.ce)!;
   expect(bp.depthRange).toEqual(row.depthRange);expect(bp.roomSize).toEqual(row.roomSize);expect(bp.frequency).toBe(row.frequency);
   expect(bp.features).toHaveLength(row.features.length);expect(row.featureCount-row.features.length).toBe(row.ce===36?2:0);row.features.forEach((f,i)=>expect(bp.features[i]!.flags).toEqual(f.flags));
  }
 });
 it('CE18 reenters only its CE depth and vestibule pool, CE67/68/69 keep zero lottery weight',()=>{
  const b=bps.find(b=>b.ceBlueprintId===18)!;for(const depth of [3,4,15,26,27])expect(blueprintQualifies(b,depth,['BP_VESTIBULE'])).toBe(depth>=4&&depth<=26);
  expect(blueprintQualifies(b,15,['BP_REWARD'])).toBe(false);
  for(const ce of [67,68,69])expect(bps.find(b=>b.ceBlueprintId===ce)!.frequency).toBe(0);
  for(const ce of [52,55])expect(blueprintQualifies(bps.find(b=>b.ceBlueprintId===ce)!,10,['BP_ADOPT_ITEM'])).toBe(true);
 });
 it('paralysis/statue/hidden-trap autoGen rate columns equal CE, including minima and caps',()=>{
  for(const row of golden.autogen){const a=AUTO_GENERATOR_CATALOG.find(a=>a.index===row.index)!;
   expect(a).toMatchObject({ceTerrain:row.terrain,ceMachine:row.machine,minDepth:row.minDepth,maxDepth:row.maxDepth,frequency:row.frequency,minNumberIntercept:row.minNumberIntercept,minNumberSlope:row.minNumberSlope,maxNumber:row.maxNumber,carrier:'wired'});
  }
 });
});

describe('U19d whole natural machines: entrance → actual commands → payoff',()=>{
 for(const row of cases)it(`natural CE${row.ce} seed${row.seed}/D${row.depth}: ${row.kind}`,()=>{
  let current:MachineTrace[]=[];setMachineObservationHook(()=>{});
  const g:any=createHeadlessGame(19,'test');const populate=g.populateLevel.bind(g);
  g.populateLevel=(...args:any[])=>{const result=populate(...args);current=args[3].flatMap((m:any)=>m.observation?[m.observation]:[]);return result;};
  g.startNewGame({seed:row.seed,mode:'normal'});
  for(let d=2;d<=row.depth;d++){g.depth=d;g.generateDepth(false,false);}
  const trace=current.find(m=>m.ceBlueprintId===row.ce&&m.machineNumber===row.machine)!;expect(trace,'final realized machine, not an abandoned build').toBeDefined();
  const result=runMachineActions(g,trace),phase=(name:string)=>result.phases.find(p=>p.label===name);
  expect(result.commands.length).toBeGreaterThan(0);expect(result.after.depth).toBe(row.depth);expect(result.after.hp).toBeGreaterThan(0);
  if([18,28,36,35,29,43,40].includes(row.ce)){
   expect(result.rewardId).toBeDefined();expect(result.after.inventory).toContain(result.rewardId);
   expect(g.player.inventory.items.find((i:any)=>i.id===result.rewardId).category).toBe(ItemCategory.KEY);
  }
  if([18,36,40].includes(row.ce)){expect(phase('searched').tiles.some((c:any)=>c.layers.includes(T.WALL_LEVER))).toBe(true);expect(phase('pulled').tiles.some((c:any)=>c.layers.includes(T.WALL_LEVER_PULLED))).toBe(true);}
  if([22,28].includes(row.ce)){
   expect(result.before.tiles.some((c:any)=>c.layers.includes(T.PRESSURE_PLATE))).toBe(true);expect(result.before.tiles.some((c:any)=>c.layers.includes(T.TRAP_DOOR))).toBe(true);
   expect(phase('thrown').tiles.some((c:any)=>c.layers.includes(T.MACHINE_PRESSURE_PLATE_USED))).toBe(true);
   expect(phase('thrown').tiles.some((c:any)=>c.layers.includes(T.ALTAR_CAGE_RETRACTABLE)||c.layers.includes(T.PORTCULLIS_CLOSED)||c.layers.includes(T.WORM_TUNNEL_OUTER_WALL))).toBe(false);
  }
  if([67,68].includes(row.ce)){
   expect(phase('triggered').tiles.filter((c:any)=>c.layers.includes(T.MACHINE_PARALYSIS_VENT)).length).toBeGreaterThanOrEqual(2);
   expect(phase('paralyzed').paralyzed).toBeGreaterThan(0);expect(phase('blocked-move').player).toEqual(phase('paralyzed').player);
   expect(phase('escaped').paralyzed).toBe(0);expect(phase('escaped').player).not.toEqual(phase('paralyzed').player);expect(result.after.hp).toBe(result.before.hp);
  }
  if([21,43,69].includes(row.ce)){
   expect(result.before.residents.length).toBeGreaterThan(0);expect(result.before.residents.every((m:any)=>m.dormant)).toBe(true);
   expect(result.after.residents.map((m:any)=>m.id).sort()).toEqual(result.before.residents.map((m:any)=>m.id).sort());expect(result.after.residents.every((m:any)=>!m.dormant)).toBe(true);
   expect(result.after.tiles.some((c:any)=>[T.STATUE_DORMANT,T.STATUE_DORMANT_DOORWAY,T.STATUE_CRACKING].some(t=>c.layers.includes(t)))).toBe(false);
  }
 },120000);
});

it.each([36,38])('CE%i complete ALTERNATIVE lever branch: search, pull, wait for passage, collect the adopted key and return',(ce)=>{
 setMachineObservationHook(()=>{});const g:any=createHeadlessGame(19,'test'),scene=machineScene(g,ce,2,0,true)!;expect(scene).not.toBeNull();g.populateLevel(g.depth,false,false,[scene.result]);
 const r=runMachineActions(g,scene.result.observation!);expect(r.phases.find(p=>p.label==='pulled').tiles.some((c:any)=>c.layers.includes(T.WALL_LEVER_PULLED))).toBe(true);
 expect(r.rewardId).toBeDefined();expect(r.after.inventory).toContain(r.rewardId);expect(r.after.player).toEqual(r.entry);
});

it('CE28 no observer: preserve the CE caged item identity through population and storage',()=>{
 const g:any=createHeadlessGame(19,'test'),s=machineScene(g,28,1,0,true)!;expect(s).not.toBeNull();const spawn=s.result.itemSpawns[0]!,item=spawn.entity;
 expect(item).toBeDefined();expect(g.grid.getCell(spawn.pos.x,spawn.pos.y)!.layers[L.DUNGEON]).toBe(T.ALTAR_CAGE_RETRACTABLE);
 g.populateLevel(g.depth,false,false,[s.result]);expect(g.items.filter((i:any)=>i===item)).toHaveLength(1);
 g.currentLevelDepth=g.depth;for(const l of g.levelSeeds)l.visited=false;g.levelSeeds[g.depth-1].visited=true;
 const saved=JSON.parse(JSON.stringify(g.toSnapshot()));expect(g.loadSnapshot(saved)).toBe(true);expect(g.items.filter((i:any)=>i.id===item!.id)).toHaveLength(1);

});

it('CE28 explicit builder can adopt a key; U19f restores CE52 to the weighted pool',()=>{
 const g:any=createHeadlessGame(19,'test');for(let x=1;x<g.grid.width-1;x++)for(let y=1;y<g.grid.height-1;y++)g.grid.setTerrain(x,y,T.FLOOR);g.monsters=[];g.items=[];
 const bp=bps.find(b=>b.ceBlueprintId===28)!,engine=new BlueprintEngine(g.grid,3,[bp]);
 const r=engine.buildAMachine(28,[],{category:'KEY',id:'iron_key',instanceId:'u19d-key',pos:{x:35,y:14},viaAdoption:true}, {x:35,y:14});
 expect(r).not.toBeNull();
 expect(blueprintQualifies(bps.find(b=>b.ceBlueprintId===52)!,10,['BP_ADOPT_ITEM'])).toBe(true);
 // U19e verifies CE47 using its complete natural machine, not an open-map
 // room-site failure that stayed null even after its adoption gate was removed.

});

it('CE28 deferred population retains the caged reward instead of silently dropping it',()=>{
 const g:any=createHeadlessGame(19,'test'),scene=machineScene(g,28,1,0,true)!;expect(scene).not.toBeNull();
 // Exercise Architect's recipe-only compatibility consumer, with no realized item.
 for(const spawn of scene.result.itemSpawns)delete spawn.entity;g.items=[];
 g.populateLevel(g.depth,false,false,[scene.result]);const pos=scene.result.itemSpawns[0]!.pos;
 expect(g.items.filter((i:any)=>i.category===ItemCategory.KEY&&i.x===pos.x&&i.y===pos.y)).toHaveLength(1);
});

it('CE18 both complete barrier alternatives open after search and bump',()=>{
 setMachineObservationHook(()=>{});const seen=new Set<string>();
 for(let seed=1;seed<=8&&seen.size<2;seed++){
  const g:any=createHeadlessGame(19,'test'),scene=machineScene(g,18,seed,0,true)!;expect(scene).not.toBeNull();
  g.populateLevel(g.depth,false,false,[scene.result]);const gate=scene.result.featureSpawns.find((f:any)=>f.featureIndex<2)!;seen.add(gate.terrain!);
  const r=runMachineActions(g,scene.result.observation!,{x:16,y:14});expect(r.phases.find(p=>p.label==='pulled').tiles.some((c:any)=>c.layers.includes(T.WALL_LEVER_PULLED))).toBe(true);
  expect(g.grid.getCell(gate.pos.x,gate.pos.y).isPassable).toBe(true);
 }
 expect([...seen].sort()).toEqual(['PORTCULLIS_CLOSED','WORM_TUNNEL_OUTER_WALL']);
});

it.each([[16,18,'BP_VESTIBULE'],[27,28,'BP_ADOPT_ITEM']] as const)('CE weighted selection %i/%i: enumerate every integer ticket, exactly eight select the returning machine',(control,ce,flag)=>{
 const g=createHeadlessGame(19,'test'),rows=[control,ce].map(id=>bps.find(b=>b.ceBlueprintId===id)!);
 const e:any=new BlueprintEngine(g.grid,4,rows),total=rows.reduce((n,b)=>n+b.frequency,0),origin={x:35,y:14};
 // Isolate selection from site availability; literal catalog frequency and
 // eligibility are still consumed by the real buildAMachine implementation.
 e.fillVestibuleInterior=()=>[origin];e.fillAreaInterior=()=>[origin];e.findGateRoom=()=>({kind:'success',cells:[origin],center:origin,door:origin});
 e.applyBlueprint=(bp:BlueprintDef)=>({blueprintId:bp.id});let ticket=1,hits=0;
 vi.spyOn(rng,'randRange').mockImplementation((lo,hi)=>{expect([lo,hi]).toEqual([1,total]);return ticket;});
 for(ticket=1;ticket<=total;ticket++){
  const r=e.buildAMachine(0,[flag],flag==='BP_ADOPT_ITEM'?{category:'KEY',id:'iron_key',pos:origin}:null,origin);
  expect(r).not.toBeNull();if(r.blueprintId===rows[1]!.id)hits++;
 }
 expect(hits).toBe(8);
});
