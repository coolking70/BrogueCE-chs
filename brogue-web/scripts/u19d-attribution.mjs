import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync,execFileSync} from 'node:child_process';import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-19d-evidence',files=['src/engine/Generator/BlueprintEngine.ts','src/engine/Core/Game.ts'];
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const saved=(f,s)=>fs.readFileSync(`${out}/${path.basename(f,'.ts')}-${s}.ts.txt`,'utf8');
const source=(s,f)=>s==='s0'?saved(f,'before'):s==='s1'?saved(f,f===files[0]?'s1':'before'):s==='s2'&&f===files[1]?saved(f,'before'):fs.readFileSync(f,'utf8');
const stages=['s0','s1','s2','s3'];const names=process.argv.slice(2).length?process.argv.slice(2):[...stages,'undo-s1','undo-s2','undo-s3'];
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'u19d-stage-'));
try{for(const name of names){const inputs={};for(const file of files){
 if(name.startsWith('undo-')){const s=name.slice(5),prior=stages[stages.indexOf(s)-1],a=source(prior,file),b=source(s,file);fs.writeFileSync(`${temp}/a`,a);fs.writeFileSync(`${temp}/b`,b);fs.writeFileSync(`${temp}/target`,b);
 if(a!==b){const diff=spawnSync('diff',['-u','--label',file,'--label',file,`${temp}/a`,`${temp}/b`],{encoding:'utf8'});if(diff.status!==1)throw Error('diff');fs.writeFileSync(`${out}/${name}-${path.basename(file)}.patch`,diff.stdout);execFileSync('patch',['-R',`${temp}/target`],{input:diff.stdout});}
 inputs[file]=fs.readFileSync(`${temp}/target`,'utf8');if(inputs[file]!==a)throw Error('reverse mismatch');
 }else inputs[file]=source(name,file);}
 fs.writeFileSync(`${out}/${name}-inputs.json`,JSON.stringify(Object.fromEntries(Object.entries(inputs).map(([f,s])=>[f,sha(s)])),null,2)+'\n');
 await build({entryPoints:['scripts/u19d-observe.ts'],outfile:`${temp}/run.mjs`,platform:'node',format:'esm',bundle:true,plugins:[{name:'stage',setup(b){b.onLoad({filter:/\/(BlueprintEngine|Game)\.ts$/},a=>{const f=files.find(f=>a.path.endsWith('/'+f));if(f)return{contents:inputs[f],loader:'ts'};});}}]});
 const fd=fs.openSync(`${out}/generation-${name}.txt`,'w'),r=spawnSync(process.execPath,[`${temp}/run.mjs`,`${out}/generation-${name}.json.gz`],{stdio:['ignore',fd,fd]});fs.closeSync(fd);if(r.status!==0)throw Error(name);console.log(name,'captured');
}
const read=s=>JSON.parse(gunzipSync(fs.readFileSync(`${out}/generation-${s}.json.gz`)));
const pairs=stages.slice(1).map((s,i)=>[stages[i],s]).concat(stages.slice(1).map((s,i)=>[stages[i],`undo-${s}`]));
const rows=pairs.map(([a,b])=>{const before=read(a),after=read(b),diff=after.flatMap((r,i)=>Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(before[i][k])).map(field=>({seed:r.seed,depth:r.depth,field})));if(b.startsWith('undo')&&diff.length)throw Error(b);return{from:a,to:b,layers:new Set(diff.map(d=>`${d.seed}/${d.depth}`)).size,fields:Object.fromEntries([...new Set(diff.map(d=>d.field))].map(f=>[f,diff.filter(d=>d.field===f).length])),differences:diff};});
fs.writeFileSync(`${out}/attribution.json`,JSON.stringify(rows,null,2)+'\n');console.log(rows.map(({differences,...r})=>r));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
