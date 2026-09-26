import {beforeEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Grid, TerrainType as T, DungeonLayer as L, DRAW_PRIORITY} from '../engine/Map/Grid';
import {DF, DF_MISSING_TILES, DUNGEON_FEATURE_CATALOG} from '../engine/Map/DungeonFeatureCatalog';
import {TERRAIN_FLAGS, T_OBSTRUCTS_VISION, T_AUTO_DESCENT} from '../engine/Map/TerrainCatalog';
import {LightKind} from '../engine/Map/LightCatalog';
import {catalogFeature, spawnDungeonFeature, cellTerrainFlags, setDungeonFeatureEffects} from '../engine/Map/DungeonFeature';
import {promoteTile, exposeTileToFire} from '../engine/Map/Promotion';
import {rng} from '../engine/Random';
import {createHeadlessGame} from './harness';
import {Game} from '../engine/Core/Game';
import {Item, ItemCategory} from '../engine/Items/Item';
import {Monster, type MonsterData} from '../entities/Monster';
import monsters from '../data/monsters.json';
import {getBoltForItem} from '../engine/Combat/Bolt';
import golden from './fixtures/u17b-ce-catalog.json';

const restored=[61,66,104,83,98];
function scene(){
 const g=createHeadlessGame(1718,'test');
 for(let x=1;x<g.grid.width-1;x++)for(let y=1;y<g.grid.height-1;y++){
  const c=g.grid.getCell(x,y)!;c.layers=[T.FLOOR,T.NOTHING,T.NOTHING,T.NOTHING];c.volume=0;c.machineNumber=0;c.isVisible=true;
 }
 g.monsters=[];g.dormantMonsters=[];g.items=[];g.player.loc={x:5,y:5};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.animationEnabled=false;
 (g as any).bindDormantAwakener();return g;
}
function advance(g:Game){(g as any).updateEnvironment();}
function fire(g:Game,x:number,y:number){
 const staff=new Item('fire','/',0xffffff,ItemCategory.STAFF);Object.assign(staff,{identityId:'staff_of_fire',enchantment:2,charges:2,maxCharges:2,arcanaInstanceVersion:1});
 return g.zapBoltFromPlayer(getBoltForItem('staff_of_fire')!,staff,{x,y});
}
function key(g:Game,disposable=true){const i=new Item('key','⚷',0xffffff,ItemCategory.KEY);i.originDepth=g.depth;i.keyLoc=[{loc:{x:6,y:5},machine:9,disposableHere:disposable}];g.player.inventory.addItem(i);return i;}
function rat(g:Game,x:number,y:number){const m=new Monster(x,y,(monsters as MonsterData[]).find(m=>m.id==='rat')!);m.hp=m.maxHp=100;g.monsters.push(m);return m;}
function forcePromotion(value:number){const original=rng.randRange.bind(rng);return vi.spyOn(rng,'randRange').mockImplementation((a,b)=>a===0&&b===10000?value:original(a,b));}
beforeEach(()=>{vi.restoreAllMocks();rng.seedRandomGenerator(1718);});

