import {afterEach, describe, expect, it, vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {Grid, TerrainType as T, DungeonLayer as L, DRAW_PRIORITY, TERRAIN_HOME_LAYER, type Cell} from '../engine/Map/Grid';
import {DF, DF_MISSING_TILES, DUNGEON_FEATURE_CATALOG as D} from '../engine/Map/DungeonFeatureCatalog';
import {TERRAIN_FLAGS, TM_IS_CIRCUIT_BREAKER} from '../engine/Map/TerrainCatalog';
import {LightKind} from '../engine/Map/LightCatalog';
import {catalogFeature, spawnDungeonFeature} from '../engine/Map/DungeonFeature';
import {promoteTile, runPromotionUpdate, runFireUpdate, exposeTileToFire} from '../engine/Map/Promotion';
import {rng} from '../engine/Random';
import {createHeadlessGame} from './harness';
import {Item, ItemCategory} from '../engine/Items/Item';
import {Monster, type MonsterData} from '../entities/Monster';
import {BlueprintEngine, type BlueprintDef} from '../engine/Generator/BlueprintEngine';
import {AUTO_GENERATOR_CATALOG, RETIRED_AUTOGENERATOR_MACHINES, runAutogenerators} from '../engine/Map/AutoGenerator';
import blueprints from '../data/blueprints.json';
import monsters from '../data/monsters.json';
import golden from './fixtures/u17d-ce-catalog.json';
import {terrainAppearance} from '../engine/UI/Appearance';
const restored=[179,180,182,183,185,174,175,14,19];
function scene(){
 const g=createHeadlessGame(1719,'test');
 for(let x=1;x<g.grid.width-1;x++)for(let y=1;y<g.grid.height-1;y++){
  g.grid.setTerrain(x,y,T.FLOOR);const c=g.grid.getCell(x,y)!;c.volume=0;c.machineNumber=0;c.isVisible=true;
 }
 g.monsters=[];g.dormantMonsters=[];g.items=[];g.purgatory=[];g.player.loc={x:10,y:10};g.player.hp=g.player.maxHp=100;g.player.statusDurations={};g.animationEnabled=false;
 Object.assign(g,{secretScanDepth:-1,levelHasSecrets:false});(g as any).bindDormantAwakener();return g;
}
function mark(g:ReturnType<typeof scene>,x:number,y:number,t:T,machine=7){g.grid.setTerrain(x,y,t);g.grid.getCell(x,y)!.machineNumber=machine;}
function rat(g:ReturnType<typeof scene>,x:number,y:number){const m=new Monster(x,y,(monsters as MonsterData[]).find(m=>m.id==='rat')!);m.hp=m.maxHp=100;m.applyStatus('paralyzed',100);g.monsters.push(m);return m;}
function move(g:ReturnType<typeof scene>,x:number,y:number){g.handlePlayerAction('move',{x,y},'system');}
// Walk a shortest currently passable route using real player actions.
function walkTo(g:ReturnType<typeof scene>,target:{x:number;y:number}){
 const key=(p:{x:number;y:number})=>`${p.x},${p.y}`,start={...g.player.loc},queue=[start],previous=new Map<string,{x:number;y:number}|null>([[key(start),null]]);
 for(let i=0;i<queue.length&&!previous.has(key(target));i++)for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
  const p={x:queue[i]!.x+dx!,y:queue[i]!.y+dy!};if(!previous.has(key(p))&&g.grid.getCell(p.x,p.y)?.isPassable&&(!dx||!dy||(g.grid.getCell(queue[i]!.x,p.y)?.isPassable&&g.grid.getCell(p.x,queue[i]!.y)?.isPassable))){previous.set(key(p),queue[i]!);queue.push(p);}
 }
 expect(previous.has(key(target)),'the machine must retain an actual walking route').toBe(true);
 const route=[];let p=target;while(previous.get(key(p))){route.unshift(p);p=previous.get(key(p))!;}
 for(const p of route){move(g,p.x-g.player.loc.x,p.y-g.player.loc.y);expect(g.player.loc,JSON.stringify({hp:g.player.hp,depth:g.depth,destination:g.grid.getCell(p.x,p.y)?.layers.map(t=>T[t])})).toEqual(p);}
}
function search(g:ReturnType<typeof scene>){for(let n=0;n<5;n++)g.handlePlayerAction('search',undefined,'system');}
function allCells(g:Grid):Cell[]{const out:Cell[]=[];for(let x=0;x<g.width;x++)for(let y=0;y<g.height;y++)out.push(g.getCell(x,y)!);return out;}
function grid(){const g=new Grid(13,9);for(let x=0;x<13;x++)for(let y=0;y<9;y++)g.setTerrain(x,y,x===0||y===0||x===12||y===8?T.WALL:T.FLOOR);return g;}
afterEach(()=>vi.restoreAllMocks());

