import {afterEach,describe,expect,it,vi} from 'vitest';
import {BlueprintEngine,type BlueprintDef} from '../engine/Generator/BlueprintEngine';
import {DijkstraMap} from '../engine/Map/Pathfinding';
import {Architect} from '../engine/Generator/Architect';
import {initializeLevelSeeds} from '../engine/Core/LevelSeeds';
import {rng} from '../engine/Random';
import {Game} from '../engine/Core/Game';
import {Grid,TerrainType as T,DungeonLayer as L,DCOLS,DROWS} from '../engine/Map/Grid';
import {Player} from '../entities/Player';
import {Monster,type MonsterData} from '../entities/Monster';
import monsterData from '../data/monsters.json';
import {speciesForbiddenFlags,minionPlacement,generationDistances} from '../engine/Generator/GenerationPlacement';
import {stairFallbackQualifies,validStairLoc} from '../engine/Generator/Stairs';
import {T_PATHING_BLOCKER,T_IS_FIRE,T_IS_DEEP_WATER,T_LAVA_INSTA_DEATH,T_AUTO_DESCENT,T_IS_DF_TRAP,T_OBSTRUCTS_PASSABILITY} from '../engine/Map/TerrainCatalog';
afterEach(()=>vi.restoreAllMocks());
const species=(id='rat')=>(monsterData as MonsterData[]).find(m=>m.id===id)!;
function arena(width=DCOLS,height=DROWS):any{
 const g:any=Object.create(Game.prototype);g.grid=new Grid(width,height);g.player=new Player(2,2);g.monsters=[];g.dormantMonsters=[];g.items=[];g.machineCells=new Set();
 for(let x=0;x<width;x++)for(let y=0;y<height;y++)g.grid.setTerrain(x,y,T.GRANITE);
 return g;
}
function floor(g:any,x0=3,x1=12,y0=3,y1=12){for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)g.grid.setTerrain(x,y,T.FLOOR);}
function mon(g:any,x:number,y:number,id='rat'){const m=new Monster(x,y,species(id));g.monsters.push(m);return m;}