describe('U17b CE data / closed first family',()=>{
 it('five complete tile rows come from CE, including flags, all three chains and glow',()=>{
  for(const [name,row] of Object.entries(golden.tiles)){
   const t=T[name as keyof typeof T];const {line,description,flavorText,drawPriority,glowLight,...expected}=row;
   expect(line).toBeGreaterThan(0);expect(description).not.toBe('');expect(flavorText).not.toBe('');
   expect(TERRAIN_FLAGS[t]).toEqual({...expected,glowLight:LightKind[glowLight as keyof typeof LightKind],webOnly:false});expect(DRAW_PRIORITY[t]).toBe(drawPriority);
  }
 });
 it('nine CE DF rows include the new regrowth successor and all inherited edge fields',()=>{
  for(const [name,row] of Object.entries(golden.dfs)){
   const id=DF[name as keyof typeof DF];expect(id).toBe(row.id);const f=DUNGEON_FEATURE_CATALOG[id]!;
   expect(f).toMatchObject({tile:T[row.tile as keyof typeof T],layer:L[row.layer as keyof typeof L],startProbability:row.startProbability,probabilityDecrement:row.probabilityDecrement,flags:row.flags,description:row.description,lightFlare:row.lightFlare,flashColor:row.flashColor,effectRadius:row.effectRadius,cePropagationTerrain:row.propagationTerrain,propagationTerrain:row.propagationTerrain?T[row.propagationTerrain as keyof typeof T]:null,subsequentDF:row.subsequentDF?DF[row.subsequentDF as keyof typeof DF]:null});
  }
 });
 it('historical U17b missing projection excludes exactly the five U17c and nine U17d closures',()=>{
  expect(DF_MISSING_TILES).toEqual([]); // U17f final six closures; preserve the empty guard.
 });
 it('appearance golden extension keeps every previous row byte-equivalent in value',()=>{
  const rows=JSON.parse(readFileSync('src/test/fixtures/u21c-ce-terrain.json','utf8'));
  for(const name of Object.keys(golden.tiles))expect(rows[name].ceLine).toBe(golden.tiles[name as keyof typeof golden.tiles].line);
  expect(Object.keys(rows)).toHaveLength(190);expect(restored.every(id=>!DF_MISSING_TILES.includes(id))).toBe(true);
 });
});

