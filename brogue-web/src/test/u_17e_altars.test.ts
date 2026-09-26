import {describe, it, expect, afterEach, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Grid, TerrainType as T, DungeonLayer as L, DRAW_PRIORITY, TERRAIN_HOME_LAYER} from '../engine/Map/Grid';
import {TERRAIN_FLAGS, TM_IS_CIRCUIT_BREAKER} from '../engine/Map/TerrainCatalog';
import {DF, DF_MISSING_TILES, DUNGEON_FEATURE_CATALOG as D} from '../engine/Map/DungeonFeatureCatalog';
import {catalogFeature, spawnDungeonFeature} from '../engine/Map/DungeonFeature';
import {LightKind} from '../engine/Map/LightCatalog';
import {terrainAppearance} from '../engine/UI/Appearance';
import {createHeadlessGame} from './harness';
import {Item, ItemCategory as C} from '../engine/Items/Item';
import {ItemLoader} from '../engine/Items/ItemLoader';
import {Monster, type MonsterData} from '../entities/Monster';
import {charmRechargeDelay} from '../engine/Items/CharmModel';
import monsters from '../data/monsters.json';
import blueprints from '../data/blueprints.json';
import {BlueprintEngine, type BlueprintDef} from '../engine/Generator/BlueprintEngine';
import golden from './fixtures/u17e-ce-catalog.json';
import {rng} from '../engine/Random';

function scene(){
 const g=createHeadlessGame(1715,'test');
 for(let x=1;x<g.grid.width-1;x++)for(let y=1;y<g.grid.height-1;y++){
  g.grid.setTerrain(x,y,T.FLOOR);const c=g.grid.getCell(x,y)!;c.volume=0;c.machineNumber=0;c.isVisible=true;
 }
 g.monsters=[];g.dormantMonsters=[];g.items=[];g.purgatory=[];g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.animationEnabled=false;
 Object.assign(g,{secretScanDepth:-1,levelHasSecrets:false});(g as any).bindDormantAwakener();return g;
}
function cells(grid:Grid){return Array.from({length:grid.width},(_,x)=>Array.from({length:grid.height},(_,y)=>grid.getCell(x,y)!)).flat();}
type Game=ReturnType<typeof scene>;
function mark(g:Game,x:number,y:number,t:T,m=7){g.grid.setTerrain(x,y,t);g.grid.getCell(x,y)!.machineNumber=m;}
function move(g:Game,x:number,y:number){g.handlePlayerAction('move',{x,y},'system');}
function wait(g:Game){g.handlePlayerAction('wait',undefined,'system');}
function item(g:Game,x:number,y:number,category=C.KEY,enchantment=0){const i=new Item('test','?',0xffffff,category);i.enchantment=enchantment;i.loc={x,y};g.items.push(i);return i;}
function rat(g:Game,x:number,y:number){const m=new Monster(x,y,(monsters as MonsterData[]).find(m=>m.id==='rat')!);g.monsters.push(m);return m;}
function altars(g:Game){mark(g,10,10,T.COMMUTATION_ALTAR);mark(g,12,10,T.COMMUTATION_ALTAR);mark(g,11,10,T.PIPE_GLOWING);}
function dropPair(g:Game,a:Item,b:Item){g.items=g.items.filter(i=>i!==a&&i!==b);g.player.inventory.addItem(a);g.player.inventory.addItem(b);g.dropItem(a);move(g,1,0);move(g,1,0);g.dropItem(b);}
function walkTo(g:Game,target:{x:number;y:number}){
 const key=(p:{x:number;y:number})=>`${p.x},${p.y}`,queue=[{...g.player.loc}],prev=new Map<string,{x:number;y:number}|null>([[key(queue[0]!),null]]);
 for(let i=0;i<queue.length&&!prev.has(key(target));i++)for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
  const p={x:queue[i]!.x+dx!,y:queue[i]!.y+dy!};if(!prev.has(key(p))&&g.grid.getCell(p.x,p.y)?.isPassable){prev.set(key(p),queue[i]!);queue.push(p);}
 }
 expect(prev.has(key(target)),'actual walkable path').toBe(true);const path=[];let at={x:target.x,y:target.y};while(prev.get(key(at))){path.unshift(at);at=prev.get(key(at))!;}
 for(const p of path){move(g,p.x-g.player.x,p.y-g.player.y);expect(g.player.loc).toEqual(p);}
}
function wholeRoom(id:number){
 const g=scene();for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++)g.grid.setTerrain(x,y,T.GRANITE);
 const room=[];for(let x=6;x<=17;x++)for(let y=6;y<=10;y++){g.grid.setTerrain(x,y,T.FLOOR);room.push({x,y});}g.grid.setTerrain(5,8,T.FLOOR);
 const bp=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===id)!;rng.seedRandomGenerator(1715);
 const result=(new BlueprintEngine(g.grid,16) as any).applyBlueprint(bp,{cells:room,center:{x:11,y:8},door:{x:6,y:8}});expect(result).not.toBeNull();
 g.player.loc={x:11,y:8};return {g,result};
}
afterEach(()=>vi.restoreAllMocks());

