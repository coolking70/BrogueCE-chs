// Virtual source variants: never edits production files or rolling fixtures.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { gunzipSync } from 'node:zlib';
const out='ai_docs/reports/u-17a-evidence';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const df='src/engine/Map/DungeonFeature.ts';
const variants={
 head:null,
 final:[],
 no_evacuation:[[df,/evacuateCreatures\(grid, blockingMap, effects\);/g,'/* counterfactual: no evacuation */']],
 no_refresh:[[df,'return refresh && refreshFeatureCell(grid, pos, feat.tile, effects);','return false;']],
 no_subsequent_refresh:[[df,'spawnDungeonFeature(grid, p.x, p.y, sub, abortIfBlocking);','spawnDungeonFeature(grid, p.x, p.y, sub, abortIfBlocking, { refreshSideEffects: false });'],[df,'spawnDungeonFeature(grid, x, y, sub, abortIfBlocking);','spawnDungeonFeature(grid, x, y, sub, abortIfBlocking, { refreshSideEffects: false });']],
 no_aggravation:[[df,'effects.aggravate?.(feat.effectRadius, { x, y });','/* counterfactual: no aggravation */']],
 legacy_terrain_refresh:[['src/engine/Map/Promotion.ts','    refreshDungeonCellTerrain(grid, x, y);','    if (sourceTerrain === TerrainType.FORCEFIELD || sourceTerrain === TerrainType.FORCEFIELD_MELT) refreshDungeonCellTerrain(grid, x, y);']],
 no_blocking_veto:[[df,'if (!blocking\n','if (true || !blocking\n']],
};
const requested=process.argv.slice(2);const selected=requested.length?requested:Object.keys(variants);
const work=fs.mkdtempSync(path.join(os.tmpdir(),'u17a-attribution-'));
try{
 for(const name of selected){
  const inputs=[];
  await build({entryPoints:['scripts/u17a-observe.ts'],outfile:`${work}/${name}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'counterfactual',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},args=>{
    const relative=path.relative(process.cwd(),args.path);let contents=fs.readFileSync(args.path,'utf8');const before=hash(contents);
    if(name==='head')try{contents=execFileSync('git',['show',`HEAD:brogue-web/${relative}`],{encoding:'utf8'});}catch{return;}
    for(const [file,from,to] of variants[name]??[])if(relative===file){const next=contents.replace(from,to);if(next===contents)throw Error(`Missed mutation ${name}: ${from}`);contents=next;}
    inputs.push({file:relative,before,used:hash(contents)});
    return{contents,loader:relative.endsWith('.json')?'json':'ts'};
   });}}]});
  const fd=fs.openSync(`${out}/generation-${name}.txt`,'w');
  const run=spawnSync(process.execPath,[`${work}/${name}.mjs`,`${out}/generation-${name}.json.gz`],{stdio:['ignore',fd,fd]});fs.closeSync(fd);
  fs.writeFileSync(`${out}/inputs-${name}.json`,JSON.stringify(inputs,null,2));
  if(run.status!==0)throw Error(`capture ${name}: ${run.status}`);
  console.log(name,'captured');
 }
 const finalPath=`${out}/generation-final.json.gz`;
 if(fs.existsSync(finalPath)){
  const current=JSON.parse(gunzipSync(fs.readFileSync(finalPath)));
  const summaries={};
  for(const name of Object.keys(variants)){
   const file=`${out}/generation-${name}.json.gz`;if(!fs.existsSync(file))continue;
   const other=JSON.parse(gunzipSync(fs.readFileSync(file)));
   summaries[name]=current.flatMap((r,i)=>Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(other[i][k])).map(field=>({seed:r.seed,depth:r.depth,field,other:other[i][field],final:r[field]})));
  }
  fs.writeFileSync(`${out}/generation-differences.json`,JSON.stringify(summaries,null,2));
  console.log(Object.fromEntries(Object.entries(summaries).map(([k,v])=>[k,v.length])));
 }
}finally{fs.rmSync(work,{recursive:true,force:true});}
