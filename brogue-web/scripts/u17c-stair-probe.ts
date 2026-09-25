import fs from 'node:fs';
import {createHeadlessGame} from '../src/test/harness';
import {Grid,TerrainType as T} from '../src/engine/Map/Grid';
const rows:any[]=[];let depth=1;const original=Grid.prototype.setTerrainLayer;
Grid.prototype.setTerrainLayer=function(...args:Parameters<typeof original>){const [x,y,layer,tile]=args,before=this.getCell(x,y)?.layers.slice();const r=original.apply(this,args);if(depth===15&&x===59&&y===19)rows.push({depth,args,before:before?.map(t=>T[t]),after:this.getCell(x,y)?.layers.map(t=>T[t]),stack:new Error().stack?.split('\n').slice(2,9)});return r;};
const g:any=createHeadlessGame(22);for(depth=2;depth<=15;depth++){g.depth=depth;g.generateDepth(false,false);}
fs.writeFileSync('ai_docs/reports/u-17c-evidence/stair-writer-trace.json',JSON.stringify({seed:22,depth:15,x:59,y:19,terrain:T[g.grid.getCell(59,19).terrain],sentinel:g.getMonsterAt(59,19)?.name,writes:rows},null,2)+'\n');