describe('U18a-3 stage 5a leader layer and PB contracts',()=>{
 it('normal hordes reject hidden hazards and transparent blockers; special hordes match any layer',()=>{
  const g=arena();floor(g);const normal={spawnsIn:''};
  for(const t of [T.PLAIN_FIRE,T.FORCEFIELD,T.PRESSURE_PLATE,T.WATER_DEEP,T.INERT_BRIMSTONE]){
   g.grid.setTerrain(6,6,T.FLOOR);g.grid.setTerrainLayer(6,6,t===T.WATER_DEEP||t===T.INERT_BRIMSTONE?L.LIQUID:L.SURFACE,t);
   expect(g.hordeFitsTerrain(normal,{x:6,y:6}),T[t]).toBe(false);
  }
  g.grid.setTerrain(6,6,T.FLOOR);g.grid.setTerrainLayer(6,6,L.LIQUID,T.WATER_DEEP);g.grid.setTerrainLayer(6,6,L.SURFACE,T.WEB);
  expect(g.hordeFitsTerrain({spawnsIn:'DEEP_WATER'},{x:6,y:6})).toBe(true);
  g.grid.setTerrain(6,6,T.DOOR);expect(g.hordeFitsTerrain(normal,{x:6,y:6})).toBe(true);
 });
});
describe('U18a-3 stage 5b followers use permanent species and reachable paths',()=>{
 it('CE literal exemptions: flight does not remove P or fire, invulnerability does not remove traps/water',()=>{
  expect(speciesForbiddenFlags({behaviorFlags:[]})).toBe(T_PATHING_BLOCKER);
  const fly=speciesForbiddenFlags({behaviorFlags:['MONST_FLIES']});
  expect(fly&T_OBSTRUCTS_PASSABILITY).toBeTruthy();expect(fly&T_IS_FIRE).toBeTruthy();
  expect(fly&(T_AUTO_DESCENT|T_LAVA_INSTA_DEATH|T_IS_DF_TRAP|T_IS_DEEP_WATER)).toBe(0);
  const inv=speciesForbiddenFlags({behaviorFlags:['MONST_INVULNERABLE']});
  expect(inv&T_IS_DEEP_WATER).toBeTruthy();expect(inv&T_IS_DF_TRAP).toBeTruthy();expect(inv&T_IS_FIRE).toBe(0);
 });
 it('does not ring-scan through walls into machines; admits reachable machine floors',()=>{
  const g=arena();floor(g,4,6,4,6);floor(g,8,10,4,6);mon(g,6,5);
  for(let x=8;x<=10;x++)for(let y=4;y<=6;y++)g.grid.getCell(x,y).machineNumber=7;
  for(let n=0;n<8;n++){const p=minionPlacement(g,{x:6,y:5},species(),false);expect(p!.x).toBeLessThan(7);}
  g.grid.getCell(5,5).machineNumber=7;
  for(let x=4;x<=6;x++)for(let y=4;y<=6;y++)if(!(x===5&&y===5))mon(g,x,y);
  expect(minionPlacement(g,{x:6,y:5},species(),true)).toEqual({x:5,y:5});
 });
 it('water-special followers cannot finish on dry land; rejects occupied dormant destinations',()=>{
  const g=arena();floor(g);mon(g,6,6,'eel');
  for(let x=5;x<=7;x++)for(let y=5;y<=7;y++)g.grid.setTerrainLayer(x,y,L.LIQUID,T.WATER_DEEP);
  const p=g.findMinionSpawnSpot({x:6,y:6},species('eel'),'DEEP_WATER',false);
  expect(g.grid.getCell(p.x,p.y).layers).toContain(T.WATER_DEEP);
  const d=mon(g,p.x,p.y);g.monsters.pop();g.dormantMonsters.push(d);
  expect(g.findMinionSpawnSpot({x:6,y:6},species('eel'),'DEEP_WATER',false)).not.toEqual(p);
 });
});
describe('U18a-3 stage 5c periodic PB harmful and path distance',()=>{
 it('rejects gas and layered water; distant unreachable cells are not a far shortcut',()=>{
  const g=arena();floor(g,3,8,3,8);floor(g,60,65,3,8);g.player.loc={x:5,y:5};
  for(let x=60;x<=65;x++)for(let y=3;y<=8;y++)g.grid.getCell(x,y).machineNumber=4;
  g.grid.setTerrainLayer(4,4,L.GAS,T.POISON_GAS);
  g.grid.setTerrainLayer(4,5,L.LIQUID,T.WATER_DEEP);
  for(let i=0;i<20;i++){const p=g.findPeriodicSpawnLocation();expect(p.x).toBeLessThan(9);expect(p).not.toEqual({x:4,y:4});expect(p).not.toEqual({x:4,y:5});}
  const map=generationDistances(g,g.player.loc,T_PATHING_BLOCKER,true);expect(map[60]![5]).toBe(30000);
 });
});
describe('U04 final fallback and alcove contracts',()=>{
 it('fallback rejects shallow liquid, machine and occupied tiles, but allows fire (CE mask)',()=>{
  const g=arena();floor(g);const taken=new Set<number>();expect(stairFallbackQualifies(g.grid,6,6,taken)).toBe(true);
  g.grid.setTerrainLayer(6,6,L.LIQUID,T.WATER_SHALLOW);expect(stairFallbackQualifies(g.grid,6,6,taken)).toBe(false);
  g.grid.setTerrain(6,6,T.FLOOR);g.grid.setTerrainLayer(6,6,L.SURFACE,T.PLAIN_FIRE);expect(stairFallbackQualifies(g.grid,6,6,taken)).toBe(true);
  taken.add(6*DCOLS+6);expect(stairFallbackQualifies(g.grid,6,6,taken)).toBe(false);
 });
 it('alcove needs three cardinal walls, both corners, safe mouth and no neighboring machine',()=>{
  const g=arena();floor(g,4,8,7,10);g.grid.setTerrain(6,6,T.WALL);
  expect(validStairLoc(g.grid,6,6,new Set())).toBe(true);
  g.grid.setTerrainLayer(6,7,L.LIQUID,T.WATER_DEEP);expect(validStairLoc(g.grid,6,6,new Set())).toBe(false);
  g.grid.setTerrain(6,7,T.FLOOR);g.grid.getCell(5,5).machineNumber=1;expect(validStairLoc(g.grid,6,6,new Set())).toBe(false);
 });
});

