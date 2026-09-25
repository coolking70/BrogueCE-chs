// Diagnose the full-Cell hash changes separately from the baseline terrain hash.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-18a-2-evidence',tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u18a2-cells-')),rows={};
try{
 for(const stage of ['s2','s3']){
  await build({entryPoints:['scripts/u18a2-generation.ts'],outfile:`${tmp}/capture.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'full-cells',setup(b){
   b.onLoad({filter:/u18a2-generation\.ts$/},args=>({contents:fs.readFileSync(args.path,'utf8').replace('rows.push({seed,depth,','rows.push({cellState:clone(g.grid.cells),seed,depth,'),loader:'ts'}));
   b.onLoad({filter:/\/(Game|Pathfinding|ItemSpawnHeatMap)\.ts$/},args=>({contents:fs.readFileSync(`${dir}/${stage}/${path.basename(args.path)}.txt`,'utf8'),loader:'ts'}));
  }}]});
  const output=`${tmp}/${stage}.json.gz`,fd=fs.openSync(`${dir}/${stage}/cell-check.txt`,'w');
  const r=spawnSync(process.execPath,[`${tmp}/capture.mjs`,output],{stdio:['ignore',fd,fd]});fs.closeSync(fd);assert.equal(r.status,0);
  rows[stage]=JSON.parse(gunzipSync(fs.readFileSync(output)));
  const recorded=JSON.parse(gunzipSync(fs.readFileSync(`${dir}/${stage}/generation.json.gz`)));
  assert.deepEqual(rows[stage].map(({cellState,...r})=>r),recorded);
 }
 const changes=[];
 for(let i=0;i<rows.s2.length;i++){
  const a=rows.s2[i],b=rows.s3[i],fields={},cells=[];
  for(let x=0;x<a.cellState.length;x++)for(let y=0;y<a.cellState[x].length;y++){
   const before=a.cellState[x][y],after=b.cellState[x][y],keys=Object.keys(before).filter(k=>JSON.stringify(before[k])!==JSON.stringify(after[k]));
   for(const k of keys)fields[k]=(fields[k]??0)+1;
   if(keys.length)cells.push({x,y,fields:keys,values:Object.fromEntries(keys.map(k=>[k,{before:before[k],after:after[k]}]))});
  }
  if(cells.length)changes.push({seed:a.seed,depth:a.depth,fields,cells});
 }
 fs.writeFileSync(`${dir}/cell-diff.json`,JSON.stringify(changes,null,2)+'\n');
 console.log(changes.map(({cells,...r})=>r));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