describe('U17d CE independent catalog, three chains and data starts',()=>{
 it('all nine tile rows (including dormant torch light) equal CE sources',()=>{
  for(const [name,row] of Object.entries(golden.tiles)){
   const t=T[name as keyof typeof T],{line,description,flavorText,drawPriority,glowLight,...expected}=row;
   expect(line).toBeGreaterThan(0);expect(description).not.toBe('');expect(typeof flavorText).toBe('string');
   expect(TERRAIN_FLAGS[t]).toEqual({...expected,glowLight:LightKind[glowLight as keyof typeof LightKind],webOnly:false});expect(DRAW_PRIORITY[t]).toBe(drawPriority);expect(TERRAIN_HOME_LAYER[t]).toBe(L.DUNGEON);
  }
 });
 it('nine restored DF and six successors/armor rows equal CE including no immediate poison successor',()=>{
  for(const [name,row] of Object.entries(golden.dfs)){
   const id=DF[name as keyof typeof DF];expect(id).toBe(row.id);
   expect(D[id]).toMatchObject({tile:T[row.tile as keyof typeof T],layer:L[row.layer as keyof typeof L],startProbability:row.startProbability,probabilityDecrement:row.probabilityDecrement,flags:row.flags,description:row.description,lightFlare:row.lightFlare,flashColor:row.flashColor,effectRadius:row.effectRadius,cePropagationTerrain:row.propagationTerrain,propagationTerrain:null,subsequentDF:row.subsequentDF?DF[row.subsequentDF as keyof typeof DF]:null});
  }
 });
 it('removes precisely nine registrations, preserves remaining ordered eleven and old numeric IDs',()=>{
  expect(DF_MISSING_TILES).toEqual([]); // U17f closes the final six.

  for(const id of restored)expect(()=>catalogFeature(id)).not.toThrow();
  expect(T.MACHINE_TRIGGER_FLOOR_REPEATING).toBe(148);expect(T.MACHINE_METHANE_VENT_DORMANT).toBe(149);expect(T.FLAMETHROWER).toBe(156);
 });
 it('157 CE-generated appearances include visible traps/vents/fire; hidden forms still look like floor',()=>{
  const rows=JSON.parse(readFileSync('src/test/fixtures/u21c-ce-terrain.json','utf8'));expect(Object.keys(rows)).toHaveLength(169);
  for(const name of Object.keys(golden.tiles)){const t=T[name as keyof typeof T];expect(terrainAppearance(t,true)).toMatchObject({char:rows[name].char,color:rows[name].color,bgColor:rows[name].bgColor});}
  for(const t of [T.MACHINE_METHANE_VENT_HIDDEN,T.MACHINE_POISON_GAS_VENT_HIDDEN,T.MACHINE_PARALYSIS_VENT_HIDDEN,T.GAS_TRAP_POISON_HIDDEN,T.FLAMETHROWER_HIDDEN])expect(terrainAppearance(t,true)).toEqual(terrainAppearance(T.FLOOR,true));
 });
 it('four CE autogen starts have exact depth/rate columns; paralysis machine selection/forced-autoGen eligibility remains unchanged',()=>{
  for(const [index,t,min,max,intercept,limit] of [[14,T.GAS_TRAP_POISON,2,4,0,1],[19,T.FLAMETHROWER,4,12,0,1],[21,T.GAS_TRAP_POISON_HIDDEN,5,39,100,3],[27,T.FLAMETHROWER_HIDDEN,13,39,100,3]])expect(AUTO_GENERATOR_CATALOG.find(a=>a.index===index)).toMatchObject({terrain:t,ceTerrain:T[t!],layer:L.DUNGEON,df:null,machine:0,frequency:20,minDepth:min,maxDepth:max,minNumberIntercept:intercept,minNumberSlope:0,maxNumber:limit,requiredDungeonFoundationType:T.FLOOR,requiredLiquidFoundationType:T.NOTHING,carrier:'wired'});
  for(const id of [67,68]){const bp=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===id)!;expect(bp).toBeDefined();expect(bp.frequency).toBe(0);expect(RETIRED_AUTOGENERATOR_MACHINES.has(id)).toBe(false);}
  for(const [id,t] of [[40,'MACHINE_POISON_GAS_VENT_HIDDEN'],[41,'MACHINE_METHANE_VENT_HIDDEN'],[41,'PILOT_LIGHT_DORMANT'],[42,'PILOT_LIGHT_DORMANT']])expect((blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===id)!.features.some(f=>f.terrain===t)).toBe(true);
 });
});

