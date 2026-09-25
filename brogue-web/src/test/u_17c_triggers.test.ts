import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Grid, TerrainType as T, DungeonLayer as L, DRAW_PRIORITY, TERRAIN_HOME_LAYER} from '../engine/Map/Grid';
import {DF, DF_MISSING_TILES, DUNGEON_FEATURE_CATALOG as D} from '../engine/Map/DungeonFeatureCatalog';
import {TERRAIN_FLAGS, TM_IS_CIRCUIT_BREAKER} from '../engine/Map/TerrainCatalog';
import {LightKind} from '../engine/Map/LightCatalog';
import {catalogFeature, spawnDungeonFeature, setDungeonFeatureEffects} from '../engine/Map/DungeonFeature';
import {promoteTile, discoverTerrain} from '../engine/Map/Promotion';
import {rng} from '../engine/Random';
import {createHeadlessGame} from './harness';
import {Item, ItemCategory} from '../engine/Items/Item';
import {Monster, type MonsterData} from '../entities/Monster';
import {BlueprintEngine, blueprintQualifies, type BlueprintDef} from '../engine/Generator/BlueprintEngine';
import {AUTO_GENERATOR_CATALOG} from '../engine/Map/AutoGenerator';
import blueprints from '../data/blueprints.json';
import monsters from '../data/monsters.json';
import golden from './fixtures/u17c-ce-catalog.json';
import {terrainAppearance} from '../engine/UI/Appearance';
const restored=[154,17,152,95,144];
function scene(){
 const g=createHeadlessGame(1719,'test');
 for(let x=1;x<g.grid.width-1;x++)for(let y=1;y<g.grid.height-1;y++){
  g.grid.setTerrain(x,y,T.FLOOR);const c=g.grid.getCell(x,y)!;c.volume=0;c.machineNumber=0;c.isVisible=true;
 }
 g.monsters=[];g.dormantMonsters=[];g.items=[];g.purgatory=[];g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.animationEnabled=false;
 Object.assign(g,{secretScanDepth:-1,levelHasSecrets:false});(g as any).bindDormantAwakener();return g;
}
function mark(g:ReturnType<typeof scene>,x:number,y:number,t:T,machine=7,layer=L.DUNGEON){g.grid.setTerrainLayer(x,y,layer,t);g.grid.getCell(x,y)!.machineNumber=machine;}
function rat(g:ReturnType<typeof scene>,x:number,y:number){const m=new Monster(x,y,(monsters as MonsterData[]).find(m=>m.id==='rat')!);m.hp=m.maxHp=100;m.applyStatus('paralyzed',100);g.monsters.push(m);return m;}
function move(g:ReturnType<typeof scene>,x:number,y:number){g.handlePlayerAction('move',{x,y},'system');}
function search(g:ReturnType<typeof scene>){for(let n=0;n<5;n++)g.handlePlayerAction('search',undefined,'system');}
beforeEach(()=>rng.seedRandomGenerator(1719));afterEach(()=>vi.restoreAllMocks());

