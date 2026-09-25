import fs from 'node:fs';
import {Architect} from '../src/engine/Generator/Architect';
import {Grid,TerrainType as T} from '../src/engine/Map/Grid';
import {rng} from '../src/engine/Random';
const writes:any[]=[],original=Grid.prototype.setTerrainLayer;let depth=0;
Grid.prototype.setTerrainLayer=function(...args:Parameters<typeof original>){const [x,y]=args,before=this.getCell(x,y)?.layers.slice();const r=original.apply(this,args);if(depth===18)writes.push({x,y,args,before:before?.map(t=>T[t]),after:this.getCell(x,y)?.layers.map(t=>T[t]),stack:new Error().stack?.split('\n').slice(2,7)});return r;};
rng.seedRandomGenerator(424242);const arch=new Architect();let grid:Grid;
for(depth=1;depth<=18;depth++)grid=arch.generateTerrain(depth);
const bad:any[]=[];
for(let x=0;x<grid!.width;x++)for(let y=0;y<grid!.height;y++){
 if(grid!.getCell(x,y)?.terrain!==T.OBSIDIAN)continue;
 let near=false;for(let i=x-2;i<=x+2;i++)for(let j=y-2;j<=y+2;j++)if(grid!.getCell(i,j)?.terrain===T.INERT_BRIMSTONE)near=true;
 if(!near){const region=[];for(let i=x-2;i<=x+2;i++)for(let j=y-2;j<=y+2;j++)region.push({x:i,y:j,layers:grid!.getCell(i,j)?.layers.map(t=>T[t])});bad.push({x,y,region,writes:writes.filter(w=>Math.max(Math.abs(w.x-x),Math.abs(w.y-y))<=2)});}
}
fs.writeFileSync('ai_docs/reports/u-17c-evidence/lake-probe.json',JSON.stringify(bad,null,2)+'\n');console.log('unmatched obsidian',bad.map(b=>[b.x,b.y]));
