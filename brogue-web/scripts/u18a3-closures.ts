import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {Game} from '../src/engine/Core/Game';import {BlueprintEngine} from '../src/engine/Generator/BlueprintEngine';
import {createHeadlessGame} from '../src/test/harness';import {TerrainType as T,DungeonLayer as L} from '../src/engine/Map/Grid';
import {generationDistances} from '../src/engine/Generator/GenerationPlacement';
import {T_PATHING_BLOCKER,T_DIVIDES_LEVEL,T_IS_DF_TRAP} from '../src/engine/Map/TerrainCatalog';
import {discoverSecretsAt,cellTerrainFlags} from '../src/engine/Map/DungeonFeature';
import {terrainAppearance} from '../src/engine/UI/Appearance';import {rng} from '../src/engine/Random';
const hash=(v:any)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const bp:any=BlueprintEngine.prototype,gp:any=Game.prototype;
const build=bp.buildAMachine,populate=gp.populateLevel,start=gp.startNewGame;
let calls:any[]=[],handoff:any[]=[],seed=0,depth=1;const allCalls:any[]=[],levels:any[]=[],secrets:any[]=[];
bp.buildAMachine=function(...args:any[]){
 if(args[0]!==66)return build.apply(this,args);
 const before=hash(this.grid.cells),beforeRNG=rng.getState(),result=build.apply(this,args);
 calls.push({seed,depth,beforeRNG,afterRNG:rng.getState(),success:!!result,unchangedOnFailure:result?null:before===hash(this.grid.cells),machine:result?.machineNumber??null,ref:result});return result;
};
gp.startNewGame=function(...args:any[]){calls=[];return start.apply(this,args);};
gp.populateLevel=function(...args:any[]){handoff=args[3];return populate.apply(this,args);};
const descendants=(m:any):any[]=>[m,...m.subMachines.flatMap(descendants)];
const seeds=[26,42,424242,777,20260913,31337];
for(seed of seeds){
 depth=1;const g:any=createHeadlessGame(seed);
 for(depth=1;depth<=26;depth++){
  if(depth>1){calls=[];g.depth=depth;g.generateDepth(false,false);}
  for(const c of calls){c.committed=!!c.ref&&handoff.includes(c.ref);delete c.ref;allCalls.push(c);}
  const plan=g.levelSeeds[depth-1],up=plan.upStairsLoc,down=plan.downStairsLoc;
  assert.equal(g.grid.getCell(up.x,up.y).layers[L.DUNGEON],T.STAIRS_UP);
  assert.equal(g.grid.getCell(down.x,down.y).layers[L.DUNGEON],T.STAIRS_DOWN);
  assert.equal(g.grid.getCell(up.x,up.y).machineNumber,0);assert.equal(g.grid.getCell(down.x,down.y).machineNumber,0);
  const distances=generationDistances({...g,monsters:[]},up,T_PATHING_BLOCKER,true);
  // Existing web geometry (Connectivity.ts): eight neighbors without CE corner
  // exclusion. Keep hazards blocked; record the stricter CE scan separately.
  const seen=new Set([`${up.x},${up.y}`]),queue=[up];
  for(let i=0;i<queue.length;i++){const p=queue[i];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
   const x=p.x+dx,y=p.y+dy,c=g.grid.getCell(x,y),k=`${x},${y}`;
   if(!c||seen.has(k)||((cellTerrainFlags(g.grid,x,y)&(T_DIVIDES_LEVEL&~T_IS_DF_TRAP))&&!c.layers.includes(T.SECRET_DOOR)))continue;
   seen.add(k);queue.push({x,y});
  }}
  const reachable=seen.has(`${down.x},${down.y}`);
  assert.ok(reachable,`stairs ${seed}/${depth}`);assert.equal(cellTerrainFlags(g.grid,g.player.x,g.player.y)&T_PATHING_BLOCKER,0,`entry ${seed}/${depth}`);
  levels.push({seed,depth,up,down,reachable,ceDiagonalDistance:distances[down.x]![down.y],ce66:handoff.filter(m=>m.blueprintId==='ce_66_environment').map(m=>m.machineNumber)});
  for(const m of handoff.flatMap(descendants))if(m.blueprintId==='vestibule_secret_door'||m.blueprintId==='key_secret_room'){
   const f=m.featureSpawns.find((f:any)=>f.terrain==='SECRET_DOOR');if(!f)continue;
   const c=g.grid.getCell(f.pos.x,f.pos.y);if(c.layers[L.DUNGEON]!==T.SECRET_DOOR)continue;
   // Clone the grid through the normal snapshot constructor would write game state;
   // instead inspect/discover and restore only this cell after the closure probe.
   const layers=[...c.layers],before=terrainAppearance(T.SECRET_DOOR,true,depth),beforeRNG=rng.getState();
   assert.equal(before.char,'#');assert.equal(discoverSecretsAt(g.grid,f.pos.x,f.pos.y),true);
   const after=terrainAppearance(c.layers[L.DUNGEON],true,depth);assert.equal(c.layers[L.DUNGEON],T.DOOR);assert.equal(after.char,'+');
   secrets.push({seed,depth,blueprint:m.blueprintId,feature:f.featureIndex,pos:f.pos,before,after});
   c.layers=layers;c.isPassable=false;c.isOpaque=true;rng.setState(beforeRNG);
  }
 }
}
const success=allCalls.find(c=>c.committed),failure=allCalls.find(c=>!c.success);
assert.ok(success,'natural CE66 success');assert.ok(failure,'natural CE66 failure');assert.ok(allCalls.filter(c=>!c.success).every(c=>c.unchangedOnFailure));
// Natural census is observational; exact CE17/F0 and CE27/F1 are exercised
// separately with the unmodified full blueprints, not conditioned on this pool.

fs.writeFileSync('ai_docs/reports/u-18a-3-evidence/closures.json',JSON.stringify({seeds,levels,success,failure,allCalls,secrets},null,2)+'\n');
console.log({levels:levels.length,success:{seed:success.seed,depth:success.depth},failure:{seed:failure.seed,depth:failure.depth},secrets:secrets.length});