describe('U17c CE independent catalog and scope',()=>{
 it('five tile rows and all three chains equal CE-source goldens, including an invisible repeating floor',()=>{
  for(const [name,row] of Object.entries(golden.tiles)){
   const t=T[name as keyof typeof T],{line,description,flavorText,drawPriority,glowLight,...expected}=row;
   expect(line).toBeGreaterThan(0);expect(description).not.toBe('');expect(typeof flavorText).toBe('string');
   expect(TERRAIN_FLAGS[t]).toEqual({...expected,glowLight:LightKind[glowLight as keyof typeof LightKind],webOnly:false});expect(DRAW_PRIORITY[t]).toBe(drawPriority);
  }
  expect(TERRAIN_HOME_LAYER[T.TRAP_DOOR]).toBe(L.LIQUID);expect(TERRAIN_HOME_LAYER[T.MACHINE_TRIGGER_FLOOR_REPEATING]).toBe(L.LIQUID);
 });
 it('seven DF rows match CE flags, probability, layer, description/light and successor exactly',()=>{
  for(const [name,row] of Object.entries(golden.dfs)){
   const id=DF[name as keyof typeof DF];expect(id).toBe(row.id);
   expect(D[id]).toMatchObject({tile:T[row.tile as keyof typeof T],layer:L[row.layer as keyof typeof L],startProbability:row.startProbability,probabilityDecrement:row.probabilityDecrement,flags:row.flags,description:row.description,lightFlare:row.lightFlare,flashColor:row.flashColor,effectRadius:row.effectRadius,cePropagationTerrain:row.propagationTerrain,propagationTerrain:row.propagationTerrain?T[row.propagationTerrain as keyof typeof T]:null,subsequentDF:row.subsequentDF?DF[row.subsequentDF as keyof typeof DF]:null});
  }
 });
 it('only the five authorized registrations are removed; every other missing identity remains ordered',()=>{
  expect(DF_MISSING_TILES).toEqual([179,180,182,183,185,85,140,141,143,155,187,174,175,14,19,87,88,145,148,191]);
  for(const id of restored)expect(()=>catalogFeature(id)).not.toThrow();
 });
 it('CE-generated appearances preserve all old rows and represent the new glyphs',()=>{
  const rows=JSON.parse(readFileSync('src/test/fixtures/u21c-ce-terrain.json','utf8'));
  expect(Object.keys(rows)).toHaveLength(149);
  for(const name of Object.keys(golden.tiles)){const t=T[name as keyof typeof T];expect(terrainAppearance(t,true)).toMatchObject({char:rows[name].char,color:rows[name].color,bgColor:rows[name].bgColor});}
 });
 it('three machine DF data starts restored, hidden-trap autoGen correct; secret lever and worm machines stay retired',()=>{
  for(const [ce,f,df] of [[7,2,'DF_MACHINE_FLOOR_TRIGGER_REPEATING'],[22,0,'DF_MEDIUM_HOLE'],[28,1,'DF_MEDIUM_HOLE']] as const){expect((blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===ce)!.features[f]!.featureDF).toBe(df);}
  const a=AUTO_GENERATOR_CATALOG.find(a=>a.index===25)!;expect(a).toMatchObject({terrain:T.TRAP_DOOR_HIDDEN,ceTerrain:'TRAP_DOOR_HIDDEN',layer:L.DUNGEON,carrier:'wired',minDepth:9,maxDepth:39});
  for(const id of ['vestibule_secret_lever','key_worm_tunnels']){const b=blueprints.find(b=>b.id===id)! as BlueprintDef;expect(blueprintQualifies(b,15,b.flags.filter(f=>['BP_ADOPT_ITEM','BP_VESTIBULE'].includes(f)))).toBe(false);}
 });
});