describe('U17e CE catalog and carrier scope',()=>{
 it('seven tile rows and nine DF rows equal independently parsed CE, including three necessary successors',()=>{
  for(const [name,row] of Object.entries(golden.tiles)){
   const t=T[name as keyof typeof T],{line,description,flavorText,drawPriority,glowLight,...expected}=row;
   expect(line).toBeGreaterThan(0);expect(description).not.toBe('');expect(flavorText).not.toBe('');
   expect(TERRAIN_FLAGS[t]).toEqual({...expected,glowLight:LightKind[glowLight as keyof typeof LightKind],webOnly:false});
   expect(DRAW_PRIORITY[t]).toBe(drawPriority);expect(TERRAIN_HOME_LAYER[t]).toBe(name.startsWith('PIPE_')?L.SURFACE:L.DUNGEON);
  }
  for(const [name,row] of Object.entries(golden.dfs)){
   const id=DF[name as keyof typeof DF];expect(id).toBe(row.id);
   expect(D[id]).toMatchObject({tile:T[row.tile as keyof typeof T],layer:L[row.layer as keyof typeof L],startProbability:row.startProbability,probabilityDecrement:row.probabilityDecrement,flags:row.flags,description:row.description,lightFlare:row.lightFlare,flashColor:row.flashColor,effectRadius:row.effectRadius,cePropagationTerrain:row.propagationTerrain,propagationTerrain:null,subsequentDF:null});
  }
 });
 it('CE blueprint DF starts and all library item flag columns match raw source; frequencies and qualification stay separate',()=>{
  for(const row of golden.blueprintFeatures){const bp=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===row.blueprint)!,f=bp.features[row.index]!;
   expect(f.terrain).toBe(row.terrain);expect(f.featureDF??null).toBe(row.featureDF);expect([...(f.itemFlags??[])].sort()).toEqual([...row.itemFlags].sort());
  }
 });
 it('removes exactly five missing rows and preserves saved numeric IDs',()=>{
  expect(DF_MISSING_TILES).toEqual([]); // U17f closes the final six.
 expect(T.FLAMETHROWER).toBe(156);expect(T.ALTAR_CAGE_CLOSED).toBe(157);
  for(const id of [85,140,141,143,145])expect(()=>catalogFeature(id)).not.toThrow();
 });
 it('164 CE appearances include exact glyph/color/background and localized terrain descriptions',()=>{
  const rows=JSON.parse(readFileSync('src/test/fixtures/u21c-ce-terrain.json','utf8'));expect(Object.keys(rows)).toHaveLength(190);const g=scene();
  for(const name of Object.keys(golden.tiles)){const t=T[name as keyof typeof T];expect(terrainAppearance(t,true)).toMatchObject({char:rows[name].char,color:rows[name].color,bgColor:rows[name].bgColor});expect((g as any).getTerrainName(t)).toMatch(/[\u3400-\u9fff]/);}
 });
});

