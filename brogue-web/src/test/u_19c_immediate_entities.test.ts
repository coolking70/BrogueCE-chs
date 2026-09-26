import {afterEach, describe, expect, it, vi} from 'vitest';
import {BlueprintEngine, resetMachineCounter, type BlueprintDef, type FeatureDef, type MachineEntityRuntime} from '../engine/Generator/BlueprintEngine';
import {Grid, DCOLS, DROWS, TerrainType as T} from '../engine/Map/Grid';
import {Monster, MonsterState, MonsterMode} from '../entities/Monster';
import {rng} from '../engine/Random';
import {createHeadlessGame} from './harness';
import {setMachineObservationHook, type MachineTrace} from '../engine/Generator/MachineObservation';
import oracle from './fixtures/u19c-ce-order.json';

const feature=(over:Partial<FeatureDef>={}):FeatureDef=>({instanceCount:[1,1],minimumInstanceCount:1,personalSpace:0,flags:[],...over});
const bp=(features:FeatureDef[],over:Partial<BlueprintDef>={}):BlueprintDef=>({id:'immediate',name:'immediate',ceBlueprintId:900,category:'thematic',depthRange:[1,26],roomSize:[1,900],frequency:1,flags:[],features,...over});
const itemFeature=()=>feature({itemCategory:'POTION',itemId:'potion_of_life',flags:['MF_GENERATE_ITEM']});
function setup(){
 const g:any=createHeadlessGame(19,'test');g.grid=new Grid(DCOLS,DROWS);g.monsters=[];g.dormantMonsters=[];g.items=[];g.depth=10;g.currentLevelDepth=10;g.levelSeeds[9].visited=true;g.levels.clear();g.player.loc={x:0,y:0};g.animationEnabled=false;
 const cells=[];for(let x=5;x<=30;x++)for(let y=5;y<=20;y++){g.grid.setTerrain(x,y,T.FLOOR);cells.push({x,y});}
 const runtime:MachineEntityRuntime=g.createMachineRuntime(g.depth),engine:any=new BlueprintEngine(g.grid,g.depth,[],runtime);
 const room={cells,center:{x:10,y:10},door:null};let index=0;
 vi.spyOn(engine,'findFeaturePosition').mockImplementation(()=>({x:10+(index++)*3,y:10}));
 const apply=(row:BlueprintDef,adoptiveItem:any=null)=>engine.applyBlueprint(row,room,{adoptiveItem});
 rng.seedRandomGenerator(19);resetMachineCounter();
 return {g,runtime,engine,room,apply};
}
function horde(g:any){
 vi.spyOn(g,'hordeCandidates').mockReturnValue([{leader:'GOBLIN',members:[{type:'RAT',minCount:2,maxCount:2}],minLevel:1,maxLevel:26,frequency:1,spawnsIn:null,flags:[]}]);
}
const owned=(g:any)=>[...g.items,...g.player.inventory.items,...g.monsters.flatMap((m:any)=>m.carriedItem?[m.carriedItem]:[]),...g.dormantMonsters.flatMap((m:any)=>m.carriedItem?[m.carriedItem]:[])];
afterEach(()=>{vi.restoreAllMocks();setMachineObservationHook(null);});

