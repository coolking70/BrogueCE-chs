import fs from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHeadlessGame} from '../src/test/harness';
import {TerrainType as T} from '../src/engine/Map/Grid';
const out='ai_docs/reports/u-17f-evidence',found:any[]=[];
for(const seed of [777,12345,424242,99999]){
 const g:any=createHeadlessGame(seed);
 for(let depth=1;depth<=26;depth++){
  if(depth>1){g.depth=depth;g.generateDepth(false,false);}
  for(const name of ['ALTAR_CAGE_OPEN','COFFIN_CLOSED','STATUE_DORMANT','RAT_TRAP_WALL_DORMANT','PORTAL','ALTAR_SWITCH_RETRACTING'])if(!found.some(f=>f.name===name)){
   const cells=g.grid.cells.flat().filter((c:any)=>c.layers.includes((T as any)[name]));
   if(cells.length){found.push({seed,depth,name,cells:cells.map((c:any)=>({x:c.x,y:c.y,machine:c.machineNumber})),items:g.items.filter((i:any)=>cells.some((c:any)=>c.x===i.x&&c.y===i.y)).map((i:any)=>({id:i.id,category:i.category,keyLoc:i.keyLoc,flags:i.flags}))});fs.writeFileSync(`${out}/natural-${name}.json.gz`,gzipSync(JSON.stringify(g.toSnapshot())));}
  }
  if(found.length===6)break;
 }
 if(found.length===6)break;
}
fs.writeFileSync(`${out}/natural-starts.json`,JSON.stringify(found,null,2)+'\n');console.log(found.map(f=>[f.name,f.seed,f.depth]));
