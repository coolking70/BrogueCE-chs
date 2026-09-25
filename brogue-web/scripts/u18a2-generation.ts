// Observation only: no production tracing hooks or RNG draws.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createHeadlessGame, terrainFingerprint } from '../src/test/harness';
import { Game } from '../src/engine/Core/Game';
import { DijkstraMap } from '../src/engine/Map/Pathfinding';
import { ItemSpawnHeatMap } from '../src/engine/Items/ItemSpawnHeatMap';
import { TerrainType as T, DCOLS } from '../src/engine/Map/Grid';
import { terrainFlagsOfCell } from '../src/engine/Map/DungeonFeature';
import { T_PATHING_BLOCKER } from '../src/engine/Map/TerrainCatalog';
import { rng } from '../src/engine/Random';
const hash=(v:unknown)=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clone=(v:unknown)=>JSON.parse(JSON.stringify(v));
const base=JSON.parse(fs.readFileSync('ai_docs/reports/u-18a-2-evidence/baseline-before.json','utf8'));
const p=Game.prototype as any, entry=p.placePlayerOnLevelEntry, near=p.findQualifyingPathLocNear;
let entries:any[]=[], scans:any[]=[], heat:any[]=[], path:any=null;
const start=p.startNewGame;
p.startNewGame=function(...args:any[]){entries=[];scans=[];heat=[];return start.apply(this,args);};
p.placePlayerOnLevelEntry=function(target:any){
 const removed:any[]=[],added:any[]=[];
 for(let x=0;x<this.grid.width;x++)for(let y=0;y<this.grid.height;y++){
  const c=this.grid.getCell(x,y), occupancy=this.getMonsterAt(x,y)||this.machineCells.has(y*DCOLS+x)||[T.STAIRS_UP,T.STAIRS_DOWN].includes(c.terrain);
  const old=!occupancy&&c.isPassable&&![T.LAVA,T.WATER_DEEP,T.TRAP].includes(c.terrain)&&!c.isBurning;
  const next=!occupancy&&!(terrainFlagsOfCell(c)&T_PATHING_BLOCKER);
  if(old!==next)(old?removed:added).push({x,y,layers:[...c.layers],flags:terrainFlagsOfCell(c)});
 }
 const row:any={target:clone(target),removed,added,before:rng.getState()};
 entries.push(row);const r=entry.call(this,target);row.result=clone(this.player.loc);row.after=rng.getState();return r;
};
p.findQualifyingPathLocNear=function(target:any){
 const row:any={target:clone(target),rngBefore:rng.getState(),draws:[],checks:[],scans:[]};path=row;
 const original=rng.randRange,qual=this.entryQualifiesForPlacement;
 rng.randRange=function(a,b){const before=rng.getState(),value=original.call(this,a,b);row.draws.push({a,b,before,value,after:rng.getState()});return value;};
 this.entryQualifiesForPlacement=function(x:number,y:number){const result=qual.call(this,x,y);row.checks.push({x,y,result});return result;};
 try{const r=near.call(this,target);row.result=r;return r;}finally{rng.randRange=original;delete this.entryQualifiesForPlacement;path=null;row.rngAfter=rng.getState();entries[entries.length-1]?.paths?.push(row);if(entries.length)entries[entries.length-1].path=row;}
};
const scan=DijkstraMap.prototype.batchScan;
DijkstraMap.prototype.batchScan=function(d,c,diagonal,max){
 const caller=(new Error().stack??'').split('\n')[2]?.replace(/file:.*?:\d+:\d+/,'bundle');
 const row:any={caller,diagonal,cost:hash(c),before:hash(d)};
 const full=path?{cost:clone(c),before:clone(d),after:null as any}:null;
 const r=scan.call(this,d,c,diagonal,max);row.after=hash(d);scans.push(row);
 if(full){full.after=clone(d);path.scans.push(full);}return r;
};
const build=ItemSpawnHeatMap.build;
ItemSpawnHeatMap.build=function(grid,upstairs,exclusions){
 const before=rng.getState(),r=build.call(this,grid,upstairs,exclusions);
 heat.push({upstairs,heat:hash(Array.from((r as any).heat)),total:(r as any).totalHeat,before,after:rng.getState()});return r;
};
const rows:any[]=[];
for(const seed of base.seeds){
 entries=[];scans=[];heat=[];const g:any=createHeadlessGame(seed);
 for(let depth=1;depth<=26;depth++){
  if(depth>1){entries=[];scans=[];heat=[];g.depth=depth;g.generateDepth(false,false);}
  rows.push({seed,depth,fp:terrainFingerprint(g.grid),n:g.monsters.length,species:[...new Set(g.monsters.map((m:any)=>m.name))].sort().join(','),items:g.items.length,
   terrain:hash(g.grid.cells),rng:rng.getState(),player:clone(g.player.loc),
   itemState:hash(g.items),monsterState:hash(g.monsters.map((m:any)=>({id:m.id,loc:m.loc,type:m.typeId,hp:m.hp}))),
   entries:clone(entries),scans:clone(scans),heat:clone(heat)});
 }
}
fs.writeFileSync(process.argv[2]!,gzipSync(JSON.stringify(rows)));
console.log(`Captured ${rows.length} layers with entry candidates/RNG, heat and every batchScan input/output fingerprint.`);