describe('U17d player search → real visible carrier (179,183,174,14,19)',()=>{
 for(const [hidden,visible] of [[T.MACHINE_METHANE_VENT_HIDDEN,T.MACHINE_METHANE_VENT_DORMANT],[T.MACHINE_PARALYSIS_VENT_HIDDEN,T.MACHINE_PARALYSIS_VENT],[T.MACHINE_POISON_GAS_VENT_HIDDEN,T.MACHINE_POISON_GAS_VENT_DORMANT],[T.GAS_TRAP_POISON_HIDDEN,T.GAS_TRAP_POISON],[T.FLAMETHROWER_HIDDEN,T.FLAMETHROWER]])it(`${T[hidden!]} search reveals without firing or wiring, persists and displays`,()=>{
  const g=scene();mark(g,11,10,hidden!);mark(g,15,10,T.PORTCULLIS_CLOSED);search(g);
  expect(g.grid.getCell(11,10)!.layers).toEqual([visible,T.NOTHING,T.NOTHING,T.NOTHING]);expect(g.grid.getCell(15,10)!.terrain).toBe(T.PORTCULLIS_CLOSED);expect((g as any).activeFlares.length).toBeGreaterThan(0);
  expect((g as any).getTerrainName(visible)).not.toBe('Unknown');const saved=JSON.parse(JSON.stringify(g.toSnapshot()));const h=scene();expect(h.loadSnapshot(saved)).toBe(true);expect(h.grid.getCell(11,10)!.terrain).toBe(visible);expect(h.grid.getCell(11,10)!.machineNumber).toBe(7);
 });
 it('wall occlusion prevents vent discovery and no gas/flash is forged',()=>{const g=scene();mark(g,12,10,T.MACHINE_METHANE_VENT_HIDDEN);mark(g,11,10,T.WALL);search(g);expect(g.grid.getCell(12,10)!.terrain).toBe(T.MACHINE_METHANE_VENT_HIDDEN);expect(g.grid.getCell(12,10)!.volume).toBe(0);});
});

