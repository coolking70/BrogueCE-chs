import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import assert from 'node:assert/strict';import {gunzipSync} from 'node:zlib';
import {build} from 'esbuild';import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/x2g-evidence',tmp=fs.mkdtempSync(path.join(os.tmpdir(),'x2g-paths-'));
try{for(const stage of ['submerged','pool']){
 const source=JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-${stage}.json.gz`)));
 await build({entryPoints:['scripts/x2g-pool-paths.ts'],outfile:`${tmp}/paths.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'stage',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},a=>{const f=path.relative(process.cwd(),a.path);if(!(f in source))return;return {contents:source[f],loader:f.endsWith('.json')?'json':'ts'};});}}]});
 const r=spawnSync(process.execPath,[`${tmp}/paths.mjs`,`${out}/pool-paths-${stage}.json`],{stdio:'inherit'});assert.equal(r.status,0);
}}finally{fs.rmSync(tmp,{recursive:true,force:true});}
const read=s=>JSON.parse(fs.readFileSync(`${out}/pool-paths-${s}.json`));
const a=read('submerged'),b=read('pool');
const changed=a.events.flatMap((r,i)=>JSON.stringify(r)===JSON.stringify(b.events[i])?[]:[{index:i,before:r,after:b.events[i]}]);
fs.writeFileSync(`${out}/pool-path-differences.json`,JSON.stringify(changed,null,2)+'\n');
const i=a.events.findIndex((r,i)=>JSON.stringify(r.after)!==JSON.stringify(b.events[i]?.after));
console.log(JSON.stringify({firstDrawDivergence:i,previous:changed.filter(r=>r.index<i).slice(-2),at:changed.find(r=>r.index===i)},null,2));
