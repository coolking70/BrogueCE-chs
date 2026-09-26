import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-15d3-evidence';
const work=fs.mkdtempSync(path.join(os.tmpdir(),'u15d3-attribution-'));
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const cache=new Map();
const head=f=>{if(!cache.has(f))cache.set(f,execFileSync('git',['show',`HEAD:brogue-web/${f}`],{encoding:'utf8'}));return cache.get(f);};
const stages=['s0','weapon-good','weapon-bad','armor-good','armor-bad','vorpal'];
const tracesOnly=process.argv.includes('--traces-only');
const selected=process.argv.slice(2).filter(a=>a!=='--traces-only');
function source(stage,file,final){
 const n=stages.indexOf(stage);if(n<0)throw Error(stage);
 if(file!=='src/engine/Items/ItemLoader.ts')return n===5?final:head(file);
 if(n===5)return final; // vorpalEnemy is already CE-correct: audited no-op stage.
 let old=head(file);
 const groups=[['W_MULTIPLICITY','W_SLOWING'],['W_PLENTY'],['A_MULTIPLICITY'],['A_BURDEN','A_VULNERABILITY','A_IMMOLATION']];
 for(const name of groups.slice(0,n).flat()){
  const line=final.split('\n').find(l=>l.includes('// '+name));
  const before=old.split('\n').find(l=>l.includes('// '+name));
  if(!line||!before)throw Error('Missing mapping '+name);old=old.replace(before,line);
 }
 return old;
}
try{
 for(const stage of selected.length?selected:stages){
  const inputs={};
  const plugin={name:'single-variable',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},a=>{
   const file=path.relative(process.cwd(),a.path),final=fs.readFileSync(a.path,'utf8');
   const contents=source(stage,file,final);inputs[file]=sha(contents);
   return {contents,loader:file.endsWith('.json')?'json':'ts'};
  });}};
  if(!tracesOnly){
  await build({entryPoints:['scripts/u15d3-observe.ts'],outfile:`${work}/${stage}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[plugin]});
  const fd=fs.openSync(`${out}/generation-${stage}.txt`,'w');
  const r=spawnSync(process.execPath,[`${work}/${stage}.mjs`,`${out}/generation-${stage}.json.gz`],{stdio:['ignore',fd,fd]});fs.closeSync(fd);if(r.status)throw Error(`${stage} failed`);
  fs.writeFileSync(`${out}/inputs-${stage}.json`,JSON.stringify(inputs,null,2)+'\n');
  }
  // Same UR2 commands at each stage; output is evidence, never the golden fixture.
  const test=head('src/test/u_r2_trace.test.ts').replace("import { describe, expect, it } from 'vitest';","const describe=(_name,fn)=>fn(),it=describe;")
   .replace("if (process.env.UR2_CAPTURE === '1') writeFileSync(fixture, JSON.stringify(traces, null, 2) + '\\n');\n        else expect(traces).toEqual(JSON.parse(readFileSync(fixture, 'utf8')));", "writeFileSync(process.argv[2], JSON.stringify(traces, null, 2) + '\\n');");
  await build({stdin:{contents:test,resolveDir:path.resolve('src/test'),loader:'ts'},outfile:`${work}/trace-${stage}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[plugin]});
  const trace=spawnSync(process.execPath,[`${work}/trace-${stage}.mjs`,`${out}/ur2-${stage}.json`],{stdio:'inherit'});if(trace.status)throw Error('Trace capture failed');
  const ur4=head('src/test/u_r4_trace.test.ts')
   .replace("import { describe, expect, it } from 'vitest';", "import assert from 'node:assert/strict'; const describe=(_name,fn)=>fn(),it=describe; const expect=a=>({toBe:e=>assert.equal(a,e),toEqual:e=>assert.deepEqual(a,e)});")
   .replace("const fixture = new URL('../../ai_docs/reports/u-r4-trace.json.gz', import.meta.url);", "const fixture = process.argv[2];");
  await build({stdin:{contents:ur4,resolveDir:path.resolve('src/test'),loader:'ts'},outfile:`${work}/ur4-${stage}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[plugin]});
  const r4=spawnSync(process.execPath,[`${work}/ur4-${stage}.mjs`,`${out}/ur4-${stage}.json.gz`],{env:{...process.env,UR4_CAPTURE:'1'},stdio:'inherit'});if(r4.status)throw Error('UR4 capture/invariants failed');
  console.log(stage,'captured');
 }
 const summary=[];
 for(let i=1;i<stages.length;i++){
  const a=stages[i-1],b=stages[i];if(!fs.existsSync(`${out}/generation-${a}.json.gz`)||!fs.existsSync(`${out}/generation-${b}.json.gz`))continue;
  const read=n=>JSON.parse(gunzipSync(fs.readFileSync(`${out}/generation-${n}.json.gz`)));
  const before=read(a),after=read(b),diff=after.flatMap((r,j)=>Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(before[j][k])).map(field=>({seed:r.seed,depth:r.depth,field})));
  summary.push({from:a,to:b,layers:new Set(diff.map(d=>`${d.seed}/${d.depth}`)).size,fields:Object.fromEntries([...new Set(diff.map(d=>d.field))].map(f=>[f,diff.filter(d=>d.field===f).length])),differences:diff});
 }
 fs.writeFileSync(`${out}/attribution.json`,JSON.stringify(summary,null,2)+'\n');
}finally{fs.rmSync(work,{recursive:true,force:true});}
