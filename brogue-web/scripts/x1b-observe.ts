// Unmodified production execution. All fixture assignments are explicit below.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createHeadlessGame } from '../src/test/harness';
import { HORDE_POPULATE_FORBIDDEN_FLAGS } from '../src/engine/Core/Game';
import { TerrainType as T } from '../src/engine/Map/Grid';
import { cellTerrainFlags } from '../src/engine/Map/DungeonFeature';
import { T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION, T_PATHING_BLOCKER, T_OBSTRUCTS_ITEMS } from '../src/engine/Map/TerrainCatalog';
import { generationDistances } from '../src/engine/Generator/GenerationPlacement';
import { ItemCategory as IC } from '../src/engine/Items/Item';
import { ItemLoader } from '../src/engine/Items/ItemLoader';
import { AUTO_GENERATOR_CATALOG } from '../src/engine/Map/AutoGenerator';
import { blueprintQualifies, RETIRED_INVENTED_BLUEPRINT_IDS } from '../src/engine/Generator/BlueprintEngine';
import { setMachineObservationHook } from '../src/engine/Generator/MachineObservation';
import { rng } from '../src/engine/Random';
import { minersLightBaseRadiusFixpt } from '../src/engine/Map/LightCatalog';
import blueprints from '../src/data/blueprints.json';
import hordes from '../src/data/hordes.json';
import base from '../src/test/fixtures/deep_generation_baseline.json';
const out=process.argv[2]!;
const write=(n:string,v:unknown)=>fs.writeFileSync(`${out}/${n}.json`,JSON.stringify(v,null,2)+'\n');
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
function stable(g:any){const {savedAt,...s}=clone(g.toSnapshot()); return s;}
function differences(a:any,b:any,p='',result:string[]=[]):string[]{
 if(isDeepStrictEqual(a,b)||result.length>=24)return result;
 if(a&&b&&typeof a==='object'&&typeof b==='object')for(const k of new Set([...Object.keys(a),...Object.keys(b)]))differences(a[k],b[k],p+'.'+k,result);
 else result.push(p);
 return result;
}
function terminal(g:any,t:T){for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++)if(g.grid.getCell(x,y).layers.includes(t))return{x,y};throw Error(`missing ${T[t]} D${g.depth}`);}
const rows:any[]=[];
const machines:any[]=[];
setMachineObservationHook(t=>{if(t.depth>=27&&t.status==='committed')machines.push({seed:t.seed,depth:t.depth,id:t.blueprintId,ceId:t.ceBlueprintId,number:t.machineNumber,products:t.products.map(p=>({kind:p.kind,name:p.name,owner:p.owner}))});});
for(const seed of base.seeds){
 const g:any=createHeadlessGame(seed);
 for(let depth=1;depth<=40;depth++){
  if(depth>1){g.depth=depth;g.generateDepth(false,false);}
  if(depth<27)continue;
  const counts:Record<string,number>={}; const mismatch:any[]=[];
  for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){
   const c=g.grid.getCell(x,y),f=cellTerrainFlags(g.grid,x,y);
   for(const t of c.layers)counts[T[t]]=(counts[T[t]]??0)+1;
   if(c.isPassable!==!(f&T_OBSTRUCTS_PASSABILITY)||c.isOpaque!==!!(f&T_OBSTRUCTS_VISION))mismatch.push({x,y,layers:c.layers.map((t:T)=>T[t])});
  }
  const up=terminal(g,T.STAIRS_UP),down=terminal(g,depth===40?T.DUNGEON_PORTAL:T.STAIRS_DOWN);
  // Same resource-permitting topology contract as U26a: terrain unchanged, occupancy ignored.
  const distances=generationDistances({...g,monsters:[]},up,0,true);
  const gems=g.items.filter((i:any)=>i.category===IC.GEM).map((i:any)=>({x:i.x,y:i.y,quantity:i.quantity,originDepth:i.originDepth,machine:g.grid.getCell(i.x,i.y).machineNumber,blocked:!!(cellTerrainFlags(g.grid,i.x,i.y)&(T_PATHING_BLOCKER|T_OBSTRUCTS_ITEMS)),distance:distances[i.x][i.y]}));
  rows.push({seed,depth,up,down,stairDistance:distances[down.x][down.y],gems,itemCategories:g.items.map((i:any)=>IC[i.category]),foodSpawned:g.foodSpawned,goldGenerated:g.goldGenerated,metered:clone(g.meteredItems),monsters:g.monsters.map((m:any)=>m.typeId),dormant:g.dormantMonsters.map((m:any)=>m.typeId),counts,derivedFlagMismatch:mismatch,minersLightBase:minersLightBaseRadiusFixpt(depth)});
 }
 console.log(`Observed seed ${seed}, D1-40`);
}
setMachineObservationHook(null);
write('natural-levels',rows);write('natural-machines',machines);
write('runtime-catalog',{
 autogen: AUTO_GENERATOR_CATALOG.filter(e=>e.maxDepth>=27).map(e=>({index:e.index,ceLine:e.ceLine,min:e.minDepth,max:e.maxDepth,carrier:e.carrier,terrain:e.ceTerrain,df:e.ceDf,machine:e.ceMachine})),
 eligibleBlueprints:[27,29,30,39,40].map(depth=>({depth,ids:blueprints.filter(b=>blueprintQualifies(b as any,depth,[])).map(b=>({id:b.id,ceId:b.ceBlueprintId})),retiredEligible:blueprints.filter(b=>RETIRED_INVENTED_BLUEPRINT_IDS.has(b.id)&&blueprintQualifies(b as any,depth,[])).map(b=>b.id)})),
 ordinaryHordeCandidates:[27,29,30,32,34,39,40].map(depth=>({depth,rows:hordes.map((h,index)=>({h,index})).filter(({h})=>h.frequency>0&&h.minLevel<=depth&&h.maxLevel>=depth&&!h.flags.some(f=>HORDE_POPULATE_FORBIDDEN_FLAGS.includes(f))).map(({index})=>index)})),
});