describe('U17d wired activation, gas/fire and final entity consumers',()=>{
 it('180 player picks altar key → same-machine methane opens and emits; other machine stays hidden',()=>{
  const g=scene();mark(g,11,10,T.ALTAR_SWITCH);mark(g,15,10,T.MACHINE_METHANE_VENT_HIDDEN);mark(g,16,10,T.MACHINE_METHANE_VENT_HIDDEN,8);
  const key=new Item('key','⚿',0xffffff,ItemCategory.KEY);key.loc={x:11,y:10};g.items.push(key);move(g,1,0);g.handlePlayerAction('pickup',undefined,'system');
  expect(g.player.inventory.items).toContain(key);expect(g.grid.getCell(15,10)!.layers[L.DUNGEON]).toBe(T.MACHINE_METHANE_VENT);expect(allCells(g.grid).some(c=>c.layers[L.GAS]===T.METHANE_GAS&&c.volume>0)).toBe(true);expect(g.grid.getCell(16,10)!.terrain).toBe(T.MACHINE_METHANE_VENT_HIDDEN);
 });
 it('180 immediate 60 volume, then 5000/10000 promotion boundary; no forced evacuation',()=>{
  const g=grid();g.setTerrain(6,4,T.MACHINE_METHANE_VENT_HIDDEN);const first=promoteTile(g,6,4,L.DUNGEON,false);expect(first.deferred).toBeNull();expect(first.spawn!.evacuationRequired).toBe(false);expect(g.getCell(6,4)!.volume).toBe(60);expect(g.getCell(6,4)!.layers[L.GAS]).toBe(T.METHANE_GAS);
  let roll=vi.spyOn(rng,'randRange').mockReturnValue(5000);runPromotionUpdate(g,{keyOnTileAt:()=>false});expect(g.getCell(6,4)!.volume).toBe(60);roll.mockRestore();roll=vi.spyOn(rng,'randRange').mockReturnValue(4999);runPromotionUpdate(g,{keyOnTileAt:()=>false});expect(g.getCell(6,4)!.volume).toBe(120);roll.mockRestore();
 });
 it('175 poison opening has no immediate gas; 10000 boundary emits exactly 25, remains active',()=>{
  const g=grid();g.setTerrain(6,4,T.MACHINE_POISON_GAS_VENT_HIDDEN);promoteTile(g,6,4,L.DUNGEON,false);expect(g.getCell(6,4)!.volume).toBe(0);
  let roll=vi.spyOn(rng,'randRange').mockReturnValue(10000);runPromotionUpdate(g,{keyOnTileAt:()=>false});expect(g.getCell(6,4)!.volume).toBe(0);roll.mockRestore();roll=vi.spyOn(rng,'randRange').mockReturnValue(9999);runPromotionUpdate(g,{keyOnTileAt:()=>false});expect(g.getCell(6,4)!.volume).toBe(25);expect(g.getCell(6,4)!.layers).toEqual([T.MACHINE_POISON_GAS_VENT,T.NOTHING,T.POISON_GAS,T.NOTHING]);roll.mockRestore();
 });
 it('175 actual pickup → poison vent → diffusion → existing caustic damage, no poisoned status or relocation',()=>{
  const g=scene();mark(g,11,10,T.ALTAR_SWITCH);mark(g,12,10,T.MACHINE_POISON_GAS_VENT_HIDDEN);const key=new Item('key','⚿',0xffffff,ItemCategory.KEY);key.loc={x:11,y:10};g.items.push(key);move(g,1,0);g.handlePlayerAction('pickup',undefined,'system');expect(g.grid.getCell(12,10)!.layers[L.DUNGEON]).toBe(T.MACHINE_POISON_GAS_VENT);
  const m=rat(g,12,10),pos={...m.loc};(g as any).updateEnvironment();const hp=m.hp;(g as any).applyEnvironmentalEffects();expect(m.hp).toBe(hp-Math.floor(m.maxHp/15));expect(m.hasStatus('poisoned')).toBe(false);expect(m.loc).toEqual(pos);expect(allCells(g.grid).filter(c=>c.volume>0).length).toBeGreaterThan(1);
 });
 it('183/185 pressure plate fires discovered or hidden paralysis vent, reveals silently and applies existing paralysis',()=>{
  for(const discovered of [false,true]){const g=scene();mark(g,11,10,T.PRESSURE_PLATE);mark(g,14,10,discovered?T.MACHINE_PARALYSIS_VENT:T.MACHINE_PARALYSIS_VENT_HIDDEN);const m=rat(g,14,10);m.statusDurations={};move(g,1,0);expect(g.grid.getCell(14,10)!.layers[L.DUNGEON]).toBe(T.MACHINE_PARALYSIS_VENT);expect(allCells(g.grid).some(c=>c.layers[L.GAS]===T.PARALYSIS_GAS&&c.volume>0)).toBe(true);expect(m.getStatusDuration('paralyzed')).toBeGreaterThan(0);expect(m.hp).toBe(100);expect(m.loc).toEqual({x:14,y:10});}
 });
 it('185 gas payload is 350 and visible vent can be wired again; breaker prevents remote activation',()=>{
  const g=grid();g.setTerrain(6,4,T.MACHINE_PARALYSIS_VENT_HIDDEN);const r=promoteTile(g,6,4,L.DUNGEON,false);expect(r.deferred).toBeNull();expect(g.getCell(6,4)!.volume).toBe(350);expect(g.getCell(6,4)!.layers[L.DUNGEON]).toBe(T.MACHINE_PARALYSIS_VENT);promoteTile(g,6,4,L.DUNGEON,false);expect(g.getCell(6,4)!.volume).toBe(700);
  const game=scene();mark(game,11,10,T.PRESSURE_PLATE);mark(game,14,10,T.MACHINE_PARALYSIS_VENT_HIDDEN);mark(game,16,10,T.FLOOR);const e=TERRAIN_FLAGS[T.FLOOR] as {mechFlags:number},old=e.mechFlags;try{e.mechFlags|=TM_IS_CIRCUIT_BREAKER;move(game,1,0);expect(game.grid.getCell(14,10)!.terrain).toBe(T.MACHINE_PARALYSIS_VENT_HIDDEN);expect(game.grid.getCell(14,10)!.volume).toBe(0);}finally{e.mechFlags=old;}
 });
 it('182 actual pickup drops torch; wall/light preserved and existing fire loop ignites adjacent methane into explosion',()=>{
  const g=scene();mark(g,11,10,T.ALTAR_SWITCH);mark(g,15,10,T.PILOT_LIGHT_DORMANT);const key=new Item('key','⚿',0xffffff,ItemCategory.KEY);key.loc={x:11,y:10};g.items.push(key);move(g,1,0);g.handlePlayerAction('pickup',undefined,'system');expect(g.grid.getCell(15,10)!.layers[L.DUNGEON]).toBe(T.PILOT_LIGHT);expect(g.grid.getCell(15,10)!.isPassable).toBe(false);expect(g.grid.getCell(15,10)!.isBurning).toBe(true);expect(TERRAIN_FLAGS[T.PILOT_LIGHT].glowLight).toBe(LightKind.TORCH_LIGHT);expect((g as any).activeFlares.length).toBeGreaterThan(0);
  const m=rat(g,14,10),i=new Item('scroll','?',0xffffff,ItemCategory.SCROLL);i.loc={x:14,y:10};g.items.push(i);for(let x=13;x<=15;x++)for(let y=9;y<=11;y++)if(x!==15||y!==10)spawnDungeonFeature(g.grid,x,y,{...catalogFeature(DF.DF_VENT_SPEW_METHANE),startProbability:100},false);const hp=m.hp;runFireUpdate(g.grid,{});expect(m.hp).toBeLessThan(hp);expect(g.items).not.toContain(i);expect(g.grid.getCell(14,10)!.volume).toBe(0);expect(g.grid.getCell(15,10)!.layers[L.DUNGEON]).toBe(T.PILOT_LIGHT);
 });
 it('methane vent 15% ignition boundary overlays CE embers, retaining the non-vanishing vent',()=>{
  const g=grid();g.setTerrain(6,4,T.MACHINE_METHANE_VENT);let roll=vi.spyOn(rng,'randPercent').mockImplementation(p=>p>15);exposeTileToFire(g,6,4,false);expect(g.getCell(6,4)!.layers[L.SURFACE]).toBe(T.NOTHING);roll.mockRestore();roll=vi.spyOn(rng,'randPercent').mockImplementation(p=>p>=15);exposeTileToFire(g,6,4,false);roll.mockRestore();expect(g.getCell(6,4)!.layers[L.SURFACE]).toBe(T.EMBERS);
  // CE does not VANISH this vent: fire overlays it; terrain itself stays and may resume spewing.
  expect(g.getCell(6,4)!.layers[L.DUNGEON]).toBe(T.MACHINE_METHANE_VENT);
 });
});

