import {afterEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Grid, TerrainType as T, DungeonLayer as L, DRAW_PRIORITY, TERRAIN_HOME_LAYER} from '../engine/Map/Grid';
import {TERRAIN_FLAGS, TM_IS_CIRCUIT_BREAKER} from '../engine/Map/TerrainCatalog';
import {DF, DF_MISSING_TILES, DUNGEON_FEATURE_CATALOG as D} from '../engine/Map/DungeonFeatureCatalog';
import {catalogFeature, spawnDungeonFeature} from '../engine/Map/DungeonFeature';
import {runPromotionUpdate} from '../engine/Map/Promotion';
import {AUTO_GENERATOR_CATALOG, runAutogenerators} from '../engine/Map/AutoGenerator';
import {LightKind} from '../engine/Map/LightCatalog';
import {terrainAppearance} from '../engine/UI/Appearance';
import {createHeadlessGame} from './harness';
import {Item, ItemCategory as C} from '../engine/Items/Item';
import {Monster, type MonsterData} from '../entities/Monster';
import monsters from '../data/monsters.json';
import blueprints from '../data/blueprints.json';
import {BlueprintEngine, type BlueprintDef} from '../engine/Generator/BlueprintEngine';
import golden from './fixtures/u17f-ce-catalog.json';
import {rng} from '../engine/Random';

function scene(){
 const g=createHeadlessGame(1716,'test');
 for(let x=1;x<g.grid.width-1;x++)for(let y=1;y<g.grid.height-1;y++){
  g.grid.setTerrain(x,y,T.FLOOR);const c=g.grid.getCell(x,y)!;c.volume=0;c.machineNumber=0;c.isVisible=true;
 }
 g.monsters=[];g.dormantMonsters=[];g.items=[];g.purgatory=[];g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=1000;g.player.statusDurations={};g.animationEnabled=false;
 Object.assign(g,{secretScanDepth:-1,levelHasSecrets:false});(g as any).bindDormantAwakener();return g;
}
type Game=ReturnType<typeof scene>;
function mark(g:Game,x:number,y:number,t:T,m=7){g.grid.setTerrain(x,y,t);g.grid.getCell(x,y)!.machineNumber=m;}
function move(g:Game,x:number,y:number){g.handlePlayerAction('move',{x,y},'system');}
function wait(g:Game){g.handlePlayerAction('wait',undefined,'system');}
function item(g:Game,x:number,y:number){const i=new Item('test','?',0xffffff,C.KEY);i.loc={x,y};g.items.push(i);return i;}
function dormant(g:Game,x:number,y:number,id='rat'){
 const m=new Monster(x,y,(monsters as MonsterData[]).find(m=>m.id===id)!);g.monsters.push(m);m.machineHome=7;g.toggleMonsterDormancy(m);return m;
}
function pickup(g:Game){move(g,1,0);g.handlePlayerAction('pickup',undefined,'system');}
function cells(g:Grid){return Array.from({length:g.width},(_,x)=>Array.from({length:g.height},(_,y)=>g.getCell(x,y)!)).flat();}
function grid(){const g=new Grid(11,9);for(let x=0;x<11;x++)for(let y=0;y<9;y++)g.setTerrain(x,y,x===0||y===0||x===10||y===8?T.GRANITE:T.FLOOR);return g;}
afterEach(()=>vi.restoreAllMocks());