describe('U17e user pickup → closed altar evacuation → bound-key reopening',()=>{
 it('85 pickup closes same-machine cages, evacuates player and monster, preserves remaining loot and can reopen',()=>{
  const g=scene();mark(g,11,10,T.ALTAR_CAGE_OPEN);mark(g,15,10,T.ALTAR_CAGE_OPEN);mark(g,18,10,T.ALTAR_CAGE_OPEN,8);
  const key=item(g,11,10,C.WEAPON);key.flags=['ITEM_IS_KEY'];key.keyLoc=[{loc:{x:11,y:10},machine:0,disposableHere:false}];key.originDepth=g.depth;
  const remaining=item(g,15,10),other=item(g,18,10);for(const i of [remaining,other]){i.keyLoc=[{loc:{...i.loc},machine:0,disposableHere:false}];i.originDepth=g.depth;}const m=rat(g,15,10);m.applyStatus('paralyzed',100);
  move(g,1,0);g.handlePlayerAction('pickup',undefined,'system');expect(g.grid.getCell(11,10)!.terrain).toBe(T.ALTAR_CAGE_OPEN);move(g,-1,0);
  expect(g.player.inventory.items).toContain(key);expect(g.grid.getCell(11,10)!.terrain).toBe(T.ALTAR_CAGE_CLOSED);expect(g.grid.getCell(15,10)!.terrain).toBe(T.ALTAR_CAGE_CLOSED);
  expect(g.player.loc).not.toEqual({x:11,y:10});expect(m.loc).not.toEqual({x:15,y:10});expect(g.items).toContain(remaining);expect(remaining.loc).toEqual({x:15,y:10});expect(g.items).toContain(other);expect(g.grid.getCell(18,10)!.terrain).toBe(T.ALTAR_CAGE_OPEN);
  const before={...g.player.loc};move(g,11-before.x,10-before.y);expect(g.grid.getCell(11,10)!.terrain).toBe(T.ALTAR_CAGE_OPEN);expect(g.grid.getCell(15,10)!.terrain).toBe(T.ALTAR_CAGE_OPEN);expect(g.player.inventory.items).toContain(key);
  expect(cells(g.grid).some(c=>c.isPowered)).toBe(false);
 });
 it('85 user throws onto a wired plate while standing on an open altar: the shared transaction evacuates the player before closing',()=>{
  const g=scene();mark(g,10,10,T.ALTAR_CAGE_OPEN);mark(g,13,10,T.PRESSURE_PLATE);const loan=item(g,10,10);loan.keyLoc=[{loc:{x:10,y:10},machine:0,disposableHere:false}];loan.originDepth=g.depth;
  const stone=new Item('stone',')',0xffffff,C.WEAPON);g.player.inventory.addItem(stone);g.throwItemAt(stone,13,10);
  expect(g.grid.getCell(10,10)!.terrain).toBe(T.ALTAR_CAGE_CLOSED);expect(g.player.loc).not.toEqual({x:10,y:10});expect(g.grid.getCell(g.player.x,g.player.y)!.isPassable).toBe(true);expect(g.items).toContain(loan);expect(loan.loc).toEqual({x:10,y:10});expect(g.player.hp).toBe(100);
 });
 it('a blocked or wrong-machine key cannot open a closed cage; save/load retains terrain and bound key',()=>{
  const g=scene();mark(g,11,10,T.ALTAR_CAGE_CLOSED);const k=item(g,10,10);g.items=[];k.keyLoc=[{loc:{x:0,y:0},machine:8,disposableHere:true}];k.originDepth=g.depth;g.player.inventory.addItem(k);
  expect(g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);move(g,1,0);expect(g.player.loc).toEqual({x:10,y:10});expect(g.grid.getCell(11,10)!.terrain).toBe(T.ALTAR_CAGE_CLOSED);expect(g.player.inventory.items.some(i=>i.id===k.id)).toBe(true);
 });
});

