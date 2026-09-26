// Reproduce from brogue-web/: node ai_docs/reports/u-19c-evidence/rollback-counterfactual.mjs
// A single disabled deletion boundary, with all other final production inputs unchanged.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-19c-evidence',file='src/engine/Generator/BlueprintEngine.ts';
const original=fs.readFileSync(file,'utf8');const variant=original.replaceAll('abort!();','/* U19c counterfactual: omit entity deletion only. */');
if(variant===original)throw Error('Missing abort boundary');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'u19c-rollback-only-'));
try{
 fs.writeFileSync(`${dir}/before`,original);fs.writeFileSync(`${dir}/after`,variant);
 const diff=spawnSync('diff',['-u','--label',file,'--label',file,`${dir}/before`,`${dir}/after`],{encoding:'utf8'});if(diff.status!==1)throw Error('diff');fs.writeFileSync(`${out}/rollback-counterfactual.patch`,diff.stdout);
 await build({entryPoints:['scripts/u19c-observe.ts'],outfile:`${dir}/run.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'omit-abort-only',setup(b){b.onLoad({filter:/\/Generator\/BlueprintEngine\.ts$/},()=>({contents:variant,loader:'ts'}));}}]});
 const fd=fs.openSync(`${out}/generation-no-abort.txt`,'w');const r=spawnSync(process.execPath,[`${dir}/run.mjs`,`${out}/generation-no-abort.json.gz`],{stdio:['ignore',fd,fd]});fs.closeSync(fd);if(r.status!==0)throw Error(`Capture ${r.status}`);
 const read=n=>JSON.parse(gunzipSync(fs.readFileSync(`${out}/generation-${n}.json.gz`)));
 const before=read('final'),after=read('no-abort');const differences=after.flatMap((row,i)=>Object.keys(row).filter(k=>JSON.stringify(row[k])!==JSON.stringify(before[i][k])).map(field=>({seed:row.seed,depth:row.depth,field})));
 const result={from:'final',to:'only entity abort disabled',originalSourceSha:sha(original),variantSourceSha:sha(variant),layers:after.length,changedLayers:new Set(differences.map(d=>`${d.seed}/${d.depth}`)).size,fields:Object.fromEntries([...new Set(differences.map(d=>d.field))].map(f=>[f,differences.filter(d=>d.field===f).length])),differences};
 fs.writeFileSync(`${out}/rollback-counterfactual.json`,JSON.stringify(result,null,2)+'\n');console.log({...result,differences:result.differences.length});
}finally{fs.rmSync(dir,{recursive:true,force:true});}