describe('U17f independent CE catalogs, appearances and data starts',()=>{
 it('six tile rows and eleven DF rows match CE, including granite superpriority and actual flash fields',()=>{
  for(const [name,row] of Object.entries(golden.tiles)){
   const t=T[name as keyof typeof T],{line,description,flavorText,drawPriority,glowLight,...expected}=row;
   expect(line).toBeGreaterThan(0);expect(description).not.toBe('');expect(typeof flavorText).toBe('string');
   expect(TERRAIN_FLAGS[t]).toEqual({...expected,glowLight:LightKind[glowLight as keyof typeof LightKind],webOnly:false});
   expect(DRAW_PRIORITY[t]).toBe(drawPriority);expect(TERRAIN_HOME_LAYER[t]).toBe(name==='PORTAL_LIGHT'?L.SURFACE:name==='WORM_TUNNEL_MARKER_ACTIVE'?L.LIQUID:L.DUNGEON);
  }
  for(const [name,row] of Object.entries(golden.dfs)){
   const id=DF[name as keyof typeof DF];expect(id).toBe(row.id);
   expect(D[id]).toMatchObject({tile:T[row.tile as keyof typeof T],layer:L[row.layer as keyof typeof L],startProbability:row.startProbability,probabilityDecrement:row.probabilityDecrement,flags:row.flags,description:row.description,lightFlare:row.lightFlare,flashColor:row.flashColor,effectRadius:row.effectRadius,cePropagationTerrain:row.propagationTerrain,subsequentDF:row.subsequentDF?DF[row.subsequentDF as keyof typeof DF]:null});
   expect(()=>catalogFeature(id)).not.toThrow();
  }
 });
 it('retains the empty missing-tile guard and preserves old IDs; five appended appearances come from CE',()=>{
  expect(DF_MISSING_TILES).toEqual([]);expect(Object.values(D).filter(d=>d.tile===null)).toEqual([]);
  expect(T.SACRIFICE_LAVA).toBe(163);expect(T.RAT_TRAP_WALL_CRACKING).toBe(164);
  const rows=JSON.parse(readFileSync('src/test/fixtures/u21c-ce-terrain.json','utf8'));expect(Object.keys(rows)).toHaveLength(169);
  for(const name of Object.keys(golden.tiles))expect(terrainAppearance(T[name as keyof typeof T],true)).toMatchObject({char:rows[name].char,color:rows[name].color,bgColor:rows[name].bgColor});
  for(const depth of [1,13,26,40]){expect(terrainAppearance(T.STATUE_CRACKING,true,depth)).toEqual(terrainAppearance(T.STATUE_INERT_DOORWAY,true,depth));expect(terrainAppearance(T.RAT_TRAP_WALL_CRACKING,true,depth)).toEqual(terrainAppearance(T.RAT_TRAP_WALL_DORMANT,true,depth));}
  expect(rows.PORTAL_LIGHT.char).toBe('');expect(rows.WORM_TUNNEL_MARKER_ACTIVE.char).toBe('');
 });
 it('CE blueprint trigger and monster entry rows remain wired, including dormant marker and coffin trigger area',()=>{
  for(const row of golden.blueprintFeatures){
   const f=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===row.blueprint)!.features[row.index]!;
   expect(f.featureDF??null,`${row.blueprint}/${row.index}`).toBe(row.featureDF);
   if(row.terrain!=='0')expect(f.terrain).toBe(row.terrain==='ALTAR_INERT'?'ALTAR':row.terrain);
  }
  for(const id of [21,29,43,69])expect((blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===id)!.features.some(f=>f.flags?.includes('MF_MONSTERS_DORMANT'))).toBe(true);
  const worms=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===55)!.features[1]!;
  expect(worms.monsterId).toBe('underworm');expect(worms.flags).not.toContain('MF_MONSTERS_DORMANT');
 });
 it('RUBBLE autogen CE row invokes the real DF and decorates reachable floor',()=>{
  expect(AUTO_GENERATOR_CATALOG[7]).toMatchObject({df:DF.DF_RUBBLE,carrier:'wired',terrain:null,machine:0,minDepth:0,maxDepth:39,frequency:30,minNumberIntercept:0,minNumberSlope:0,maxNumber:4,requiredDungeonFoundationType:T.FLOOR,requiredLiquidFoundationType:T.NOTHING});
  const g=grid();for(let seed=1;seed<=30&&!cells(g).some(c=>c.layers[L.SURFACE]===T.RUBBLE);seed++){rng.seedRandomGenerator(seed);runAutogenerators(g,1,false,[AUTO_GENERATOR_CATALOG[0]!,AUTO_GENERATOR_CATALOG[7]!]);}
  expect(cells(g).some(c=>c.layers[L.SURFACE]===T.RUBBLE)).toBe(true);
 });
});