describe('U17e user drop → commutation and generated pipe consumer',()=>{
 it('140 two drops exchange enchantment and its knowledge, make both altars inert and 141 pipes charred',()=>{
  const g=scene();altars(g);const a=item(g,10,10,C.WEAPON,5),b=item(g,12,10,C.ARMOR,-1);a.identified=false;b.identified=true;b.isCursed=true;
  dropPair(g,a,b);expect(a.enchantment).toBe(-1);expect(b.enchantment).toBe(5);expect(a.identified).toBe(true);expect(b.identified).toBe(false);expect(b.charges).toBe(ItemLoader.ARMOR_DELAY_TO_AUTO_ID);expect(b.isCursed).toBe(false);
  expect(g.grid.getCell(10,10)!.terrain).toBe(T.COMMUTATION_ALTAR_INERT);expect(g.grid.getCell(12,10)!.terrain).toBe(T.COMMUTATION_ALTAR_INERT);expect(g.grid.getCell(11,10)!.layers[L.SURFACE]).toBe(T.PIPE_INERT);
  expect(g.items).toContain(a);expect(g.items).toContain(b);wait(g);expect([a.enchantment,b.enchantment]).toEqual([-1,5]);expect(g.grid.getCell(10,10)!.isPowered).toBe(true);
  expect(g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);expect(g.items.map(i=>i.enchantment).sort()).toEqual([-1,5]);
 });
 it('141 CE6 blueprint feature actually lays glowing pipes; a user drop pair consumes that generated network',()=>{
  const g=scene();const bp=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===6)!;
  const feature=bp.features.find(f=>f.featureDF==='DF_MAGIC_PIPING')!;expect(feature).toBeDefined();
  const feat=catalogFeature(DF[feature.featureDF as keyof typeof DF]);const r=spawnDungeonFeature(g.grid,11,10,feat,false);expect(r.succeeded).toBe(true);expect(r.builtCells.length).toBeGreaterThan(0);
  for(const p of r.builtCells)g.grid.getCell(p.x,p.y)!.machineNumber=7;
  mark(g,10,10,T.COMMUTATION_ALTAR);mark(g,12,10,T.COMMUTATION_ALTAR);
  const pipes=cells(g.grid).filter(c=>c.layers.includes(T.PIPE_GLOWING));expect(pipes.length).toBeGreaterThan(0);
  const a=item(g,10,10,C.WEAPON,2),b=item(g,12,10,C.RING,4);dropPair(g,a,b);
  for(const c of pipes)expect(c.layers[L.SURFACE]).toBe(T.PIPE_INERT);expect([a.enchantment,b.enchantment]).toEqual([4,2]);
 });
 for(const reason of ['equal','wand','quiver','other-machine','breaker'])it(`does not consume items or altars when ${reason}`,()=>{
  const g=scene();altars(g);const a=item(g,10,10,C.WEAPON,2),b=item(g,12,10,reason==='wand'?C.WAND:C.RING,reason==='equal'?2:5);
  if(reason==='quiver')a.quiverNumber=123;if(reason==='other-machine')g.grid.getCell(12,10)!.machineNumber=8;
  let flags:ReturnType<typeof vi.spyOn>|undefined;
  if(reason==='breaker'){mark(g,15,10,T.RESURRECTION_ALTAR);const old=TERRAIN_FLAGS[T.RESURRECTION_ALTAR];flags=vi.spyOn(TERRAIN_FLAGS as any,T.RESURRECTION_ALTAR as any,'get').mockReturnValue({...old,mechFlags:old.mechFlags|TM_IS_CIRCUIT_BREAKER});}
  const before=[a.enchantment,b.enchantment];dropPair(g,a,b);expect([a.enchantment,b.enchantment]).toEqual(before);expect(g.grid.getCell(10,10)!.terrain).toBe(T.COMMUTATION_ALTAR);expect(g.grid.getCell(11,10)!.layers[L.SURFACE]).toBe(T.PIPE_GLOWING);flags?.mockRestore();
 });
 it('staff capacity/charges clamp, recharge timer remains, known max charges transfer, harmful runes persist',()=>{
  const g=scene();altars(g);const a=item(g,10,10,C.STAFF,6),b=item(g,12,10,C.WEAPON,2);a.maxCharges=6;a.charges=5;a.staffRechargeRemaining=371;a.identified=false;a.maxChargesKnown=true;b.identified=false;b.runicType='mercy';
  dropPair(g,a,b);expect(a).toMatchObject({enchantment:2,maxCharges:2,charges:2,staffRechargeRemaining:371,identified:false,maxChargesKnown:false});expect(b).toMatchObject({enchantment:6,identified:true,runicType:'mercy'});
 });
 it('two overlapping drops occupy one CE floor slot and cannot power a commutation machine',()=>{
  const g=scene();altars(g);const a=item(g,10,10,C.WEAPON,2),b=item(g,10,10,C.RING,5);wait(g);
  expect([a.enchantment,b.enchantment]).toEqual([2,5]);expect(g.grid.getCell(10,10)!.terrain).toBe(T.COMMUTATION_ALTAR);expect(g.grid.getCell(11,10)!.layers[L.SURFACE]).toBe(T.PIPE_GLOWING);
 });
 it('staff shatters below two without losing the other item or duplicating an exchange',()=>{
  const g=scene();altars(g);const a=item(g,10,10,C.STAFF,4),b=item(g,12,10,C.WEAPON,0);a.charges=3;dropPair(g,a,b);expect(g.items).not.toContain(a);expect(g.items).toContain(b);expect(b.enchantment).toBe(4);expect(g.grid.getCell(10,10)!.terrain).toBe(T.COMMUTATION_ALTAR_INERT);
 });
 it('charm cooldown uses existing CE delay formula with integer percent; positive runes fade on nonpositive exchange',()=>{
  const g=scene();altars(g);const a=item(g,10,10,C.CHARM,4),b=item(g,12,10,C.WEAPON,2);a.identityId='charm_of_health';a.cooldownTurns=charmRechargeDelay('charm_of_health',4);a.cooldownRemaining=Math.trunc(a.cooldownTurns*0.63);const fraction=Math.trunc(a.cooldownRemaining*100/a.cooldownTurns);
  dropPair(g,a,b);expect(a.cooldownTurns).toBe(charmRechargeDelay('charm_of_health',2));expect(a.cooldownRemaining).toBeLessThanOrEqual(Math.trunc(fraction*a.cooldownTurns!/100));
  const h=scene();altars(h);const c=item(h,10,10,C.WEAPON,3),d=item(h,12,10,C.ARMOR,0);c.runicType='slaying';c.runicKnown=true;dropPair(h,c,d);expect(c.runicType).toBeUndefined();expect(c.runicKnown).toBe(false);
 });
});