describe('U17c real actions → final terrain / entity / solvability',()=>{
 it('154 player step powers only same-number remote gate and leaves an inactive pressure plate',()=>{
  const g=scene();mark(g,11,10,T.PRESSURE_PLATE);mark(g,20,10,T.PORTCULLIS_CLOSED);mark(g,11,11,T.PORTCULLIS_CLOSED,8);mark(g,12,10,T.TRAP,8);
  move(g,1,0);expect(g.grid.getCell(11,10)!.layers[L.DUNGEON]).toBe(T.MACHINE_PRESSURE_PLATE_USED);expect(g.grid.getCell(20,10)!.layers[L.DUNGEON]).toBe(T.PORTCULLIS_DORMANT);expect(g.grid.getCell(11,11)!.layers[L.DUNGEON]).toBe(T.PORTCULLIS_CLOSED);expect(g.grid.getCell(12,10)!.layers[L.DUNGEON]).toBe(T.TRAP);
  expect(g.player.loc).toEqual({x:11,y:10});expect((g.grid as any).cells.flat().some((c:any)=>c.isPowered)).toBe(false);
 });
 it('154 actual thrown weapon depresses a LIQUID plate, clears that layer and opens the linked cage',()=>{
  const g=scene();mark(g,13,10,T.PRESSURE_PLATE,7,L.LIQUID);mark(g,20,10,T.ALTAR_CAGE_RETRACTABLE);
  const i=new Item('sword',')',0xffffff,ItemCategory.WEAPON);g.player.inventory.addItem(i);g.throwItemAt(i,13,10);
  expect(g.grid.getCell(13,10)!.layers).toEqual([T.MACHINE_PRESSURE_PLATE_USED,T.NOTHING,T.NOTHING,T.NOTHING]);expect(g.grid.getCell(20,10)!.layers[L.DUNGEON]).toBe(T.ALTAR);expect(g.items.some(i=>i.x===13&&i.y===10)).toBe(true);
 });
 it('154 monster placement uses the shared contact; breaker blocks power but not the plate state',()=>{
  const g=scene();mark(g,14,10,T.PRESSURE_PLATE);mark(g,20,10,T.PORTCULLIS_CLOSED);const m=rat(g,14,10);(g as any).applyDungeonFeatureContact(m);
  expect(g.grid.getCell(14,10)!.terrain).toBe(T.MACHINE_PRESSURE_PLATE_USED);expect(g.grid.getCell(20,10)!.terrain).toBe(T.PORTCULLIS_DORMANT);
  mark(g,15,10,T.PRESSURE_PLATE);mark(g,20,10,T.PORTCULLIS_CLOSED);mark(g,19,10,T.FLOOR);
  const e=TERRAIN_FLAGS[T.FLOOR] as {mechFlags:number},old=e.mechFlags;try{e.mechFlags|=TM_IS_CIRCUIT_BREAKER;m.loc={x:15,y:10};(g as any).applyDungeonFeatureContact(m);expect(g.grid.getCell(15,10)!.terrain).toBe(T.MACHINE_PRESSURE_PLATE_USED);expect(g.grid.getCell(20,10)!.terrain).toBe(T.PORTCULLIS_CLOSED);}finally{e.mechFlags=old;}
 });
 it('17 manual search clears hidden base and surface, creates liquid hole + halo/flare, then confirmed player falls',()=>{
  const g=scene();mark(g,11,10,T.TRAP_DOOR_HIDDEN,0);g.grid.setTerrainLayer(11,10,L.SURFACE,T.GRASS);search(g);
  expect(g.grid.getCell(11,10)!.layers).toEqual([T.FLOOR,T.TRAP_DOOR,T.NOTHING,T.NOTHING]);expect(g.grid.getCell(12,10)!.layers[L.LIQUID]).toBe(T.CHASM_EDGE);expect((g as any).activeFlares.length).toBeGreaterThan(0);
  const confirm=vi.fn(()=>false);g.onConfirmRequest=confirm;move(g,1,0);expect(confirm).toHaveBeenCalled();expect(g.depth).toBe(1);expect(g.player.loc).toEqual({x:10,y:10});
  g.onConfirmRequest=()=>true;move(g,1,0);expect(g.depth).toBe(2);
 });
 it('17 search has no forged discovery behind a wall; hidden trapdoor falls without confirmation and levitation prevents falling',()=>{
  const g=scene();mark(g,12,10,T.TRAP_DOOR_HIDDEN,0);mark(g,11,10,T.WALL,0);search(g);expect(g.grid.getCell(12,10)!.terrain).toBe(T.TRAP_DOOR_HIDDEN);
  mark(g,11,10,T.TRAP_DOOR_HIDDEN,0);const confirm=vi.fn(()=>true);g.onConfirmRequest=confirm;g.player.applyStatus('levitating',30);move(g,1,0);expect(g.depth).toBe(1);g.player.statusDurations.levitating=0;g.handlePlayerAction('wait',undefined,'system');expect(g.depth).toBe(2);expect(confirm).not.toHaveBeenCalled();
 });
 it('95 searching then bumping wall lever leaves player in place, consumes a turn and opens a distant gate exactly once',()=>{
  const g=scene();mark(g,11,10,T.WALL_LEVER_HIDDEN);mark(g,20,10,T.PORTCULLIS_CLOSED);search(g);
  expect(g.grid.getCell(11,10)!.terrain).toBe(T.WALL_LEVER);expect(g.grid.getCell(11,10)!.isPassable).toBe(false);expect(g.grid.getCell(20,10)!.terrain).toBe(T.PORTCULLIS_CLOSED);
  const before=g.player.nutrition;move(g,1,0);expect(g.player.loc).toEqual({x:10,y:10});expect(g.player.nutrition).toBeLessThan(before);expect(g.grid.getCell(11,10)!.terrain).toBe(T.WALL_LEVER_PULLED);expect(g.grid.getCell(20,10)!.terrain).toBe(T.PORTCULLIS_DORMANT);
  const after=g.player.nutrition;move(g,1,0);expect(g.player.nutrition).toBe(after);expect(g.grid.getCell(11,10)!.isOpaque).toBe(true);
  const h=scene();expect(h.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);expect(h.grid.getCell(11,10)!.terrain).toBe(T.WALL_LEVER_PULLED);expect(h.grid.getCell(20,10)!.machineNumber).toBe(7);
 });
 it('95 upstream dormant wired lever can be created after a cached no-secret scan, then searched and pulled',()=>{
  const g=scene();search(g);mark(g,11,10,T.WALL_LEVER_HIDDEN_DORMANT);mark(g,12,10,T.PRESSURE_PLATE);promoteTile(g.grid,12,10,L.DUNGEON,false);expect(g.grid.getCell(11,10)!.terrain).toBe(T.WALL_LEVER_HIDDEN);search(g);expect(g.grid.getCell(11,10)!.terrain).toBe(T.WALL_LEVER);move(g,1,0);expect(g.grid.getCell(11,10)!.terrain).toBe(T.WALL_LEVER_PULLED);
 });
 it('144 carpet-constrained propagation remains invisible; player entry/wait repeatedly sends power, monsters and items do not',()=>{
  const g=scene();for(let x=11;x<=14;x++)mark(g,x,10,T.CARPET);spawnDungeonFeature(g.grid,11,10,catalogFeature(DF.DF_MACHINE_FLOOR_TRIGGER_REPEATING),false);
  expect(g.grid.getCell(12,10)!.layers[L.LIQUID]).toBe(T.MACHINE_TRIGGER_FLOOR_REPEATING);expect(g.grid.getCell(10,10)!.layers[L.LIQUID]).toBe(T.NOTHING);
  mark(g,20,10,T.ALTAR_CAGE_RETRACTABLE);const m=rat(g,11,10);(g as any).applyDungeonFeatureContact(m);expect(g.grid.getCell(20,10)!.terrain).toBe(T.ALTAR_CAGE_RETRACTABLE);g.monsters=[];
  const i=new Item('stone',')',0xffffff,ItemCategory.WEAPON);i.loc={x:12,y:10};g.items.push(i);(g as any).updateEnvironment();expect(g.grid.getCell(20,10)!.terrain).toBe(T.ALTAR_CAGE_RETRACTABLE);
  move(g,1,0);expect(g.grid.getCell(20,10)!.terrain).toBe(T.ALTAR);expect(g.grid.getCell(11,10)!.layers[L.LIQUID]).toBe(T.MACHINE_TRIGGER_FLOOR_REPEATING);
  mark(g,20,10,T.ALTAR_CAGE_RETRACTABLE);g.handlePlayerAction('wait',undefined,'system');expect(g.grid.getCell(20,10)!.terrain).toBe(T.ALTAR);
 });
 it('144 resurrection consumer: empty altar can retry on the retained floor after an ally enters purgatory',()=>{
  const g=scene();mark(g,11,10,T.CARPET);mark(g,11,10,T.MACHINE_TRIGGER_FLOOR_REPEATING,7,L.LIQUID);mark(g,20,10,T.RESURRECTION_ALTAR);move(g,1,0);expect(g.grid.getCell(20,10)!.terrain).toBe(T.RESURRECTION_ALTAR);
  const ally=rat(g,15,10);g.monsters=[];ally.hp=0;ally.isAlly=true;g.purgatory.push(ally);g.handlePlayerAction('wait',undefined,'system');expect(g.purgatory).toHaveLength(0);expect(g.monsters).toContain(ally);expect(ally.hp).toBeGreaterThan(0);expect(g.grid.getCell(20,10)!.terrain).toBe(T.ALTAR);
 });
 it('152 DF lays holes and each halo without evacuation; monster and floor items reuse the fall queues',()=>{
  const g=scene(),m=rat(g,14,10),i=new Item('sword',')',0xffffff,ItemCategory.WEAPON),p=new Item('potion','!',0xffffff,ItemCategory.POTION);i.loc={x:14,y:10};p.loc={x:15,y:10};g.items.push(i,p);
  const result=spawnDungeonFeature(g.grid,14,10,catalogFeature(DF.DF_MEDIUM_HOLE),false);expect(result.builtCells.length).toBeGreaterThan(4);expect(m.loc).toEqual({x:14,y:10});expect(g.grid.getCell(14,10)!.layers[L.LIQUID]).toBe(T.TRAP_DOOR);expect(m.falling).toBe(true);(g as any).updateEnvironment();(g as any).monstersFall();expect((g as any).pendingFallenItemsByDepth.get(2)).toEqual([i]);expect(g.items).not.toContain(p);expect((g as any).pendingFallenByDepth.get(2)).toContain(m);
  const h=scene();expect(h.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);h.mode='normal';h.depth=2;(h as any).generateDepth(false,false);expect(h.items.filter(x=>x.id===i.id)).toHaveLength(1);expect((h as any).pendingFallenItemsByDepth.has(2)).toBe(false);
 });
 it('no invented evacuation flags; pending later-family discovery does not erase its source',()=>{
  const grid=new Grid(9,9);for(let x=0;x<9;x++)for(let y=0;y<9;y++)grid.setTerrain(x,y,T.FLOOR);
  const creature={loc:{x:4,y:4},forbiddenTerrain:0};setDungeonFeatureEffects(grid,{creatures:()=>[creature]});for(const id of restored){spawnDungeonFeature(grid,4,4,catalogFeature(id),false);expect(creature.loc).toEqual({x:4,y:4});}
  grid.setTerrain(4,4,T.PILOT_LIGHT_DORMANT);expect(discoverTerrain(grid,4,4)).toBe(false);expect(grid.getCell(4,4)!.terrain).toBe(T.PILOT_LIGHT_DORMANT);
 });
});