describe('U18a-3 stage 5d summon entry and remote destination',()=>{
 it('summoned flying species can leave a chasm, while remote placement rejects gas, sacred paths and blocked corners',()=>{
  const g=arena();floor(g,4,9,4,9);g.player.loc={x:2,y:2};const summoner=mon(g,6,6,'vampire');
  for(let x=4;x<=9;x++)for(let y=4;y<=9;y++)g.grid.setTerrainLayer(x,y,L.LIQUID,T.CHASM);
  const p=g.findMinionSpawnSpot(summoner.loc,species('vampire_bat'),null,true);
  expect(p).not.toBeNull();expect(g.grid.getCell(p.x,p.y).layers).toContain(T.CHASM);
  g.grid.setTerrain(4,4,T.FLOOR);g.grid.setTerrainLayer(4,4,L.GAS,T.POISON_GAS);
  expect(g.findSummonAtDistanceLocations({x:4,y:5})).not.toContainEqual({x:4,y:4});
 });
});

describe('U04 stair commit and depth boundaries',()=>{
 it('prepares wall torches and impregnable neighbors; clears liquid/surface without deleting gas',()=>{
  const g=arena();floor(g,4,8,7,10);g.grid.setTerrain(6,6,T.WALL);
  Architect.prepareStairLoc(g.grid,{x:6,y:6});
  expect(g.grid.getCell(5,6).layers[L.DUNGEON]).toBe(T.TORCH_WALL);
  expect(g.grid.getCell(7,6).layers[L.DUNGEON]).toBe(T.TORCH_WALL);
  expect(g.grid.isImpregnable(6,5)).toBe(true);
  g.grid.setTerrainLayer(6,6,L.LIQUID,T.WATER_DEEP);g.grid.setTerrainLayer(6,6,L.SURFACE,T.WEB);g.grid.setTerrainLayer(6,6,L.GAS,T.POISON_GAS);
  Architect.installStair(g.grid,{x:6,y:6},T.STAIRS_UP);
  expect(g.grid.getCell(6,6).layers).toEqual([T.STAIRS_UP,T.NOTHING,T.POISON_GAS,T.NOTHING]);
 });
 it.each([1,26,27,39,40])('D%i has both connected terminals; D40 uses a portal',depth=>{
  const g=arena();floor(g,3,70,3,22);g.depth=depth;g.levelSeeds=initializeLevelSeeds(rng,'731');
  expect(g.placeStairs([])).toBe(true);
  const plan=g.levelSeeds[depth-1],down=depth===40?T.DUNGEON_PORTAL:T.STAIRS_DOWN;
  expect(g.grid.getCell(plan.downStairsLoc.x,plan.downStairsLoc.y).layers[L.DUNGEON]).toBe(down);
  expect(g.grid.getCell(plan.upStairsLoc.x,plan.upStairsLoc.y).layers[L.DUNGEON]).toBe(T.STAIRS_UP);
  expect(g.levelSeeds[depth].upStairsLoc).toEqual(plan.downStairsLoc);
  const dist=generationDistances(g,plan.upStairsLoc,T_PATHING_BLOCKER,true);
  expect(dist[plan.downStairsLoc.x]![plan.downStairsLoc.y]).toBeLessThan(30000);
 });
 it('reports no location on all solid rock instead of carving an isolated stair',()=>{
  const g=arena();g.depth=2;g.levelSeeds=initializeLevelSeeds(rng,'731');expect(g.placeStairs([])).toBe(false);
 });
});