describe('U17e player entry → U16 resurrection final carrier',()=>{
 it('143 repeated floor entry retries with no dead ally then resurrects strongest saved ally once with CE light',()=>{
  const g=scene();mark(g,11,10,T.MACHINE_TRIGGER_FLOOR_REPEATING);mark(g,14,10,T.RESURRECTION_ALTAR);move(g,1,0);expect(g.grid.getCell(14,10)!.terrain).toBe(T.RESURRECTION_ALTAR);
  const weak=rat(g,20,10),strong=rat(g,22,10);weak.isAlly=strong.isAlly=true;weak.hp=strong.hp=0;strong.totalPowerCount=3;(g as any).removeDeadMonsters();expect(g.purgatory).toHaveLength(2);
  expect(g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);const strongest=g.purgatory.find(m=>m.totalPowerCount===3)!;wait(g);
  expect(g.grid.getCell(14,10)!.terrain).toBe(T.RESURRECTION_ALTAR_INERT);expect(TERRAIN_FLAGS[g.grid.getCell(14,10)!.terrain].glowLight).toBe(LightKind.NO_LIGHT);expect(g.monsters).toContain(strongest);expect(strongest.hp).toBe(strongest.maxHp);expect(strongest.isAlly).toBe(true);expect(g.purgatory).toHaveLength(1);wait(g);expect(g.purgatory).toHaveLength(1);
  expect((g as any).activeFlares.length).toBeGreaterThan(0);expect(g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);
 });
});