describe('U19c immediate machine entities',()=>{
 it('matches the compiled CE call-site RNG oracle before the NEXT feature (allocation stubs only)',()=>{
  const {engine,room}=setup(),events:string[]=[];let draws=0,at=0;
  const event=(name:string,n=1)=>{events.push(`${name}:${draws}`);draws+=n;};
  const made:any[]=[];
  engine.entities={checkpoint:()=>()=>made.splice(0),hasMonster:()=>false,
   item:(spawn:any)=>{event('item');return spawn.entity={loc:{...spawn.pos}};},
   spawn:(spawn:any)=>{if(spawn.hordeFlags)event('horde');const group=Array.from({length:spawn.hordeFlags?3:1},()=>{event('monster');return {id:made.length+1,loc:{...spawn.pos},hp:10};});made.push(...group);return group;},handOff:(spawn:any,item:any)=>{spawn.entities[0].carriedItem=item.entity;}};
  engine.findFeaturePosition=()=>{event('feature');return {x:10+(at++)*10,y:10};};
  const result=engine.applyBlueprint(bp([feature({itemCategory:'POTION',flags:['MF_GENERATE_ITEM','MF_GENERATE_HORDE','MF_MONSTER_TAKE_ITEM','MF_MONSTERS_DORMANT']}),feature({monsterId:'rat',flags:['MF_MONSTER_SLEEPING','MF_MONSTER_FLEEING']})]),room);
  expect(result).not.toBeNull();event('commit',0);
  expect(events).toEqual(oracle.events);expect(draws).toBe(oracle.draws);expect(made).toHaveLength(oracle.created);expect(made.filter(m=>m.carriedItem)).toHaveLength(oracle.carry);
 });
 it('real items, the leader AND every minion exist and occupy cells before the next feature',()=>{
  const {g,engine,apply}=setup();horde(g);let calls=0;
  engine.findFeaturePosition=()=>{if(calls++===1){expect(g.items).toHaveLength(1);expect(g.monsters).toHaveLength(3);for(const m of g.monsters)expect(engine.hasPendingOccupant(m.x,m.y)).toBe(true);expect(g.monsters.slice(1).every((m:any)=>m.leader===g.monsters[0])).toBe(true);}return {x:calls===1?10:20,y:10};};
  const result=apply(bp([feature({...itemFeature(),flags:['MF_GENERATE_ITEM','MF_GENERATE_HORDE']}),feature({monsterId:'rat'})]));
  expect(result.monsterSpawns[0].entities).toHaveLength(3);expect(g.monsters).toHaveLength(4);expect(g.monsters[3].leader).toBe(g.monsters[0]);
 });
 it.each([['MF_MONSTERS_DORMANT'],['MF_MONSTER_SLEEPING'],['MF_MONSTER_FLEEING'],['MF_MONSTERS_DORMANT','MF_MONSTER_SLEEPING','MF_MONSTER_FLEEING']])('applies feature states and machineHome to the whole real horde: %j',(...flags:string[])=>{
  const {g,engine,apply}=setup();horde(g);const result=apply(bp([feature({flags:['MF_GENERATE_HORDE',...flags]})]));
  const monsters=[...g.monsters,...g.dormantMonsters];expect(monsters).toHaveLength(3);
  for(const m of monsters){expect(m.machineHome).toBe(result.machineNumber);expect(m.isDormant).toBe(flags.includes('MF_MONSTERS_DORMANT'));expect(engine.hasPendingOccupant(m.x,m.y)).toBe(!m.isDormant);
   if(flags.includes('MF_MONSTER_FLEEING')){expect(m.state).toBe(MonsterState.FLEEING);expect(m.creatureMode).toBe(MonsterMode.PERM_FLEEING);}
   else if(flags.includes('MF_MONSTER_SLEEPING'))expect(m.state).toBe(MonsterState.ASLEEP);
   else expect(m.state).toBe(MonsterState.HUNTING);
  }
 });
 it('later DF activation sees the real dormant resident, and occupancy changes immediately',()=>{
  const {g,engine,apply}=setup();g.bindDormantAwakener();engine.findFeaturePosition=()=>({x:10,y:10});
  const result=apply(bp([feature({monsterId:'rat',flags:['MF_MONSTERS_DORMANT']}),feature({featureDF:'DF_SHATTERING_SPELL'})]));
  expect(result).not.toBeNull();expect(g.dormantMonsters).toHaveLength(0);expect(g.monsters).toHaveLength(1);expect(engine.hasPendingOccupant(g.monsters[0].x,g.monsters[0].y)).toBe(true);
 });
 it('live item queries follow actual floor ownership after movement/removal, not old recipe coordinates',()=>{
  const {g,engine,apply}=setup();apply(bp([itemFeature()]));const item=g.items[0];expect(engine.hasPendingOccupant(10,10)).toBe(true);
  item.loc={x:22,y:12};expect(engine.hasPendingOccupant(10,10)).toBe(false);expect(engine.hasPendingOccupant(22,12)).toBe(true);
  g.items=[];expect(engine.hasPendingOccupant(22,12)).toBe(false);
 });
 it('initializes each minion BEFORE placement, even when no cell exists; does not rewind RNG',()=>{
  const {g,apply}=setup();horde(g);const events:string[]=[];
  const mutate=g.applyRandomMutation.bind(g);vi.spyOn(g,'applyRandomMutation').mockImplementation((...args:any[])=>{events.push('create');return mutate(...args);});
  const countBefore=rng.getState().randomNumbersGenerated;
  vi.spyOn(g,'findMinionSpawnSpot').mockImplementation(()=>{events.push('place');return null;});
  const result=apply(bp([feature({flags:['MF_GENERATE_HORDE']})]));expect(result).not.toBeNull();expect(events).toEqual(['create','create','place']);expect(g.monsters).toHaveLength(1);expect(rng.getState().randomNumbersGenerated).toBeGreaterThan(countBefore);
 });
 it('rolls back active/dormant horde, floor items, and carrier ownership after a late failure; preserves older entities',()=>{
  const {g,engine,apply}=setup();horde(g);
  const old=apply(bp([itemFeature(),feature({monsterId:'rat'})]));const keepMonster=g.monsters[0],keepItem=g.items[0],before=rng.getState();
  const find=engine.findFeaturePosition;let n=0;engine.findFeaturePosition=(...a:any[])=>++n===4?null:find(...a);
  const result=apply(bp([itemFeature(),feature({monsterId:'goblin',flags:['MF_MONSTERS_DORMANT']}),feature({itemCategory:'KEY',itemId:'iron_key',flags:['MF_GENERATE_ITEM','MF_GENERATE_HORDE','MF_MONSTER_TAKE_ITEM']}),feature({monsterId:'rat'})]));
  expect(result).toBeNull();expect(g.monsters).toEqual([keepMonster]);expect(g.dormantMonsters).toEqual([]);expect(g.items).toEqual([keepItem]);expect(owned(g).filter((i:any)=>i.originDepth===10)).toEqual([keepItem]);expect(rng.getState()).not.toEqual(before);expect(old).not.toBeNull();
  for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)expect(g.grid.getCell(x,y).hasDormantMonster).toBeFalsy();
 });
 it('a failed later machine preserves earlier active AND dormant carriers and their exact item instances',()=>{
  const {g,apply}=setup();
  for(const dormant of [false,true]) expect(apply(bp([feature({itemCategory:'KEY',itemId:'iron_key',monsterId:'rat',flags:['MF_GENERATE_ITEM','MF_MONSTER_TAKE_ITEM',...(dormant?['MF_MONSTERS_DORMANT']:[])]})]))).not.toBeNull();
  const carriers=[...g.monsters,...g.dormantMonsters],items=carriers.map(m=>m.carriedItem);
  expect(apply(bp([feature({itemCategory:'KEY',itemId:'iron_key',flags:['MF_GENERATE_ITEM','MF_MONSTER_TAKE_ITEM']})]))).toBeNull();
  expect(carriers.map(m=>m.carriedItem)).toEqual(items);for(const item of items)expect(owned(g).filter((i:any)=>i===item)).toHaveLength(1);
 });
 it('a successful child is deleted with its failing parent, including its already committed carried item',()=>{
  const {g,engine,apply}=setup();let child:any;const traces:MachineTrace[]=[];setMachineObservationHook(t=>traces.push(t));
  const childBp=bp([feature({itemCategory:'KEY',itemId:'iron_key',monsterId:'rat',flags:['MF_GENERATE_ITEM','MF_MONSTER_TAKE_ITEM','MF_MONSTERS_DORMANT']})],{id:'child'});
  engine.buildAMachine=()=>child=apply(childBp);
  const find=engine.findFeaturePosition;let n=0;engine.findFeaturePosition=(...a:any[])=>++n===3?null:find(...a);
  expect(apply(bp([feature({flags:['MF_BUILD_VESTIBULE']}),feature({monsterId:'rat'})]))).toBeNull();expect(child).not.toBeNull();expect(g.monsters).toEqual([]);expect(g.dormantMonsters).toEqual([]);expect(g.items).toEqual([]);expect(child.monsterSpawns[0].entities[0].carriedItem).toBeNull();expect(traces).toHaveLength(2);expect(traces.every(t=>t.status==='rolled_back')).toBe(true);expect(g.monsters.length+g.dormantMonsters.length).toBe(oracle.afterAbort);
 });
 it('failed adoption retries restore the same parent instance and key metadata, without stale owners',()=>{
  const {g,runtime,apply}=setup();const original:any={instanceId:'parent:0',category:'KEY',id:'iron_key',pos:{x:6,y:6},keyLoc:[{loc:{x:5,y:5},machine:7,disposableHere:true}]};
  runtime.item(original,false);const entity=original.entity,loc={...entity.loc},keys=structuredClone(entity.keyLoc);
  // A later malformed torch causes ownership rejection after adoption and a real spawn.
  const row=bp([feature({monsterId:'rat',flags:['MF_ADOPT_ITEM','MF_MONSTER_TAKE_ITEM'],itemFlags:['ITEM_IS_KEY']}),feature({itemCategory:'KEY',itemId:'iron_key',monsterId:'rat',flags:['MF_GENERATE_ITEM','MF_MONSTER_TAKE_ITEM']})],{flags:['BP_ADOPT_ITEM']});
  expect(apply(row,original)).toBeNull();expect(entity.loc).toEqual(loc);expect(entity.keyLoc).toEqual(keys);expect(g.items).toEqual([]);expect(g.monsters).toEqual([]);
  const successful=apply(bp([feature({monsterId:'rat',flags:['MF_ADOPT_ITEM','MF_MONSTER_TAKE_ITEM']})],{flags:['BP_ADOPT_ITEM']}),original);
  expect(successful).not.toBeNull();expect(g.monsters[0].carriedItem).toBe(entity);expect(owned(g).filter((i:any)=>i===entity)).toHaveLength(1);
 });
 it('missing horde has no phantom occupancy; a required carry without any bearer aborts the transaction',()=>{
  const {g,engine,apply}=setup();vi.spyOn(g,'hordeCandidates').mockReturnValue([]);
  const result=apply(bp([feature({flags:['MF_GENERATE_HORDE']})]));expect(result.monsterSpawns[0].entities).toEqual([]);expect(engine.hasPendingOccupant(10,10)).toBe(false);
  expect(apply(bp([feature({itemCategory:'KEY',itemId:'iron_key',flags:['MF_GENERATE_ITEM','MF_GENERATE_HORDE','MF_MONSTER_TAKE_ITEM']})]))).toBeNull();expect(g.items).toEqual([]);expect(g.monsters).toEqual([]);
 });
 it('replaces explicit occupants quietly, without a second live entity or floor drop',()=>{
  const {g,engine,apply}=setup();engine.findFeaturePosition=()=>({x:10,y:10});const r=apply(bp([feature({monsterId:'rat'}),feature({monsterId:'goblin'})]));
  expect(g.monsters).toHaveLength(1);expect(g.monsters[0].typeId).toBe('goblin');expect(r.monsterSpawns[0].entities[0].hp).toBe(0);expect(g.items).toHaveLength(0);
 });
 it('a later explicit replacement cannot publish an item owned only by a dead torch bearer',()=>{
  const {g,engine,apply}=setup();engine.findFeaturePosition=()=>({x:10,y:10});
  expect(apply(bp([feature({itemCategory:'KEY',itemId:'iron_key',monsterId:'rat',flags:['MF_GENERATE_ITEM','MF_MONSTER_TAKE_ITEM']}),feature({monsterId:'goblin'})]))).toBeNull();expect(g.monsters).toHaveLength(0);expect(g.items).toHaveLength(0);
 });
 it.each([0,-1])('a bearer killed by later construction effects (HP %s) cannot receive the committed item',hp=>{
  const {g,engine,apply}=setup();let n=0;engine.findFeaturePosition=()=>{if(n++)g.monsters[0].hp=hp;return {x:n===1?10:20,y:10};};
  expect(apply(bp([feature({itemCategory:'KEY',itemId:'iron_key',monsterId:'rat',flags:['MF_GENERATE_ITEM','MF_MONSTER_TAKE_ITEM']}),feature()]))).toBeNull();expect(g.monsters).toHaveLength(0);expect(g.items).toHaveLength(0);
 });
 it('commits a single item to its real carrier before population; death/pickup/save retain identity',()=>{
  const {g,apply}=setup();const result=apply(bp([feature({itemCategory:'KEY',itemId:'iron_key',monsterId:'rat',flags:['MF_GENERATE_ITEM','MF_MONSTER_TAKE_ITEM']})]));
  const carrier=g.monsters[0],item=carrier.carriedItem;expect(item).toBe(result.generatedItems[0].entity);expect(owned(g).filter((i:any)=>i===item)).toHaveLength(1);
  const snap=JSON.parse(JSON.stringify(g.toSnapshot()));expect(g.loadSnapshot(snap)).toBe(true);const restored=g.monsters.find((m:Monster)=>m.id===carrier.id);expect(restored.carriedItem.id).toBe(item.id);
  restored.hp=0;g.removeDeadMonsters();g.removeDeadMonsters();expect(g.items.filter((i:any)=>i.id===item.id)).toHaveLength(1);g.player.loc={...g.items.find((i:any)=>i.id===item.id).loc};g.handlePlayerAction('pickup',undefined,'system');expect(g.player.inventory.items.filter((i:any)=>i.id===item.id)).toHaveLength(1);expect(g.items.some((i:any)=>i.id===item.id)).toBe(false);
 });
 it('does not regenerate committed products in populateLevel; U25 sees their actual identities',()=>{
  const {g,apply}=setup(),traces:MachineTrace[]=[];setMachineObservationHook(t=>traces.push(t));
  const r=apply(bp([itemFeature(),feature({itemCategory:'KEY',itemId:'iron_key',monsterId:'rat',flags:['MF_GENERATE_ITEM','MF_MONSTER_TAKE_ITEM']})]));
  const ids=[...g.items,...g.monsters].map((e:any)=>e.id),itemSpawn=vi.spyOn(g,'spawnBlueprintItem');
  g.grid.setTerrain(5,5,T.STAIRS_UP);g.grid.setTerrain(30,20,T.STAIRS_DOWN);g.levelSeeds[9].upStairsLoc={x:5,y:5};g.levelSeeds[9].downStairsLoc={x:30,y:20};g.populateLevel(10,false,false,[r]);
  expect(itemSpawn).not.toHaveBeenCalled();expect(ids.every(id=>[...g.items,...g.monsters].some((e:any)=>e.id===id))).toBe(true);const committed=traces.find(t=>t.machineNumber===r.machineNumber)!;expect(committed.products.filter(p=>p.kind==='monster')).toHaveLength(1);expect(committed.products.filter(p=>p.kind==='item')).toHaveLength(2);
 });
});