describe('U17f player trigger to final terrain and entity consumers',()=>{
 it('155 pickup cracks rat walls, then existing wall shatter releases all residents and leaves loot reachable',()=>{
  const g=scene();mark(g,11,10,T.ALTAR_SWITCH);const key=item(g,11,10);
  const rats=[14,16,18].map(x=>{mark(g,x,10,T.RAT_TRAP_WALL_DORMANT);return dormant(g,x,10);});
  mark(g,20,10,T.RAT_TRAP_WALL_DORMANT,8);const other=dormant(g,20,10);other.machineHome=8;
  rng.seedRandomGenerator(155);pickup(g);expect(g.player.inventory.items).toContain(key);
  expect([14,16,18].every(x=>g.grid.getCell(x,10)!.terrain===T.RAT_TRAP_WALL_CRACKING)).toBe(true);expect(rats.every(m=>m.isDormant)).toBe(true);
  const loot=item(g,16,10);
  for(let i=0;i<150&&rats.some(m=>m.isDormant);i++)wait(g);
  expect(rats.every(m=>!m.isDormant&&g.monsters.includes(m))).toBe(true);expect(other.isDormant).toBe(true);
  for(const x of [14,16,18])expect(g.grid.getCell(x,10)!.isPassable).toBe(true);
  expect(g.items).toContain(loot);expect(g.grid.getCell(loot.x,loot.y)!.isPassable).toBe(true);
 });
 it('187 player entry cracks doorway statue, waits shatter it, awakens existing monster and opens the passage',()=>{
  const g=scene();mark(g,11,10,T.MACHINE_TRIGGER_FLOOR);mark(g,15,10,T.STATUE_DORMANT_DOORWAY);const m=dormant(g,15,10,'ogre');
  rng.seedRandomGenerator(187);const draw=rng.randRange.bind(rng);const hold=vi.spyOn(rng,'randRange').mockImplementation((a,b)=>a===0&&b===10000?10000:draw(a,b));move(g,1,0);hold.mockRestore();expect(g.grid.getCell(15,10)!.terrain).toBe(T.STATUE_CRACKING);expect(m.isDormant).toBe(true);
  const save=JSON.parse(JSON.stringify(g.toSnapshot()));const h=scene();expect(h.loadSnapshot(save)).toBe(true);expect(h.grid.getCell(15,10)!.terrain).toBe(T.STATUE_CRACKING);expect(h.dormantMonsters.some(n=>n.id===m.id)).toBe(true);
  for(let i=0;i<30&&m.isDormant;i++)wait(g);expect(m.isDormant).toBe(false);expect(g.grid.getCell(15,10)!.isPassable).toBe(true);expect(g.grid.getCell(15,10)!.layers).not.toContain(T.STATUE_CRACKING);
 });
 it('148 player approaches a CE trigger-area coffin, vampire rises with its original carried key exactly once',()=>{
  const g=scene();mark(g,15,10,T.COFFIN_CLOSED);const m=dormant(g,15,10,'vampire');const key=item(g,15,10);g.items=[];m.carriedItem=key;
  rng.seedRandomGenerator(148);spawnDungeonFeature(g.grid,15,10,catalogFeature(DF.DF_TRIGGER_AREA),false);
  for(const c of cells(g.grid))if(c.layers.includes(T.MACHINE_TRIGGER_FLOOR))c.machineNumber=7;
  const trigger=cells(g.grid).find(c=>c.layers.includes(T.MACHINE_TRIGGER_FLOOR)&&c.x<15)!;expect(trigger).toBeDefined();
  // Position outside a real CE DF footprint, then cross its edge using player input.
  g.player.loc={x:trigger.x-1,y:trigger.y};g.grid.setTerrain(g.player.x,g.player.y,T.FLOOR);move(g,1,0);
  expect(g.grid.getCell(15,10)!.terrain).toBe(T.COFFIN_OPEN);expect(m.isDormant).toBe(false);expect(m.carriedItem).toBe(key);expect(g.monsters.filter(n=>n.id===m.id)).toHaveLength(1);
  wait(g);expect(g.monsters.filter(n=>n.id===m.id)).toHaveLength(1);expect(g.grid.getCell(15,10)!.isPassable).toBe(true);
 });
 it('87 pickup retracts the altar into floodable ground; existing flood propagation crosses the new floor',()=>{
  const g=scene();mark(g,11,10,T.ALTAR_SWITCH_RETRACTING);const key=item(g,11,10);pickup(g);
  expect(g.player.inventory.items).toContain(key);expect(g.grid.getCell(11,10)!.layers[L.DUNGEON]).toBe(T.FLOOR_FLOODABLE);expect((g as any).activeFlares.length).toBeGreaterThan(0);
  for(let x=12;x<=14;x++)mark(g,x,10,T.FLOOR_FLOODABLE,0);
  // A preexisting flood machine reaches the newly retractable floor; CE42 itself has no flood trigger.
  g.grid.setTerrainLayer(14,10,L.LIQUID,T.MACHINE_FLOOD_WATER_DORMANT);g.grid.getCell(14,10)!.machineNumber=9;
  mark(g,10,11,T.PRESSURE_PLATE,9);g.player.loc={x:10,y:10};move(g,0,1);
  for(let i=0;i<60&&!g.grid.getCell(11,10)!.layers.some(t=>t===T.WATER_SHALLOW||t===T.WATER_DEEP||t===T.FLOOD_WATER_SHALLOW||t===T.FLOOD_WATER_DEEP);i++)wait(g);
  expect(g.grid.getCell(11,10)!.layers.some(t=>t===T.WATER_SHALLOW||t===T.WATER_DEEP||t===T.FLOOD_WATER_SHALLOW||t===T.FLOOD_WATER_DEEP)).toBe(true);
 });
 it('88 matching key activates portal, evacuates occupant, awakens ally and temporary light vanishes',()=>{
  const g=scene();mark(g,11,10,T.ALTAR_KEYHOLE);mark(g,15,10,T.PORTAL);
  const f=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===12)!.features[1]!;
  const ally:Monster=(g as any).spawnHordeAtFeature({pos:{x:15,y:10},hordeFlags:f.hordeFlags,dormant:f.flags!.includes('MF_MONSTERS_DORMANT')},12,7);
  expect(ally).not.toBeNull();expect(ally.isDormant).toBe(true);expect(ally.isAlly).toBe(true);
  const occupant=new Monster(15,10,(monsters as MonsterData[]).find(m=>m.id==='rat')!);g.monsters.push(occupant);occupant.isAlly=true;occupant.ticksUntilTurn=10000;occupant.movementSpeed=10000;
  const key=item(g,0,0);g.items=[];key.keyLoc=[{loc:{x:11,y:10},machine:0,disposableHere:true}];key.originDepth=g.depth;g.player.inventory.addItem(key);
  // The entry consumer consumes a real matching key and wires the portal.
  move(g,1,0);expect(ally.isDormant).toBe(false);expect(ally.isAlly).toBe(true);expect(occupant.loc).not.toEqual({x:15,y:10});expect(g.player.inventory.items).not.toContain(key);
  expect(g.grid.getCell(15,10)!.layers[L.DUNGEON]).toBe(T.PORTAL);
  // End-of-turn promotion may already have removed the 10000-chance light.
  for(let i=0;i<3;i++)wait(g);expect(g.grid.getCell(15,10)!.layers[L.SURFACE]).toBe(T.NOTHING);expect(g.monsters.filter(n=>n.id===ally.id)).toHaveLength(1);
 });
 it('191 player pulls lever, activates worm markers, frontier opens granite and reveals resident using existing wake transaction',()=>{
  const g=scene();mark(g,11,10,T.WALL_LEVER);
  for(let x=15;x<=18;x++){mark(g,x,10,T.GRANITE);g.grid.setTerrainLayer(x,10,L.LIQUID,T.WORM_TUNNEL_MARKER_DORMANT);for(const y of [9,11])mark(g,x,y,T.GRANITE,0);}
  const m=dormant(g,17,10,'underworm');mark(g,20,10,T.GRANITE,8);g.grid.setTerrainLayer(20,10,L.LIQUID,T.WORM_TUNNEL_MARKER_DORMANT);
  rng.seedRandomGenerator(191);move(g,1,0);expect(g.grid.getCell(11,10)!.terrain).toBe(T.WALL_LEVER_PULLED);
  expect(g.grid.getCell(17,10)!.layers[L.LIQUID]).toBe(T.WORM_TUNNEL_MARKER_ACTIVE);
  for(let i=0;i<100&&g.grid.getCell(17,10)!.terrain!==T.FLOOR;i++)wait(g);
  for(const x of [15,16,17])expect(g.grid.getCell(x,10)!.isPassable).toBe(true);expect(m.isDormant).toBe(false);expect(g.grid.getCell(17,10)!.layers[L.LIQUID]).toBe(T.NOTHING);expect(g.grid.getCell(20,10)!.terrain).toBe(T.GRANITE);
 });
});

