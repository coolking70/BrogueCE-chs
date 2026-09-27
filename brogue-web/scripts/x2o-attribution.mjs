// Isolated bundles: original -> only horde clump -> only blueprint depth added.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { build } from 'esbuild';
const out='ai_docs/reports/x2o-evidence',stage=process.argv[2];
const stages=['s0','clump','depth'];
if(!stages.includes(stage))throw Error('Expected s0/clump/depth');
const changed=['src/engine/Core/Game.ts','src/data/hordes.json','src/data/blueprints.json'];
const sources=Object.fromEntries(changed.map(f=>[f,(stage==='s0'||(stage==='clump'&&f.endsWith('blueprints.json')))?execFileSync('git',['show',`HEAD:brogue-web/${f}`],{encoding:'utf8'}):fs.readFileSync(f,'utf8')]));
const plugin={name:'single-variable',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},a=>{const f=path.relative(process.cwd(),a.path);if(f in sources)return {contents:sources[f],loader:f.endsWith('.json')?'json':'ts'};});}};
fs.writeFileSync(`${out}/sources-${stage}.json`,JSON.stringify(sources,null,2)+'\n');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'x2o-attribution-'));
try{
 await build({entryPoints:['scripts/u26a-observe.ts'],outfile:`${tmp}/observe.mjs`,bundle:true,platform:'node',format:'esm',plugins:[plugin]});
 let r=spawnSync(process.execPath,[`${tmp}/observe.mjs`,`${out}/generation-${stage}.json.gz`],{stdio:'inherit'});if(r.status)throw Error('generation failed');
 for(const n of [2,3,4]){
  const source=fs.readFileSync(`src/test/u_r${n}_trace.test.ts`,'utf8')
   .replace("import { describe, expect, it } from 'vitest';", "import assert from 'node:assert/strict'; const describe=(_n,f)=>f(),it=describe; const expect=a=>({toBe:e=>assert.equal(a,e),toEqual:e=>assert.deepEqual(a,e)});")
   .replace(/const fixture = new URL\([^;]+;/,'const fixture=process.argv[2];');
  await build({stdin:{contents:source,resolveDir:path.resolve('src/test'),loader:'ts'},outfile:`${tmp}/trace.mjs`,bundle:true,platform:'node',format:'esm',plugins:[plugin]});
  r=spawnSync(process.execPath,[`${tmp}/trace.mjs`,`${out}/ur${n}-${stage}.json${n===2?'':'.gz'}`],{env:{...process.env,[`UR${n}_CAPTURE`]:'1'},stdio:'inherit'});if(r.status)throw Error(`UR${n} failed`);
 }
 const read=f=>JSON.parse(f.endsWith('.gz')?gunzipSync(fs.readFileSync(f)):fs.readFileSync(f));
 const records=[];
 for(let i=1;i<stages.length;i++){
  const a=stages[i-1],b=stages[i];if(!fs.existsSync(`${out}/generation-${b}.json.gz`))continue;
  const before=read(`${out}/generation-${a}.json.gz`),after=read(`${out}/generation-${b}.json.gz`);
  const changes=after.flatMap((r,j)=>Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(before[j][k])).map(field=>({seed:r.seed,depth:r.depth,field})));
  records.push({from:a,to:b,shallow:changes.filter(r=>r.depth<=26),deep:changes.filter(r=>r.depth>26),traces:[2,3,4].map(n=>{const suffix=`.json${n===2?'':'.gz'}`;return {n,changed:JSON.stringify(read(`${out}/ur${n}-${a}${suffix}`))!==JSON.stringify(read(`${out}/ur${n}-${b}${suffix}`)),headMatchesGolden:JSON.stringify(read(`${out}/ur${n}-s0${suffix}`))===JSON.stringify(read(`ai_docs/reports/u-r${n}-trace${suffix}`))};})});
 }
 fs.writeFileSync(`${out}/attribution.json`,JSON.stringify(records,null,2)+'\n');
 console.log(records.map(r=>({...r,shallow:r.shallow.length,deep:r.deep.length})));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