describe('U04 dig/placeStairs retry boundary',()=>{
 it('retries failed digs in the same stream and populates only the successful third attempt',()=>{
  const g:any=new Game();g.startNewGame({mode:'normal',seed:731});g.depth=2;
  const generate=Architect.prototype.generateLevel,states:unknown[]=[];
  let attempts=0;
  vi.spyOn(Architect.prototype,'generateLevel').mockImplementation(function(this:Architect,depth){
   states.push(rng.getState());attempts++;
   if(attempts<=2){rng.randRange(1,1000);const w=arena();return w.grid;}
   return generate.call(this,depth);
  });
  const populate=vi.spyOn(g,'populateLevel');g.generateDepth(false,false);
  expect(attempts).toBe(3);expect(states[1]).not.toEqual(states[0]);expect(states[2]).not.toEqual(states[1]);
  expect(populate).toHaveBeenCalledTimes(1);expect(g.levelSeeds[1].visited).toBe(true);
 });
 it('stops after exactly 50 failed digs without population or falsely marking visited',()=>{
  const g:any=new Game();g.startNewGame({mode:'normal',seed:731});g.depth=2;
  const generate=vi.spyOn(Architect.prototype,'generateLevel').mockImplementation(()=>arena().grid);
  const populate=vi.spyOn(g,'populateLevel');
  expect(()=>g.generateDepth(false,false)).toThrow(/after 50 attempts/);
  expect(generate).toHaveBeenCalledTimes(50);expect(populate).not.toHaveBeenCalled();expect(g.levelSeeds[1].visited).toBe(false);
 });
});

describe('U18a-3 stages 7a–d machine terrain contracts',()=>{
 const bp:BlueprintDef={id:'probe',name:'probe',flags:[],features:[],roomSize:[80,80],depthRange:[1,40],frequency:0,category:'thematic'};
 it('vestibule costs use four-layer PB, secret exception and existing machine exclusion',()=>{
  const g=arena();floor(g);g.grid.setTerrainLayer(5,5,L.SURFACE,T.PLAIN_FIRE);g.grid.setTerrain(6,5,T.SECRET_DOOR);g.grid.getCell(7,5).machineNumber=4;
  const scan=vi.spyOn(DijkstraMap.prototype,'batchScan');const e:any=new BlueprintEngine(g.grid,5,[]);e.fillVestibuleInterior(bp,{x:4,y:4});
  const cost=scan.mock.calls[0]![1];expect(cost[5]![5]).toBe(-1);expect(cost[6]![5]).toBe(1);expect(cost[7]![5]).toBe(-1);
 });
 it('area secrets use direct discovery flags; hidden levers still block',()=>{
  const g=arena();floor(g);g.grid.setTerrain(5,5,T.WALL_LEVER_HIDDEN);g.grid.setTerrain(6,5,T.SECRET_DOOR);
  const scan=vi.spyOn(DijkstraMap.prototype,'batchScan');const e:any=new BlueprintEngine(g.grid,5,[]);e.fillAreaInterior(bp,{x:4,y:4});
  const cost=scan.mock.calls[0]![1];expect(cost[5]![5]).toBeLessThan(0);expect(cost[6]![5]).toBe(1);
 });
 it.each([[T.DOOR,false,true],[T.WATER_DEEP,true,false],[T.FORCEFIELD,false,false]] as const)('view masks through %s: P|V=%s, PB=%s',(tile,ordinary,passable)=>{
  const g=arena();floor(g,4,9,6,6);g.grid.setTerrain(6,6,tile);const e:any=new BlueprintEngine(g.grid,5,[]);
  const origin={x:4,y:6},interior=new Set(Array.from({length:6},(_,i)=>6*DCOLS+4+i));
  expect(e.cellIsFeatureCandidate(8,6,origin,interior,1,new Set(['MF_IN_VIEW_OF_ORIGIN']),new Set())).toBe(ordinary);
  expect(e.cellIsFeatureCandidate(8,6,origin,interior,1,new Set(['MF_IN_PASSABLE_VIEW_OF_ORIGIN']),new Set())).toBe(passable);
 });
 it('snapshots once per feature before terrain writes, and BUILD_AT_ORIGIN bypass remains',()=>{
  const g=arena();floor(g,4,9,6,6);const e:any=new BlueprintEngine(g.grid,5,[]);const flags=new Set(['MF_IN_VIEW_OF_ORIGIN']),origin={x:4,y:6};
  const view=e.featureView(origin,flags);g.grid.setTerrain(6,6,T.WALL);
  expect(e.featureView(origin,flags)).toBe(view);expect(view[8][6]).toBe(true);
  expect(e.featureView(origin,new Set(flags))[8][6]).toBe(false);
  expect(e.cellIsFeatureCandidate(4,6,origin,new Set(),1,new Set(['MF_BUILD_AT_ORIGIN','MF_IN_VIEW_OF_ORIGIN']),new Set())).toBe(true);
 });
});