describe('U17b triggers reach final terrain, entities, light and persistence',()=>{
 it('61 actual step tramples foliage, opens sight; moving away allows regrowth; occupied regrowth retramples synchronously',()=>{
  const g=scene();g.grid.setTerrainLayer(6,5,L.SURFACE,T.FOLIAGE);
  g.handlePlayerAction('move',{x:1,y:0},'system');expect(g.player.loc).toEqual({x:6,y:5});expect(g.grid.getCell(6,5)!.layers[L.SURFACE]).toBe(T.TRAMPLED_FOLIAGE);
  expect(cellTerrainFlags(g.grid,6,5)&T_OBSTRUCTS_VISION).toBe(0);expect(g.grid.getCell(6,5)!.isOpaque).toBe(false);
  promoteTile(g.grid,6,5,L.SURFACE,false);expect(g.grid.getCell(6,5)!.layers[L.SURFACE]).toBe(T.TRAMPLED_FOLIAGE);
  g.handlePlayerAction('move',{x:1,y:0},'system');promoteTile(g.grid,6,5,L.SURFACE,false);expect(g.grid.getCell(6,5)!.layers[L.SURFACE]).toBe(T.FOLIAGE);expect(g.grid.getCell(6,5)!.isOpaque).toBe(true);
 });
 it('61 fallen item also tramples regrowth; other layers block regrowth according to CE priority',()=>{
  const g=scene(),i=new Item('stone',')',0xffffff,ItemCategory.WEAPON);i.loc={x:8,y:5};g.items.push(i);
  g.grid.setTerrainLayer(8,5,L.SURFACE,T.TRAMPLED_FOLIAGE);promoteTile(g.grid,8,5,L.SURFACE,false);
  expect(g.grid.getCell(8,5)!.layers[L.SURFACE]).toBe(T.FOLIAGE);advance(g);
  expect(g.grid.getCell(8,5)!.layers[L.SURFACE]).toBe(T.TRAMPLED_FOLIAGE);
  g.grid.setTerrainLayer(9,5,L.DUNGEON,T.WALL);g.grid.setTerrainLayer(9,5,L.SURFACE,T.TRAMPLED_FOLIAGE);promoteTile(g.grid,9,5,L.SURFACE,false);expect(g.grid.getCell(9,5)!.layers[L.SURFACE]).toBe(T.NOTHING);
 });
 it('66 environment activates inert brimstone at 800/10000 boundary, never an invented explosion',()=>{
  const g=scene();g.grid.setTerrainLayer(8,5,L.LIQUID,T.INERT_BRIMSTONE);const roll=forcePromotion(800);advance(g);expect(g.grid.getCell(8,5)!.layers[L.LIQUID]).toBe(T.INERT_BRIMSTONE);roll.mockRestore();forcePromotion(799);advance(g);expect(g.grid.getCell(8,5)!.layers[L.LIQUID]).toBe(T.ACTIVE_BRIMSTONE);expect(g.grid.getCell(8,5)!.layers[L.SURFACE]).toBe(T.NOTHING);
 });
 it('104 player fire bolt ignites ACTIVE into INERT + sulfur fire, burns an occupant and scroll through the shared transaction',()=>{
  const g=scene();g.grid.setTerrainLayer(8,5,L.LIQUID,T.ACTIVE_BRIMSTONE);const m=rat(g,8,5);
  const scroll=new Item('scroll','?',0xffffff,ItemCategory.SCROLL);scroll.loc={x:8,y:5};g.items.push(scroll);
  fire(g,8,5);expect(g.grid.getCell(8,5)!.layers[L.LIQUID]).toBe(T.INERT_BRIMSTONE);expect((g as any).burningDuration(m)).toBeGreaterThan(0);expect(g.items).not.toContain(scroll);
  // burnItem's own DF_ITEM_FIRE can replace the sulfur fire at the same priority.
  expect(g.grid.getCell(8,5)!.isBurning).toBe(true);expect((g as any).pendingCaughtFireCells).toContainEqual({x:8,y:5});
 });
 it('104 active timeout at 10/10000 creates sulfur fire/light; 2500/10000 expiry leaves liquid, no embers',()=>{
  const g=scene();g.grid.setTerrainLayer(8,5,L.LIQUID,T.ACTIVE_BRIMSTONE);let r=forcePromotion(10);advance(g);expect(g.grid.getCell(8,5)!.layers[L.SURFACE]).toBe(T.NOTHING);r.mockRestore();r=forcePromotion(9);advance(g);r.mockRestore();expect(g.grid.getCell(8,5)!.layers[L.SURFACE]).toBe(T.BRIMSTONE_FIRE);expect(TERRAIN_FLAGS[T.BRIMSTONE_FIRE].glowLight).toBe(LightKind.BRIMSTONE_FIRE_LIGHT);
  // Clear the caught-this-turn exemption, then force exactly the fire threshold.
  (g as any).pendingCaughtFireCells=[];r=forcePromotion(2500);advance(g);expect(g.grid.getCell(8,5)!.layers[L.SURFACE]).toBe(T.BRIMSTONE_FIRE);r.mockRestore();forcePromotion(2499);advance(g);expect(g.grid.getCell(8,5)!.layers[L.SURFACE]).toBe(T.NOTHING);expect(g.grid.getCell(8,5)!.layers[L.LIQUID]).toBe(T.INERT_BRIMSTONE);
 });
 it('83 wrong key leaves lock, matching key bump opens iron door, emits flare, consumes disposable key; later steps never reclose it',()=>{
  const g=scene();g.grid.setTerrain(6,5,T.LOCKED_DOOR);g.grid.getCell(6,5)!.machineNumber=9;
  const i=key(g);i.originDepth=2;g.handlePlayerAction('move',{x:1,y:0},'system');expect(g.grid.getCell(6,5)!.terrain).toBe(T.LOCKED_DOOR);expect(g.player.inventory.items).toContain(i);
  i.originDepth=g.depth;g.handlePlayerAction('move',{x:1,y:0},'system');expect(g.grid.getCell(6,5)!.layers[L.DUNGEON]).toBe(T.OPEN_IRON_DOOR_INERT);expect(g.player.inventory.items).not.toContain(i);expect((g as any).activeFlares.length).toBeGreaterThan(0);
  g.handlePlayerAction('move',{x:1,y:0},'system');expect(g.player.loc).toEqual({x:6,y:5});for(let n=0;n<4;n++)advance(g);expect(g.grid.getCell(6,5)!.layers[L.DUNGEON]).toBe(T.OPEN_IRON_DOOR_INERT);
 });
 it('83 reusable key persists; snapshot retains the iron tile, passability and appearance name',()=>{
  const g=scene();g.grid.setTerrain(6,5,T.LOCKED_DOOR);const i=key(g,false);g.handlePlayerAction('move',{x:1,y:0},'system');expect(g.player.inventory.items).toContain(i);
  const saved=JSON.parse(JSON.stringify(g.toSnapshot())),h=scene();expect(h.loadSnapshot(saved)).toBe(true);expect(h.grid.getCell(6,5)!.layers[L.DUNGEON]).toBe(T.OPEN_IRON_DOOR_INERT);expect((h as any).canMoveTo(6,5)).toBe(true);
 });
 it('98 fire bolt collapses a rope span only, successor walks the bridge, then creature falls; stone bridge is nonflammable',()=>{
  const g=scene();for(let x=8;x<=12;x++)g.grid.setTerrainLayer(x,5,L.LIQUID,T.BRIDGE);g.grid.setTerrainLayer(10,6,L.LIQUID,T.STONE_BRIDGE);const m=rat(g,10,5);
  // Fire perpendicular to the span so the bolt does not itself ignite every segment.
  g.player.loc={x:8,y:2};fire(g,8,5);expect(g.grid.getCell(8,5)!.layers[L.LIQUID]).toBe(T.CHASM);
  expect(g.grid.getCell(9,5)!.layers[L.LIQUID]).toBe(T.BRIDGE_FALLING);expect(g.grid.getCell(10,6)!.layers[L.LIQUID]).toBe(T.STONE_BRIDGE);
  forcePromotion(0);for(let n=0;n<8;n++)advance(g);
  for(let x=8;x<=12;x++)expect(g.grid.getCell(x,5)!.layers[L.LIQUID]).toBe(T.CHASM);
  expect(g.monsters).not.toContain(m);expect((g as any).pendingFallenByDepth.get(2)).toContain(m);expect(m.hp).toBeLessThan(100);
 });
 it('98 a levitating player remains above the collapsed bridge; an earthbound player falls at turn boundary',()=>{
  const g=scene();g.grid.setTerrainLayer(5,5,L.LIQUID,T.BRIDGE);g.player.applyStatus('levitating',20);
  exposeTileToFire(g.grid,5,5,true);expect(cellTerrainFlags(g.grid,5,5)&T_AUTO_DESCENT).not.toBe(0);expect((g as any).playerFalling).toBe(false);
  g.player.statusDurations.levitating=0;(g as any).applyDungeonFeatureContact(g.player);
  g.handlePlayerAction('wait',undefined,'system');expect(g.depth).toBe(2);
 });
 it('no evacuation is invented: all five DFs preserve position; brimstone contact still ignites',()=>{
  const g=new Grid(7,7),instant=vi.fn(),creature={loc:{x:3,y:3},forbiddenTerrain:0};g.setTerrain(3,3,T.FLOOR);
  setDungeonFeatureEffects(g,{creatures:()=>[creature],instantEffects:instant});
  for(const id of restored){spawnDungeonFeature(g,3,3,catalogFeature(id),false);expect(creature.loc).toEqual({x:3,y:3});}expect(instant).toHaveBeenCalled();
 });
 it('bridge floor item fall: potion shatters, weapon queues exactly once, survives save/load and new-level landing',()=>{
  const g=scene(),weapon=new Item('sword',')',0xffffff,ItemCategory.WEAPON),potion=new Item('potion','!',0xffffff,ItemCategory.POTION);
  weapon.loc={x:10,y:5};potion.loc={x:11,y:5};g.items.push(weapon,potion);g.grid.setTerrainLayer(10,5,L.LIQUID,T.BRIDGE_FALLING);g.grid.setTerrainLayer(11,5,L.LIQUID,T.BRIDGE_FALLING);(g as any).absoluteTurnNumber=77;forcePromotion(0);advance(g);vi.restoreAllMocks();
  expect(g.items).toHaveLength(0);expect((g as any).pendingFallenItemsByDepth.get(2)).toEqual([weapon]);expect(weapon.spawnTurnNumber).toBe(77);
  const saved=JSON.parse(JSON.stringify(g.toSnapshot())),h=scene();expect(h.loadSnapshot(saved)).toBe(true);const queued=(h as any).pendingFallenItemsByDepth.get(2)[0];expect(queued.id).toBe(weapon.id);expect(queued.spawnTurnNumber).toBe(77);
  h.mode='normal';h.depth=2;(h as any).generateDepth(false,false);expect((h as any).pendingFallenItemsByDepth.has(2)).toBe(false);expect(h.items.filter(i=>i.id===weapon.id)).toHaveLength(1);
  h.startNewGame({seed:1,mode:'test'});expect((h as any).pendingFallenItemsByDepth.size).toBe(0);
 });
 it('fall landing uses item-only CE terrain veto: allows liquid, excludes occupied/machine/stair cells, and delays future catch-up',()=>{
  const g=scene(),i=new Item('weapon',')',0xffffff,ItemCategory.WEAPON);i.loc={x:8,y:5};i.spawnTurnNumber=90;
  g.grid.setTerrainLayer(8,5,L.LIQUID,T.CHASM);(g as any).pendingFallenItemsByDepth.set(1,[i]);(g as any).restoreFallenItems();expect(i.loc).toEqual({x:8,y:5});
  (g as any).absoluteTurnNumber=89;advance(g);expect(g.items).toContain(i);(g as any).absoluteTurnNumber=90;advance(g);expect(g.items).not.toContain(i);expect((g as any).pendingFallenItemsByDepth.get(2)).toEqual([i]);
  const j=new Item('key','k',0xffffff,ItemCategory.KEY);j.loc={x:10,y:5};g.grid.getCell(10,5)!.machineNumber=7;(g as any).pendingFallenItemsByDepth.set(1,[j]);(g as any).restoreFallenItems();expect(j.loc).not.toEqual({x:10,y:5});expect(g.grid.getCell(j.x,j.y)!.machineNumber).toBe(0);
 });
 it('D40 floor falls destroy even nonpotions without a D41 queue',()=>{
  const g=scene();g.depth=40;const i=new Item('amulet',',',0xffffff,ItemCategory.AMULET);i.loc={x:8,y:5};g.items.push(i);g.grid.setTerrainLayer(8,5,L.LIQUID,T.CHASM);advance(g);expect(g.items).toHaveLength(0);expect((g as any).pendingFallenItemsByDepth.size).toBe(0);
 });
});