// Real CE22 machine, including its location rules, DF-first order and rollback.
it('152 CE22 whole blueprint builds the pit before the plate; actual throw opens its exit',()=>{
 const g=scene();for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++)g.grid.setTerrain(x,y,T.GRANITE);
 const cells=[];for(let x=6;x<=20;x++)for(let y=6;y<=13;y++){g.grid.setTerrain(x,y,T.FLOOR);cells.push({x,y});}
 const bp=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===22)!;
 rng.seedRandomGenerator(20260920);
 const result=(new BlueprintEngine(g.grid,2,[bp]) as any).applyBlueprint(bp,{cells,center:{x:13,y:9},door:{x:6,y:9}});
 expect(result).not.toBeNull();const plate=cells.find(p=>g.grid.getCell(p.x,p.y)!.layers.includes(T.PRESSURE_PLATE))!;expect(plate).toBeDefined();
 const holes=cells.filter(p=>g.grid.getCell(p.x,p.y)!.layers.includes(T.TRAP_DOOR));expect(holes.length).toBeGreaterThan(0);
 expect((g as any).canMoveTo(6,9)).toBe(false);
 const origin=cells.find(p=>Math.max(Math.abs(p.x-plate.x),Math.abs(p.y-plate.y))===3&&g.grid.getCell(p.x,p.y)!.isPassable&&!g.grid.getCell(p.x,p.y)!.layers.includes(T.TRAP_DOOR))!;
 expect(origin).toBeDefined();g.player.loc={...origin};const i=new Item('sword',')',0xffffff,ItemCategory.WEAPON);g.player.inventory.addItem(i);g.throwItemAt(i,plate.x,plate.y);
 expect(g.grid.getCell(plate.x,plate.y)!.layers[L.DUNGEON]).toBe(T.MACHINE_PRESSURE_PLATE_USED);expect((g as any).canMoveTo(6,9)).toBe(true);
});