// Fixed legal sites isolate the literal feature writer, discovery and path chain.
// The original complete CE rows and their feature ordering are not edited.
import blueprints from '../data/blueprints.json';
import {discoverSecretsAt} from '../engine/Map/DungeonFeature';
import {terrainAppearance} from '../engine/UI/Appearance';
describe('U04b CE17/F0 and CE27/F1 complete secret-door chain',()=>{
 it.each([[17,0],[27,1]])('CE%i/F%i writes a real door, displays a wall, discovers and opens a route',(ce,feature)=>{
  const g=arena();floor(g,10,17,10,14);for(let x=3;x<10;x++)g.grid.setTerrain(x,12,T.FLOOR);
  const door={x:10,y:12},cells=[];for(let x=10;x<18;x++)for(let y=10;y<15;y++)cells.push({x,y});
  const bp=(blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===ce)!;
  const e:any=new BlueprintEngine(g.grid,12,[bp]);rng.seedRandomGenerator(222);
  const adopted={category:'KEY',id:'iron_key',instanceId:'probe-key',pos:door,keyLoc:[{loc:{x:3,y:12},machine:0,disposableHere:true}]};
  const m=e.applyBlueprint(bp,{cells:ce===17?[door]:cells,center:{x:14,y:12},door},{adoptiveItem:ce===27?adopted:null});
  expect(m).not.toBeNull();expect(m.featureSpawns.find((f:any)=>f.featureIndex===feature).terrain).toBe('SECRET_DOOR');
  expect(g.grid.getCell(door.x,door.y).layers[L.DUNGEON]).toBe(T.SECRET_DOOR);
  expect(terrainAppearance(T.SECRET_DOOR,true,12).char).toBe('#');expect(g.canMoveTo(door.x,door.y)).toBe(false);
  expect(generationDistances(g,{x:9,y:12},T_PATHING_BLOCKER,true)[11]![12]).toBeLessThan(30000);
  expect(discoverSecretsAt(g.grid,door.x,door.y)).toBe(true);
  expect(g.grid.getCell(door.x,door.y).layers[L.DUNGEON]).toBe(T.DOOR);
  expect(terrainAppearance(T.DOOR,true,12).char).toBe('+');expect(g.canMoveTo(door.x,door.y)).toBe(true);
  expect(generationDistances(g,{x:9,y:12},T_PATHING_BLOCKER,true)[11]![12]).toBeLessThan(30000);
  if(ce===27)expect(m.itemSpawns.filter((i:any)=>i.instanceId==='probe-key')).toHaveLength(1);
 });
 it('D40 portal is excluded from player entry and minion placement',()=>{
  const g=arena();floor(g);g.grid.setTerrain(6,6,T.DUNGEON_PORTAL);
  expect(g.entryQualifiesForPlacement(6,6)).toBe(false);
  mon(g,5,6);for(let x=3;x<=12;x++)for(let y=3;y<=12;y++)if(!(x===6&&y===6))mon(g,x,y);
  expect(minionPlacement(g,{x:5,y:6},species(),true)).toBeNull();
 });
});