it('fallen-item restore runs before the new-level RNG reseed, once; cached lower floors consume the same ownership queue',()=>{
 const g=scene();g.mode='normal';const calls:string[]=[];
 const seed=rng.seedRandomGenerator.bind(rng);vi.spyOn(rng,'seedRandomGenerator').mockImplementation(s=>{calls.push('seed');return seed(s);});
 const restore=(g as any).restoreFallenItems.bind(g);vi.spyOn(g as any,'restoreFallenItems').mockImplementation(()=>{calls.push('items');return restore();});
 g.depth=2;(g as any).generateDepth(false,false);
 const i=calls.indexOf('items');expect(i).toBeGreaterThan(0);expect(calls.filter(c=>c==='items')).toHaveLength(1);expect(calls.slice(i+1)).toContain('seed');
 // Returning to an already visited floor must keep the entity graph identity.
 g.depth=1;(g as any).generateDepth(true,false);
 const item=new Item('sword',')',0xffffff,ItemCategory.WEAPON);item.loc={x:10,y:10};g.items.push(item);g.grid.setTerrainLayer(10,10,L.LIQUID,T.CHASM);(g as any).fallFloorItems();
 expect((g as any).pendingFallenItemsByDepth.get(2)).toEqual([item]);
 const snapshot=JSON.parse(JSON.stringify(g.toSnapshot())),h=scene();expect(h.loadSnapshot(snapshot)).toBe(true);
 h.depth=2;(h as any).generateDepth(false,false);expect(h.items.filter(x=>x.id===item.id)).toHaveLength(1);expect((h as any).pendingFallenItemsByDepth.has(2)).toBe(false);
 h.depth=1;(h as any).generateDepth(true,false);expect(h.items.some(x=>x.id===item.id)).toBe(false);
});

