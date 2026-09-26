// Each selection lever is enabled separately. Loader variants never mutate the worktree.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import crypto from 'node:crypto';import {execFileSync,spawn} from 'node:child_process';
import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-19f-evidence',work=fs.mkdtempSync(path.join(os.tmpdir(),'u19f-attribution-'));
const rows=JSON.parse(fs.readFileSync(`${out}/restored-rows.json`));
const stages=['s0','support','ce52','ce55','fungus',...rows.map(i=>`auto${i}`),'wall-layers'];
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const headCache=new Map();const head=f=>{if(!headCache.has(f))headCache.set(f,execFileSync('git',['show',`HEAD:brogue-web/${f}`],{encoding:'utf8'}));return headCache.get(f);};
const source=(name,file,final)=>{
 const stage=stages.indexOf(name);if(stage<0)throw Error(name);
 if(name==='s0')return head(file);
 if(file==='src/engine/Map/WallDoorFinish.ts'&&name!=='wall-layers')return head(file);
 if(file==='src/engine/Map/AutoGenerator.ts'){
  if(name==='wall-layers')return final;
  let contents=head(file);
  for(const index of rows.slice(0,Math.max(0,stage-4))){
   const pattern=new RegExp(`        ceLine: \\d+, index: ${index},[\\s\\S]*?\\n    },`);
   const match=final.match(pattern);if(!match)throw Error(`row ${index}`);contents=contents.replace(pattern,()=>match[0]);
  }return contents;
 }
 if(file==='src/engine/Generator/BlueprintEngine.ts'){
  let contents=final;
  if(stage<4)contents=contents.replace('FUNGUS_FOREST: TerrainType.FUNGUS_FOREST','FUNGUS_FOREST: TerrainType.FOLIAGE');
  const veto=(stage<2?'    if (bp.ceBlueprintId === 52) return false;\n':'')+(stage<3?"    if (bp.id === 'key_worm_tunnels') return false;\n":'');
  return contents.replace('    if (RETIRED_INVENTED_BLUEPRINT_IDS',veto+'    if (RETIRED_INVENTED_BLUEPRINT_IDS');
 }
 return final;
};
const selected=process.argv.slice(2).length?process.argv.slice(2):stages;
try{
 for(let i=0;i<selected.length;i+=2)await Promise.all(selected.slice(i,i+2).map(async name=>{
  const inputs={};
  await build({entryPoints:['scripts/u19f-observe.ts'],outfile:`${work}/${name}.mjs`,platform:'node',format:'esm',bundle:true,plugins:[{name:'attribution',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},a=>{
   const file=path.relative(process.cwd(),a.path),final=fs.readFileSync(a.path,'utf8'),contents=source(name,file,final);
   inputs[file]=sha(contents);return {contents,loader:file.endsWith('.json')?'json':'ts'};
  });}}]});
  const fd=fs.openSync(`${out}/generation-${name}.txt`,'w');
  const status=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,[`${work}/${name}.mjs`,`${out}/generation-${name}.json.gz`],{stdio:['ignore',fd,fd]});p.on('error',reject);p.on('close',resolve);});fs.closeSync(fd);
  fs.writeFileSync(`${out}/inputs-${name}.json`,JSON.stringify(inputs,null,2)+'\n');if(status!==0)throw Error(`stage ${name} failed: ${status}`);
  console.log(name,'captured');
 }));
 const read=name=>JSON.parse(gunzipSync(fs.readFileSync(`${out}/generation-${name}.json.gz`)));
 const summary=[];
 for(let i=1;i<stages.length;i++){
  const a=stages[i-1],b=stages[i];if(!fs.existsSync(`${out}/generation-${a}.json.gz`)||!fs.existsSync(`${out}/generation-${b}.json.gz`))continue;
  const before=read(a),after=read(b),diff=after.flatMap((r,j)=>Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(before[j][k])).map(field=>({seed:r.seed,depth:r.depth,field})));
  summary.push({from:a,to:b,layers:new Set(diff.map(d=>`${d.seed}/${d.depth}`)).size,fields:Object.fromEntries([...new Set(diff.map(d=>d.field))].map(f=>[f,diff.filter(d=>d.field===f).length])),differences:diff});
 }
 fs.writeFileSync(`${out}/attribution.json`,JSON.stringify(summary,null,2)+'\n');
}finally{fs.rmSync(work,{recursive:true,force:true});}