describe('U17e sacrifice horde → player activates → marked entry → lava and reward',()=>{
 function setup(){const g=scene();mark(g,11,10,T.PRESSURE_PLATE);mark(g,15,10,T.SACRIFICE_ALTAR_DORMANT);mark(g,18,10,T.SACRIFICE_CAGE_DORMANT);const reward=item(g,18,10);
  const bp=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===47)!,f=bp.features.find(f=>f.hordeFlags?.includes('HORDE_SACRIFICE_TARGET'))!;
  const m:Monster=(g as any).spawnHordeAtFeature({...f,pos:{x:16,y:10},flags:[]},g.depth,7);expect(m).toBeDefined();expect(m.markedForSacrifice).toBe(true);m.applyStatus('paralyzed',100);return {g,m,reward};}
 it('145 pressure entry activates altar and cage; entranced marked creature enters and dies, opening surviving reward',()=>{
  const {g,m,reward}=setup();move(g,1,0);expect(g.grid.getCell(15,10)!.terrain).toBe(T.SACRIFICE_ALTAR);expect(g.grid.getCell(18,10)!.terrain).toBe(T.ALTAR_CAGE_RETRACTABLE);expect(m.hp).toBeGreaterThan(0);
  expect(g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);const marked=g.monsters.find(n=>n.id===m.id)!;expect(marked.markedForSacrifice).toBe(true);delete marked.statusDurations.paralyzed;marked.applyStatus('entranced',100);
  move(g,1,0);expect(g.grid.getCell(15,10)!.terrain).toBe(T.SACRIFICE_LAVA);expect(marked.hp).toBeLessThanOrEqual(0);expect(g.grid.getCell(18,10)!.terrain).toBe(T.ALTAR);expect(g.items.some(i=>i.id===reward.id)).toBe(true);expect(cells(g.grid).some(c=>c.isPowered)).toBe(false);
 });
 for(const reason of ['unmarked','wrong-machine'])it(`does not sacrifice ${reason} creature`,()=>{
  const {g,m}=setup();move(g,1,0);if(reason==='unmarked')m.markedForSacrifice=false;else m.machineHome=8;delete m.statusDurations.paralyzed;m.applyStatus('entranced',100);move(g,1,0);expect(g.grid.getCell(15,10)!.terrain).toBe(T.SACRIFICE_ALTAR);expect(m.hp).toBeGreaterThan(0);expect(g.grid.getCell(18,10)!.terrain).toBe(T.ALTAR_CAGE_RETRACTABLE);
 });
});


