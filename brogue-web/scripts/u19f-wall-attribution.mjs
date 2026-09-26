import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-19f-evidence',tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u19f-wall-'));
try{
 for(const variant of ['before','after']){
  await build({entryPoints:['scripts/u19f-observe.ts'],outfile:`${tmp}/${variant}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'wall-sample',setup(b){b.onLoad({filter:/u19f-observe\.ts$|WallDoorFinish\.ts$/},a=>{
   let contents=fs.readFileSync(a.path,'utf8');if(a.path.endsWith('u19f-observe.ts'))contents=contents.replace('base.seeds','[13]').replace('depth<=26','depth<=16');
   else if(variant==='before')contents=execFileSync('git',['show','HEAD:brogue-web/src/engine/Map/WallDoorFinish.ts'],{encoding:'utf8'});
   return {contents,loader:'ts'};
  });}}]});
  execFileSync(process.execPath,[`${tmp}/${variant}.mjs`,`${out}/wall-case-${variant}.json.gz`]);
 }
 const read=v=>JSON.parse(gunzipSync(fs.readFileSync(`${out}/wall-case-${v}.json.gz`))),before=read('before'),after=read('after');
 const differences=after.flatMap((r,i)=>Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(before[i][k])).map(field=>({seed:r.seed,depth:r.depth,field})));
 fs.writeFileSync(`${out}/wall-case-attribution.json`,JSON.stringify({singleChangedProductionFile:'src/engine/Map/WallDoorFinish.ts',differences},null,2)+'\n');console.log(differences);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