describe('U17f adversarial promotion boundaries and scope',()=>{
 it('all six restored terrain identities survive save/load with layers and machine IDs intact',()=>{
  const g=scene();Object.keys(golden.tiles).forEach((name,i)=>mark(g,12+i,12,T[name as keyof typeof T],90+i));
  const snapshot=JSON.parse(JSON.stringify(g.toSnapshot()));const h=scene();expect(h.loadSnapshot(snapshot)).toBe(true);
  for(let i=0;i<6;i++){expect(h.grid.getCell(12+i,12)!.layers).toEqual(g.grid.getCell(12+i,12)!.layers);expect(h.grid.getCell(12+i,12)!.machineNumber).toBe(90+i);}
 });
 it('CE69 full blueprint builds dormant hordes; actual player entry and waits complete its previously missing payoff',()=>{
  const g=scene(),bp=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===69)!;
  rng.seedRandomGenerator(17);
  const result=new BlueprintEngine(g.grid,16).buildAMachine(69,[],null,{x:20,y:10});expect(result).not.toBeNull();
  expect(result!.blueprintId).toBe(bp.id);expect(result!.monsterSpawns.length).toBeGreaterThan(0);
  (g as any).populateLevel(16,false,false,[result!]);
  const residents=g.dormantMonsters.filter(m=>m.machineHome===result!.machineNumber);expect(residents.length).toBeGreaterThan(0);
  g.monsters=g.monsters.filter(m=>m.machineHome===result!.machineNumber);g.items=[];
  const trigger=cells(g.grid).find(c=>c.machineNumber===result!.machineNumber&&c.layers.includes(T.MACHINE_TRIGGER_FLOOR))!;expect(trigger).toBeDefined();
  const neighbor=[[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy])=>({x:trigger.x+dx!,y:trigger.y+dy!})).find(p=>g.grid.getCell(p.x,p.y)?.isPassable)!;expect(neighbor).toBeDefined();
  g.player.loc=neighbor;move(g,trigger.x-neighbor.x,trigger.y-neighbor.y);
  for(let i=0;i<50&&residents.some(m=>m.isDormant);i++)wait(g);
  expect(residents.every(m=>!m.isDormant)).toBe(true);expect(cells(g.grid).filter(c=>c.machineNumber===result!.machineNumber&&c.layers.includes(T.STATUE_CRACKING))).toEqual([]);
 });
 it('contact keys on floor or carried by occupant monsters use the same portal chain; unrelated and nondisposable keys survive',()=>{
  for(const owner of ['floor','monster'] as const){
   const g=scene();mark(g,12,10,T.ALTAR_KEYHOLE);mark(g,16,10,T.PORTAL);const ally=dormant(g,16,10);ally.isAlly=true;
   const key=item(g,12,10);key.keyLoc=[{loc:{x:12,y:10},machine:0,disposableHere:owner==='monster'}];key.originDepth=g.depth;
   const occupant=new Monster(12,10,(monsters as MonsterData[]).find(m=>m.id==='rat')!);occupant.isAlly=true;g.monsters.push(occupant);
   if(owner==='monster'){g.items=[];occupant.carriedItem=key;}
   (g as any).applyEnvironmentalEffects(occupant);expect(ally.isDormant).toBe(false);
   if(owner==='floor')expect(g.items).toContain(key);else expect(occupant.carriedItem).toBeNull();
  }
 });
 for(const [t,chance] of [[T.RAT_TRAP_WALL_CRACKING,500],[T.STATUE_CRACKING,3500],[T.PORTAL_LIGHT,10000]])it(`${T[t!]} exact CE promotion boundary`,()=>{
  const g=grid(),layer=TERRAIN_HOME_LAYER[t! as T]!;g.setTerrainLayer(5,4,layer,t! as T);
  const roll=vi.spyOn(rng,'randRange').mockReturnValue(chance!);runPromotionUpdate(g,{keyOnTileAt:()=>false});expect(g.getCell(5,4)!.layers[layer]).toBe(t);
  roll.mockReturnValue(chance!-1);runPromotionUpdate(g,{keyOnTileAt:()=>false});expect(g.getCell(5,4)!.layers[layer]).not.toBe(t);
 });
 it('sealed active worm marker waits without RNG; one open orthogonal neighbor yields strict 2000 boundary',()=>{
  const g=grid();for(let x=4;x<=6;x++)for(let y=3;y<=5;y++)g.setTerrain(x,y,T.GRANITE);g.setTerrainLayer(5,4,L.LIQUID,T.WORM_TUNNEL_MARKER_ACTIVE);
  const roll=vi.spyOn(rng,'randRange').mockReturnValue(0);runPromotionUpdate(g,{keyOnTileAt:()=>false});expect(roll).not.toHaveBeenCalled();expect(g.getCell(5,4)!.terrain).toBe(T.GRANITE);
  g.setTerrain(4,4,T.FLOOR);roll.mockReturnValue(2000);runPromotionUpdate(g,{keyOnTileAt:()=>false});expect(g.getCell(5,4)!.terrain).toBe(T.GRANITE);
  roll.mockReturnValue(1999);runPromotionUpdate(g,{keyOnTileAt:()=>false});expect(g.getCell(5,4)!.layers[L.DUNGEON]).toBe(T.FLOOR);expect(g.getCell(5,4)!.layers[L.SURFACE]).toBe(T.RUBBLE);
 });
 it('wrong key and circuit breaker cannot awaken portal resident',()=>{
  const g=scene();mark(g,11,10,T.ALTAR_KEYHOLE);mark(g,15,10,T.PORTAL);const m=dormant(g,15,10);move(g,1,0);expect(m.isDormant).toBe(true);
  mark(g,12,10,T.MACHINE_TRIGGER_FLOOR);mark(g,18,10,T.FLOOR);const e=TERRAIN_FLAGS[T.FLOOR] as {mechFlags:number},old=e.mechFlags;
  try{e.mechFlags|=TM_IS_CIRCUIT_BREAKER;move(g,1,0);expect(m.isDormant).toBe(true);}finally{e.mechFlags=old;}
 });
});