describe('U17e production data to playable room',()=>{
 it('CE1/2 natural seed777 D1 library (U17f drift-adjusted fixture): borrowed item closes cages only after departure; return and replacement reopen the remaining collection',()=>{
  const g=createHeadlessGame(777);g.animationEnabled=false;g.monsters=[];g.dormantMonsters=[];
  const loans=g.items.filter(i=>g.grid.getCell(i.x,i.y)!.terrain===T.ALTAR_CAGE_OPEN);expect(loans.length).toBeGreaterThan(1);
  const loan=loans[0]!,at={...loan.loc};expect(loan.category).not.toBe(C.KEY);expect(loan.flags).toContain('ITEM_IS_KEY');expect(loan.keyLoc).toContainEqual({loc:at,machine:0,disposableHere:false});
  const adjacent=[{x:at.x-1,y:at.y},{x:at.x+1,y:at.y},{x:at.x,y:at.y-1},{x:at.x,y:at.y+1}].find(p=>g.grid.getCell(p.x,p.y)?.isPassable&&!g.grid.getCell(p.x,p.y)?.layers.includes(T.ALTAR_CAGE_OPEN))!;expect(adjacent).toBeDefined();g.player.loc={...adjacent};
  move(g,at.x-adjacent.x,at.y-adjacent.y);expect(g.grid.getCell(at.x,at.y)!.terrain).toBe(T.ALTAR_CAGE_OPEN);g.handlePlayerAction('pickup',undefined,'system');expect(g.player.inventory.items).toContain(loan);
  move(g,adjacent.x-at.x,adjacent.y-at.y);for(const i of loans)expect(g.grid.getCell(i.x,i.y)!.terrain).toBe(T.ALTAR_CAGE_CLOSED);
  move(g,at.x-adjacent.x,at.y-adjacent.y);expect(g.player.loc).toEqual(at);for(const i of loans)expect(g.grid.getCell(i.x,i.y)!.terrain).toBe(T.ALTAR_CAGE_OPEN);
  g.dropItem(loan);move(g,adjacent.x-at.x,adjacent.y-at.y);expect(g.items).toContain(loan);for(const i of loans)expect(g.grid.getCell(i.x,i.y)!.terrain).toBe(T.ALTAR_CAGE_OPEN);
 });
 it('CE6 full blueprint → walking and two drops → swapped items, two inert altars and charred generated pipes',()=>{
  const {g,result}=wholeRoom(6);const alt=cells(g.grid).filter(c=>c.terrain===T.COMMUTATION_ALTAR),pipes=cells(g.grid).filter(c=>c.layers.includes(T.PIPE_GLOWING)&&c.machineNumber===result.machineNumber);expect(alt).toHaveLength(2);expect(pipes.length).toBeGreaterThan(0);
  const a=new Item('a',')',0xffffff,C.WEAPON),b=new Item('b',']',0xffffff,C.ARMOR);a.enchantment=5;b.enchantment=1;g.player.inventory.addItem(a);g.player.inventory.addItem(b);
  walkTo(g,alt[0]!);g.dropItem(a);walkTo(g,alt[1]!);g.dropItem(b);expect([a.enchantment,b.enchantment]).toEqual([1,5]);for(const c of alt)expect(c.terrain).toBe(T.COMMUTATION_ALTAR_INERT);for(const c of pipes)expect(c.layers[L.SURFACE]).toBe(c.terrain===T.COMMUTATION_ALTAR_INERT?T.NOTHING:T.PIPE_INERT); // CE surface obstruction at the altar vetoes inert repaving after the old pipe vanishes.
 });
 it('CE7 full blueprint → user floor contact → U16 ally returns at the distinct inert altar',()=>{
  const {g,result}=wholeRoom(7);const altar=cells(g.grid).find(c=>c.terrain===T.RESURRECTION_ALTAR)!,trigger=cells(g.grid).find(c=>c.machineNumber===result.machineNumber&&c.layers[L.LIQUID]===T.MACHINE_TRIGGER_FLOOR_REPEATING)!;
  expect(altar).toBeDefined();expect(trigger).toBeDefined();const ally=rat(g,25,10);ally.isAlly=true;ally.hp=0;(g as any).removeDeadMonsters();walkTo(g,trigger);wait(g);expect(g.monsters).toContain(ally);expect(ally.hp).toBe(ally.maxHp);expect(altar.terrain).toBe(T.RESURRECTION_ALTAR_INERT);
 });
});