describe('U17d traps use actual entry and reusable depression, not legacy trapType',()=>{
 for(const [hidden,visible] of [[T.GAS_TRAP_POISON_HIDDEN,T.GAS_TRAP_POISON],[T.FLAMETHROWER_HIDDEN,T.FLAMETHROWER]])it(`${T[hidden!]} real step discovers and emits through U17a while preserving trap`,()=>{
  const g=scene();mark(g,11,10,hidden!,0);const hp=g.player.hp;const i=new Item('scroll','?',0xffffff,ItemCategory.SCROLL);i.loc={x:11,y:10};g.items.push(i);move(g,1,0);expect(g.grid.getCell(11,10)!.layers[L.DUNGEON]).toBe(visible);expect(g.player.loc).toEqual({x:11,y:10});
  if(visible===T.GAS_TRAP_POISON){expect(allCells(g.grid).some(c=>c.layers[L.GAS]===T.POISON_GAS&&c.volume>0)).toBe(true);expect(g.player.hp).toBeLessThan(hp);expect(g.player.hasStatus('poisoned')).toBe(false);}else{expect((g as any).burningDuration(g.player)).toBeGreaterThan(0);expect(g.items).not.toContain(i);expect(allCells(g.grid).filter(c=>c.isBurning).length).toBeGreaterThan(1);}
 });
 it('known poison trap depresses once; empty environment re-arms; JSON restores depression',()=>{
  const g=scene();mark(g,11,10,T.GAS_TRAP_POISON,0);g.player.loc={x:11,y:10};(g as any).applyDisplacementTileEntry(g.player);expect(g.grid.getCell(11,10)!.volume).toBe(1000);(g as any).applyDisplacementTileEntry(g.player);expect(g.grid.getCell(11,10)!.volume).toBe(1000);
  const snapshot=JSON.parse(JSON.stringify(g.toSnapshot())),h=scene();expect(h.loadSnapshot(snapshot)).toBe(true);(h as any).applyDisplacementTileEntry(h.player);expect(h.grid.getCell(11,10)!.volume).toBe(1000);
  h.player.loc={x:10,y:10};(h as any).updateEnvironment();const before=h.grid.getCell(11,10)!.volume;h.player.loc={x:11,y:10};(h as any).applyDisplacementTileEntry(h.player);expect(h.grid.getCell(11,10)!.volume).toBe(before+1000);
 });
 it('levitation does not depress hidden traps; offscreen monsters fire without player knowledge reveal',()=>{
  const g=scene();mark(g,11,10,T.GAS_TRAP_POISON_HIDDEN,0);g.player.applyStatus('levitating',30);move(g,1,0);expect(g.grid.getCell(11,10)!.volume).toBe(0);
  mark(g,40,10,T.GAS_TRAP_POISON_HIDDEN,0);g.grid.getCell(40,10)!.isVisible=false;const m=rat(g,40,10);(g as any).applyDisplacementTileEntry(m);expect(g.grid.getCell(40,10)!.layers[L.DUNGEON]).toBe(T.GAS_TRAP_POISON_HIDDEN);expect(g.grid.getCell(40,10)!.volume).toBe(1000);
 });
 it('immolation catalog uses shared fire contact/scroll burning, not a new armor trigger',()=>{
  const g=scene(),m=rat(g,14,10),i=new Item('scroll','?',0xffffff,ItemCategory.SCROLL);i.loc={x:14,y:10};g.items.push(i);spawnDungeonFeature(g.grid,14,10,catalogFeature(DF.DF_ARMOR_IMMOLATION),false);expect((g as any).burningDuration(m)).toBeGreaterThan(0);expect(g.items).not.toContain(i);expect(allCells(g.grid).filter(c=>c.isBurning).length).toBeGreaterThan(1);
 });
});