const saves:any[]=[];
const g:any=createHeadlessGame(777);
for(let d=2;d<=40;d++){
 g.depth=d;g.generateDepth(false,false);
 if(![27,30,39,40].includes(d))continue;
 const saved=clone(g.toSnapshot()),before=stable(g);
 const loaded=g.loadSnapshot(saved),after=stable(g);
 const immediate=differences(before,after);
 for(let i=0;i<3;i++)g.handlePlayerAction('wait',undefined,'system');
 const continued=stable(g);const ok=g.loadSnapshot(saved);
 for(let i=0;i<3;i++)g.handlePlayerAction('wait',undefined,'system');
 const resumed=stable(g);
 saves.push({depth:d,loaded,reloaded:ok,immediateDifferences:immediate,continuationDifferences:differences(continued,resumed),continuedHash:hash(continued),resumedHash:hash(resumed),savedCachedLevels:saved.levels.length,levelSeeds:saved.levelSeeds.length,gems:saved.items.length});
 g.loadSnapshot(saved);
 console.log(`Observed snapshot D${d}`);
}
write('deep-snapshot',saves);

// Deep checkpoint fixture: prepare the SAME naturally generated map and high HP
// before recording and before replay. Per-command positions are mirrored explicitly.
// This is NOT a freely importable fresh-D1 complete-run recording or a natural playthrough.
const replayRows:any[]=[];
for(const depth of [27,30,39,40]){
 const prepare=(p:any)=>{p.depth=depth;p.generateDepth(false,false);p.player.hp=p.player.maxHp=100000;p.animationEnabled=true;
  if(depth===40)p.player.inventory.addItem(ItemLoader.spawnAmulet('amulet_of_yendor',0,0)!);
 };
 const r:any=createHeadlessGame(424242);prepare(r);
 const start=stable(r); const ledger:any[]=[];
 const finish=()=>{let n=0;while(r.isAdvancing&&n++<10000)r.stepAdvancement();if(r.isAdvancing)throw Error('animation stalled');r.finishTransientDisplay();};
 const act=(action:string,data?:any,position?:any)=>{
  if(position)r.player.loc={...position};
  const before=r.recordedInputEvents.length;
  if(action==='dropGem'){const gem=r.player.inventory.items.find((i:any)=>i.category===IC.GEM);if(!gem)return;r.executeItemCommand('drop',gem);}
  else r.handlePlayerAction(action,data);
  finish();if(r.recordedInputEvents.length>before)ledger.push({position:position?{...position}:null});
 };
 act('wait');act('search');act('discoveries');act('escape');
 const gem=r.items.find((i:any)=>i.category===IC.GEM);
 if(gem){act('pickup',undefined,gem.loc);act('dropGem');const ground=r.items.find((i:any)=>i.category===IC.GEM&&i.originDepth===depth);if(ground)act('pickup',undefined,ground.loc);}
 act('wait');
 act('stairs_down',undefined,terminal(r,depth===40?T.DUNGEON_PORTAL:T.STAIRS_DOWN));
 const recording=r.exportRecording(); const recordEnd={depth:r.depth,over:r.isGameOver,won:r.gameOverWon,super:r.gameOverSuperVictory,score:r.gameOverScore};
 const accepted=r.loadReplay(recording);prepare(r);const setupDiff=differences(start,stable(r)).filter(p=>!p.startsWith('.logMessages'));
 for(let i=0;i<recording.events.length&&!r.replayError;i++){
  if(ledger[i].position)r.player.loc={...ledger[i].position};
  r.replayStep();finish();
 }
 replayRows.push({depth,accepted,fixture:'same generated deep map, HP=100000; D40 amulet; explicit pre-command location ledger',events:recording.events.map((e:any)=>({index:e.index,action:e.action,depth:e.depth,turn:e.turn,end:e.end})),ledger,setupDifferences:setupDiff,cursor:r.replayCursor,error:r.replayError,recordEnd,replayEnd:{depth:r.depth,over:r.isGameOver,won:r.gameOverWon,super:r.gameOverSuperVictory,score:r.gameOverScore}});
 console.log(`Observed deep replay D${depth}: ${r.replayCursor}/${recording.events.length} ${r.replayError??'no OOS'}`);
}
write('deep-checkpoints',replayRows);
console.log('Probe complete');
