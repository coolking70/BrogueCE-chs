// Generate from one literal CE row, then act through the normal player API.
// A roomy fixture isolates the row without changing its count, probability or DF.
import {TerrainType as T,DungeonLayer as L} from '../../engine/Map/Grid';
import {AUTO_GENERATOR_CATALOG,runAutogenerators} from '../../engine/Map/AutoGenerator';
import {DUNGEON_FEATURE_CATALOG} from '../../engine/Map/DungeonFeatureCatalog';
import {TERRAIN_FLAGS,TM_IS_SECRET,T_IS_DF_TRAP,T_OBSTRUCTS_PASSABILITY} from '../../engine/Map/TerrainCatalog';
import {rng} from '../../engine/Random';
import {createHeadlessGame} from '../harness';
import {Monster,MonsterState,type MonsterData} from '../../entities/Monster';
import monsters from '../../data/monsters.json';
import type {Action} from './u19d-machine-actions';

export const restoredAutoRows=[2,4,5,6,9,10,11,12,13,15,17,18,20,22,24,26,28,30,31,32,34,35,36,37,38];
export function runAutoActions(index:number){
 const row=AUTO_GENERATOR_CATALOG[index]!;
 const g:any=createHeadlessGame(1916,'test');
 const cells=()=>g.grid.cells.flat();
 for(const c of cells()){
  g.grid.setTerrain(c.x,c.y,c.x===0||c.y===0||c.x===g.grid.width-1||c.y===g.grid.height-1?T.GRANITE:T.FLOOR);
  c.machineNumber=0;c.volume=0;c.isVisible=true;c.hasMemory=true;c.isDiscovered=true;
 }
 // Supply the CE wall/deep-water foundation, not the generated target.
 if(row.requiredDungeonFoundationType===T.WALL)for(let x=8;x<g.grid.width-8;x++)g.grid.setTerrain(x,8,T.WALL);
 if(index===10)for(let x=5;x<g.grid.width-5;x++)for(let y=5;y<g.grid.height-5;y++)g.grid.setTerrainLayer(x,y,L.LIQUID,T.WATER_DEEP);
 g.monsters=[];g.dormantMonsters=[];g.items=[];g.purgatory=[];g.player.loc={x:3,y:3};g.player.statusDurations={};g.player.hp=g.player.maxHp=10000;g.animationEnabled=false;g.onConfirmRequest=()=>true;
 g.depth=Math.floor((row.minDepth+row.maxDepth)/2);
 g.currentLevelDepth=g.depth;g.levelSeeds[g.depth-1].visited=true;
 g.secretScanDepth=-1;g.levelHasSecrets=false;
 g.bindDormantAwakener();
 const tile=row.terrain??(row.df===null?undefined:DUNGEON_FEATURE_CATALOG[row.df]!.tile);
 let target:any,seed=0,stats:any;
 for(seed=1;seed<=100&&!target;seed++){
  rng.seedRandomGenerator(seed);
  stats=runAutogenerators(g.grid,g.depth,false,[AUTO_GENERATOR_CATALOG[0]!,row]);
  target=cells().find((c:any)=>c.layers.includes(tile)&&c.x>1&&c.y>1&&c.x<g.grid.width-2&&c.y<g.grid.height-2);
 }
 if(!target)throw Error(`autoGen ${index} did not generate its CE carrier`);
 const neighbors=[[-1,0],[1,0],[0,-1],[0,1]].map(([x,y])=>({x:target.x+x!,y:target.y+y!}));
 const entry=neighbors.find(p=>g.grid.getCell(p.x,p.y).isPassable);if(!entry)throw Error('no interaction square');
 g.player.loc={...entry};
 let witness:Monster|undefined;
 if([17,24].includes(index)){
  const pos={x:Math.max(2,target.x-6),y:Math.max(2,target.y-6)};
  witness=new Monster(pos.x,pos.y,(monsters as MonsterData[]).find(m=>m.id==='rat')!);
  witness.state=MonsterState.ASLEEP;witness.ticksUntilTurn=1000000;g.monsters.push(witness);
 }
 g.updateVision();
 const phases:any[]=[],commands:Action[]=[];
 const state=(label:string)=>{
  const snapshot={label,commands:commands.length,player:{...g.player.loc},hp:g.player.hp,stuck:g.player.getStatusDuration('stuck'),confused:g.player.getStatusDuration('confused'),paralyzed:g.player.getStatusDuration('paralyzed'),
   target:[...target.layers],volume:target.volume,light:g.lightMap.lightSumAt(target.x,target.y),witness:witness?.state,
   terrainCounts:Object.fromEntries([...new Set(cells().flatMap((c:any)=>c.layers))].map((t:any)=>[T[t],cells().filter((c:any)=>c.layers.includes(t)).length]))};
  phases.push(snapshot);return snapshot;
 };
 const initial=JSON.parse(JSON.stringify(g.toSnapshot()));state('generated');
 const act=(action:string,data?:any)=>{commands.push({action,data});g.handlePlayerAction(action,data);if(g.isGameOver)throw Error('observer died');};
 if(TERRAIN_FLAGS[tile as T].mechFlags&TM_IS_SECRET){
  for(let n=0;n<12&&target.layers.some((t:T)=>TERRAIN_FLAGS[t].mechFlags&TM_IS_SECRET);n++)act('search');state('searched');
 }
 if(index===10){
  for(let n=0;n<600&&!cells().some((c:any)=>c.layers.includes(T.DEEP_WATER_ALGAE_2));n++)act('wait');state('bloomed');
  act('move',{x:target.x-g.player.x,y:target.y-g.player.y});state('entered');
 }else if(index===32){
  for(let n=0;n<250&&!cells().some((c:any)=>c.layers.includes(T.STEAM));n++)act('wait');state('steam');
  act('move',{x:target.x-g.player.x,y:target.y-g.player.y});state('entered');
 }else{
  act('move',{x:target.x-g.player.x,y:target.y-g.player.y});state('interacted');
  if([15,22].includes(index)){
   for(let n=0;n<20&&(g.player.x!==entry.x||g.player.y!==entry.y);n++)act('move',{x:entry.x-g.player.x,y:entry.y-g.player.y});state('escaped');
  }
  if([18,26].includes(index)){for(let n=0;n<12&&!g.player.hasStatus('confused');n++)act('wait');state('confused');}
  if(index===9){
   act('move',{x:entry.x-g.player.x,y:entry.y-g.player.y});
   for(let n=0;n<600&&!target.layers.includes(T.FUNGUS_FOREST);n++)act('wait');state('regrown');
  }
 }
 g.updateVision();state('final');
 return {index,seed:seed-1,depth:g.depth,tile,entry,target:{x:target.x,y:target.y},initial,commands,phases,stats,game:g,
  obstructing:!!(TERRAIN_FLAGS[tile as T].flags&T_OBSTRUCTS_PASSABILITY),trap:!!(TERRAIN_FLAGS[tile as T].flags&T_IS_DF_TRAP)};
}