// CE67/68 already use the forced area builder in HEAD. These do not reopen a pool.
for(const id of [67,68])it(`CE${id} whole area machine: a real player step opens all wired vents; nearby occupants are paralyzed without damage`,()=>{
 const g=scene();rng.seedRandomGenerator(20260926);const bp=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===id)!;
 const result=new BlueprintEngine(g.grid,10,[bp]).buildAMachine(id,[],null,{x:30,y:10});expect(result).not.toBeNull();
 const plates=allCells(g.grid).filter(c=>c.layers.includes(id===67?T.GAS_TRAP_PARALYSIS:T.GAS_TRAP_PARALYSIS_HIDDEN));const vents=allCells(g.grid).filter(c=>c.layers.includes(T.MACHINE_PARALYSIS_VENT_HIDDEN));expect(plates.length).toBeGreaterThanOrEqual(1);expect(vents.length).toBeGreaterThanOrEqual(2);
 const m=rat(g,vents[0]!.x,vents[0]!.y);m.statusDurations={};const p=plates[0]!;g.player.loc={x:p.x-1,y:p.y};move(g,1,0);expect(g.player.loc).toEqual({x:p.x,y:p.y});
 for(const v of vents)expect(v.layers[L.DUNGEON]).toBe(T.MACHINE_PARALYSIS_VENT);
 expect(m.hasStatus('paralyzed')).toBe(true);expect(m.hp).toBe(100);expect(g.player.hp).toBe(100);
 // Gas is transient and has no permanent seal; levitating allies/player can avoid plates.
 expect(result!.cells.every(p=>g.grid.getCell(p.x,p.y)!.isPassable)).toBe(true);
});
it('CE40 whole room: actual altar pickup closes exit and starts gas; searching and pulling its created lever reopens exit',()=>{
 const g=scene();for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++)g.grid.setTerrain(x,y,T.GRANITE);
 const cells=[];for(let x=6;x<=17;x++)for(let y=6;y<=10;y++){g.grid.setTerrain(x,y,T.FLOOR);cells.push({x,y});}g.grid.setTerrain(5,8,T.FLOOR);
 const bp=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===40)!;rng.seedRandomGenerator(20260926);
 const request={instanceId:1719,x:0,y:0,itemCategory:'KEY',flags:[],itemFlags:[]};
 const result=(new BlueprintEngine(g.grid,10,[bp]) as any).applyBlueprint(bp,{cells,center:{x:11,y:8},door:{x:6,y:8}},{adoptiveItem:request});expect(result).not.toBeNull();
 const altar=allCells(g.grid).find(c=>c.layers.includes(T.ALTAR_SWITCH))!;const vents=allCells(g.grid).filter(c=>c.layers.includes(T.MACHINE_POISON_GAS_VENT_HIDDEN));expect(altar).toBeDefined();expect(vents.length).toBeGreaterThan(0);
 const key=new Item('key','⚿',0xffffff,ItemCategory.KEY);key.loc={x:altar.x,y:altar.y};g.items.push(key);g.player.loc={x:5,y:8};walkTo(g,key.loc);g.handlePlayerAction('pickup',undefined,'system');expect(g.player.inventory.items).toContain(key);expect(g.grid.getCell(6,8)!.terrain).toBe(T.PORTCULLIS_CLOSED);for(const v of vents)expect(v.layers[L.DUNGEON]).toBe(T.MACHINE_POISON_GAS_VENT);
 const lever=allCells(g.grid).find(c=>c.layers.includes(T.WALL_LEVER_HIDDEN))!;expect(lever).toBeDefined();const adjacent=cells.find(p=>Math.max(Math.abs(p.x-lever.x),Math.abs(p.y-lever.y))===1&&g.grid.getCell(p.x,p.y)!.isPassable&&!g.grid.getCell(p.x,p.y)!.layers.includes(T.TRAP_DOOR_HIDDEN))!;expect(adjacent).toBeDefined();walkTo(g,adjacent);for(let n=0;n<5&&lever.layers[L.DUNGEON]===T.WALL_LEVER_HIDDEN;n++)g.handlePlayerAction('search',undefined,'system');expect(lever.layers[L.DUNGEON]).toBe(T.WALL_LEVER);move(g,lever.x-adjacent.x,lever.y-adjacent.y);expect(lever.layers[L.DUNGEON]).toBe(T.WALL_LEVER_PULLED);expect(g.grid.getCell(6,8)!.terrain).toBe(T.PORTCULLIS_DORMANT);walkTo(g,{x:5,y:8});expect(g.player.hp).toBeGreaterThan(0);
});

