import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const dir='ai_docs/reports/u-18a-3-evidence';
const stages=['s0','s5a','s5b','s5c','s5d','s5e','s6a','s6b','s6c','s6d','s6e','s6f','s6g','s7a','s7b','s7c','s7d','s8','s8b','s8c'];
const files=JSON.parse(fs.readFileSync(`${dir}/s8/files.json`));
const rows=s=>JSON.parse(gunzipSync(fs.readFileSync(`${dir}/${s}/generation.json.gz`)));
const result=process.argv[2]?JSON.parse(fs.readFileSync(`${dir}/counterfactual.json`)):[],tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u18a3-cf-'));
try{for(let i=1;i<stages.length;i++){
 const current=stages[i],previous=stages[i-1],restored={},patches=[];
 if(process.argv[2] && i<stages.indexOf(process.argv[2]))continue;
 for(const file of files){
  const name=path.basename(file),a=`${dir}/${previous}/${name}.txt`,b=`${dir}/${current}/${name}.txt`;
  if(!fs.existsSync(a)&&!fs.existsSync(b))continue;
  const pa=fs.existsSync(a)?a:'/dev/null',pb=fs.existsSync(b)?b:'/dev/null';
  const diff=spawnSync('diff',['-u','--label',name,'--label',name,pa,pb],{encoding:'utf8'});assert.ok([0,1].includes(diff.status));
  const patch=`${dir}/${current}/${name}.patch`;fs.writeFileSync(patch,diff.stdout);
  const dest=`${tmp}/${name}`;fs.writeFileSync(dest,fs.existsSync(b)?fs.readFileSync(b):'');
  if(diff.stdout){const r=spawnSync('patch',['--reverse',dest,path.resolve(patch)],{encoding:'utf8'});assert.equal(r.status,0,r.stdout+r.stderr);patches.push(name);}
  const value=fs.existsSync(dest)?fs.readFileSync(dest,'utf8'):'';
  assert.equal(value,fs.existsSync(a)?fs.readFileSync(a,'utf8'):'');
  if(fs.existsSync(a))restored[path.resolve(file)]=value;
 }
 await build({entryPoints:['scripts/u18a3-generation.ts'],outfile:`${tmp}/revert.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'reverse-only-stage',setup(b){b.onLoad({filter:/\.(ts|json)$/},args=>restored[args.path]!==undefined?{contents:restored[args.path],loader:args.path.endsWith('.json')?'json':'ts'}:undefined);}}]});
 const output=`${tmp}/result.gz`,log=fs.openSync(`${dir}/${current}/reverted.txt`,'w');
 const run=spawnSync(process.execPath,[`${tmp}/revert.mjs`,output],{stdio:['ignore',log,log]});fs.closeSync(log);assert.equal(run.status,0);
 const actual=JSON.parse(gunzipSync(fs.readFileSync(output))),expected=rows(previous);
 assert.deepEqual(actual,expected,`reverse ${current} must reproduce ${previous}`);
 result.push({current,previous,patches,layers:actual.length,reversedPatchReproducesPrevious:true});
 fs.writeFileSync(`${dir}/counterfactual.json`,JSON.stringify(result,null,2)+'\n');console.log(current,'->',previous,'exact');
}}finally{fs.rmSync(tmp,{recursive:true,force:true});}
