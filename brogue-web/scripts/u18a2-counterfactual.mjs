import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {gunzipSync} from 'node:zlib';
const dir='ai_docs/reports/u-18a-2-evidence';
const files=['Game.ts','Pathfinding.ts','ItemSpawnHeatMap.ts'];
const stages=['s0','s1','s2','s3','s4a','s4b','s4c'];
const results=[];
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u18a2-revert-'));
try{
 for(let i=1;i<stages.length;i++){
  const previous=stages[i-1],current=stages[i],restored={};
  for(const file of files){
   const a=`${dir}/${previous}/${file}.txt`,b=`${dir}/${current}/${file}.txt`;
   const diff=spawnSync('diff',['-u','--label',file,'--label',file,a,b],{encoding:'utf8'});
   assert.ok([0,1].includes(diff.status));
   const patch=`${dir}/${current}/${file}.patch`;fs.writeFileSync(patch,diff.stdout);
   const dest=`${tmp}/${file}`;fs.copyFileSync(b,dest);
   if(diff.stdout){const r=spawnSync('patch',['--reverse',dest,path.resolve(patch)],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);}
   restored[file]=fs.readFileSync(dest,'utf8');assert.equal(restored[file],fs.readFileSync(a,'utf8'));
  }
  await build({entryPoints:['scripts/u18a2-generation.ts'],outfile:`${tmp}/revert.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'reverse-only-current-delta',setup(b){b.onLoad({filter:/\/(Game|Pathfinding|ItemSpawnHeatMap)\.ts$/},args=>({contents:restored[path.basename(args.path)],loader:'ts'}));}}]});
  const output=`${dir}/${current}/reverted.json.gz`,fd=fs.openSync(`${dir}/${current}/reverted.txt`,'w');
  const run=spawnSync(process.execPath,[`${tmp}/revert.mjs`,output],{stdio:['ignore',fd,fd]});fs.closeSync(fd);assert.equal(run.status,0);
  assert.deepEqual(JSON.parse(gunzipSync(fs.readFileSync(output))),JSON.parse(gunzipSync(fs.readFileSync(`${dir}/${previous}/generation.json.gz`))));
  const guard=`step ${current.slice(1)}`,log=fs.openSync(`${dir}/${current}/negative-guard.txt`,'w');
  const test=spawnSync('npx',['vitest','run','src/test/u_18a_2_generation_terrain.test.ts','--config','scripts/u18a2-counterfactual.config.ts','-t',guard,'--reporter=json',`--outputFile=${dir}/${current}/negative-guard.json`],{env:{...process.env,U18A2_STAGE:previous},stdio:['ignore',log,log]});fs.closeSync(log);
  const report=JSON.parse(fs.readFileSync(`${dir}/${current}/negative-guard.json`));
  assert.equal(test.status,1);assert.ok(report.numFailedTests>0);
  assert.ok(report.testResults.some(f=>f.assertionResults.some(t=>t.status==='failed')));
  results.push({current,previous,reversedPatchReproducesPrevious:true,negativeGuard:guard,caught:report.numFailedTests});
  console.log(results.at(-1));
 }
 fs.writeFileSync(`${dir}/counterfactual.json`,JSON.stringify(results,null,2)+'\n');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