it('fallen items on existing fire/lava burn before drifting; amulet survives lava and future items wait',()=>{
 const g=scene(),scroll=new Item('scroll','?',0xffffff,ItemCategory.SCROLL),weapon=new Item('sword',')',0xffffff,ItemCategory.WEAPON),amulet=new Item('amulet',',',0xffffff,ItemCategory.AMULET);
 scroll.loc={x:8,y:5};weapon.loc={x:10,y:5};amulet.loc={x:12,y:5};
 g.grid.setTerrainLayer(8,5,L.SURFACE,T.BRIMSTONE_FIRE);g.grid.setTerrainLayer(10,5,L.LIQUID,T.LAVA);g.grid.setTerrainLayer(12,5,L.LIQUID,T.LAVA);
 for(const item of [scroll,weapon,amulet])item.spawnTurnNumber=90;
 (g as any).pendingFallenItemsByDepth.set(1,[scroll,weapon,amulet]);(g as any).restoreFallenItems();
 (g as any).absoluteTurnNumber=89;forcePromotion(10000);advance(g);
 expect(g.items).toEqual([scroll,weapon,amulet]);expect(weapon.loc).toEqual({x:10,y:5});
 (g as any).absoluteTurnNumber=90;advance(g);
 expect(g.items).not.toContain(scroll);expect(g.items).not.toContain(weapon);expect(g.items).toContain(amulet);
 expect(g.grid.getCell(8,5)!.layers[L.SURFACE]).toBe(T.ITEM_FIRE);expect(g.grid.getCell(10,5)!.layers[L.SURFACE]).toBe(T.ITEM_FIRE);
 amulet.loc={x:12,y:5};(g as any).destroyFloorItemsInLava();expect(g.items).toContain(amulet);
});