for(const index of [14,19,21,27])it(`autoGen ${index}: actual CE row placement → player wait on trap → final gas/fire and retained carrier`,()=>{
 const g=scene(),entry=AUTO_GENERATOR_CATALOG[index]!;rng.seedRandomGenerator(1719);
 const chance=vi.spyOn(rng,'randPercent').mockReturnValue(true);
 const stats=runAutogenerators(g.grid,entry.minDepth,false,[AUTO_GENERATOR_CATALOG[0]!,entry]);chance.mockRestore();expect(stats.totalBuilt).toBeGreaterThan(0);
 const c=allCells(g.grid).find(c=>c.layers.includes(entry.terrain!))!;expect(c).toBeDefined();g.player.loc={x:c.x,y:c.y};c.isVisible=true;g.handlePlayerAction('wait',undefined,'system');
 const poison=index===14||index===21;expect(c.layers[L.DUNGEON]).toBe(poison?T.GAS_TRAP_POISON:T.FLAMETHROWER);
 if(poison){expect(allCells(g.grid).some(c=>c.layers[L.GAS]===T.POISON_GAS&&c.volume>0)).toBe(true);expect(g.player.hp).toBeLessThan(100);}else expect((g as any).burningDuration(g.player)).toBeGreaterThan(0);
});
