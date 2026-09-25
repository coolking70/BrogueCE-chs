// Observational wrappers only; no production switches or extra random draws.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {createHeadlessGame, terrainFingerprint} from '../src/test/harness';
import {Game} from '../src/engine/Core/Game';
import {Architect} from '../src/engine/Generator/Architect';
import {BlueprintEngine} from '../src/engine/Generator/BlueprintEngine';
import {stairCandidates,stairFallbackQualifies} from '../src/engine/Generator/Stairs';
import {rng} from '../src/engine/Random';
import {TerrainType as T} from '../src/engine/Map/Grid';
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clone=(v:any)=>JSON.parse(JSON.stringify(v));
const base=JSON.parse(fs.readFileSync('ai_docs/reports/u-18a-3-evidence/baseline-before.json','utf8'));
let events:any[]=[];
for(const [proto,names] of [[Game.prototype,['placeStairs','hordeFitsTerrain','findTerrainSpawnLocation','spawnHordeAt','findNearbySpawnSpot','findPeriodicSpawnLocation','findSummonAtDistanceLocations']], [BlueprintEngine.prototype,['fillVestibuleInterior','fillAreaInterior']], [Architect.prototype,['generateLevel']]] as const){
 for(const name of names){const p=proto as any, fn=p[name];if(!fn)continue;
  p[name]=function(...args:any[]){
   const before=rng.getState(),draws:any[]=[];const original=rng.randRange;
   let stairTrace:any;
   if(name==='placeStairs'){
    const occupied=new Set<number>([...(args[0]??[]).flatMap((m:any)=>[...m.itemSpawns,...m.monsterSpawns]).map((s:any)=>s.pos),...this.items.map((i:any)=>i.loc),...this.monsters.map((m:any)=>m.loc),...this.dormantMonsters.map((m:any)=>m.loc)].map((p:any)=>p.y*this.grid.width+p.x));
    const fallback:any[]=[];for(let x=0;x<this.grid.width;x++)for(let y=0;y<this.grid.height;y++)if(stairFallbackQualifies(this.grid,x,y,occupied))fallback.push({x,y});
    stairTrace={planned:clone(this.levelSeeds[this.depth-1]),wallCandidates:[...stairCandidates(this.grid,occupied)],fallback,occupied:[...occupied]};
   }
   rng.randRange=function(a,b){const value=original.call(this,a,b);draws.push([a,b,value]);return value;};
   try {const result=fn.apply(this,args);if(stairTrace)stairTrace.actual=clone(this.levelSeeds[this.depth-1]);events.push({name,...(stairTrace?{stairTrace}:{}),args:clone(args),before,after:rng.getState(),draws,result:name==='generateLevel'?hash((result as any).cells):clone(result??null)});return result;}
   finally{rng.randRange=original;}
  };
 }
}
const start=(Game.prototype as any).startNewGame;
(Game.prototype as any).startNewGame=function(...args:any[]){events=[];return start.apply(this,args);};
const rows:any[]=[];
for(const seed of base.seeds){
 const g:any=createHeadlessGame(seed);
 for(let depth=1;depth<=26;depth++){
  if(depth>1){events=[];g.depth=depth;g.generateDepth(false,false);}
  const stairs:any[]=[];for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++){const c=g.grid.getCell(x,y);if(c.layers.includes(T.STAIRS_UP)||c.layers.includes(T.STAIRS_DOWN))stairs.push({x,y,layers:c.layers,machine:c.machineNumber});}
  rows.push({seed,depth,fp:terrainFingerprint(g.grid),n:g.monsters.length,species:[...new Set(g.monsters.map((m:any)=>m.name))].sort().join(','),items:g.items.length,
   terrain:hash(g.grid.cells),rng:rng.getState(),player:clone(g.player.loc),stairs,
   itemState:hash(g.items),monsterState:hash(g.monsters.map((m:any)=>({id:m.id,loc:m.loc,type:m.typeId,hp:m.hp}))),events:clone(events)});
 }
}
for(const row of rows)for(const e of row.events){
 if(e.name==='generateLevel')e.draws={count:e.draws.length,sha256:hash(e.draws)};
 if(e.name==='spawnHordeAt'){if(e.args[4])e.args[4]={count:e.args[4].length,sha256:hash(e.args[4])};if(e.args[5])e.args[5]={count:e.args[5].length,sha256:hash(e.args[5])};}
}
fs.writeFileSync(process.argv[2]!,gzipSync(JSON.stringify(rows)));
console.log(`Captured ${rows.length} layers with placement, machine and RNG traces.`);
