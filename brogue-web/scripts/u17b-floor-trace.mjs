import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {build} from 'esbuild';import {spawnSync} from 'node:child_process';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-17b-evidence',temp=fs.mkdtempSync(path.join(os.tmpdir(),'u17b-floor-trace-'));
try{
 await build({entryPoints:['scripts/u17b-observe.ts'],outfile:`${temp}/observe.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'observe-floor-contacts',setup(b){b.onLoad({filter:/\/engine\/Core\/Game.ts$/},args=>{
  let contents=fs.readFileSync(args.path,'utf8');const from='promoteOnItemPlaced(this.grid, x, y);\n                continue;';
  const to=`const source = this.grid.getCell(x,y)!.layers.map(t=>TerrainType[t]);
                const promotions = promoteOnItemPlaced(this.grid, x, y);
                if(promotions.length) ((globalThis as any).__u17bFloorPromotions ??= []).push({depth:this.depth,item:item.id,x,y,source,results:promotions.map(r=>({df:r.df,mutated:r.mutated,deferred:r.deferred}))});
                continue;`;
  if(!contents.includes(from))throw Error('Missed stationary promotion instrumentation');return{contents:contents.replace(from,to),loader:'ts'};
 });b.onLoad({filter:/\/scripts\/u17b-observe.ts$/},args=>({contents:fs.readFileSync(args.path,'utf8').replace('pendingItems:hash(', 'floorItemPromotions:((globalThis as any).__u17bFloorPromotions ?? []).splice(0),\n   pendingItems:hash('),loader:'ts'}));}}]});
 const fd=fs.openSync(`${out}/floor-trace.txt`,'w');const run=spawnSync(process.execPath,[`${temp}/observe.mjs`,`${out}/floor-trace.json.gz`],{stdio:['ignore',fd,fd]});fs.closeSync(fd);if(run.status)throw Error('Trace failed');
 const rows=JSON.parse(gunzipSync(fs.readFileSync(`${out}/floor-trace.json.gz`))),byDF={},bySource={};
 for(const row of rows)for(const contact of row.floorItemPromotions){for(const r of contact.results)byDF[r.df]=(byDF[r.df]??0)+1;for(const tile of contact.source)if(tile!=='NOTHING'&&tile!=='FLOOR')bySource[tile]=(bySource[tile]??0)+1;}
 fs.writeFileSync(`${out}/floor-trace-summary.json`,JSON.stringify({byDF,bySource},null,2)+'\n');console.log({byDF,bySource});
}finally{fs.rmSync(temp,{recursive:true,force:true});}