it('fallen-item landing excludes each CE map veto and terrain obstruction, then chooses the nearest free ring',()=>{
 const g=scene();
 for(const veto of ['wall','machine','monster','item','up','down','portal']){
  g.items=[];g.monsters=[];
  for(let x=19;x<=21;x++)for(let y=9;y<=11;y++)g.grid.setTerrain(x,y,T.WALL);
  g.grid.setTerrain(20,10,T.FLOOR);g.grid.setTerrain(21,10,T.FLOOR);g.grid.getCell(20,10)!.machineNumber=0;
  if(veto==='wall')g.grid.setTerrain(20,10,T.WALL);
  if(veto==='machine')g.grid.getCell(20,10)!.machineNumber=3;
  if(veto==='monster')rat(g,20,10);
  if(veto==='item'){const blocker=new Item('blocker',')',0xffffff,ItemCategory.WEAPON);blocker.loc={x:20,y:10};g.items.push(blocker);}
  if(veto==='up')g.grid.setTerrain(20,10,T.STAIRS_UP);
  if(veto==='down')g.grid.setTerrain(20,10,T.STAIRS_DOWN);
  if(veto==='portal')g.grid.setTerrain(20,10,T.DUNGEON_PORTAL);
  const item=new Item('falling',')',0xffffff,ItemCategory.WEAPON);item.loc={x:20,y:10};
  (g as any).pendingFallenItemsByDepth.set(1,[item]);(g as any).restoreFallenItems();
  expect(item.loc,veto).toEqual({x:21,y:10});expect(g.items.filter(x=>x===item),veto).toHaveLength(1);
 }
});
