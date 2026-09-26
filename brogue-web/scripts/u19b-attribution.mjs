import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import crypto from 'node:crypto';import {spawnSync,execFileSync} from 'node:child_process';
import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
import {sourceFiles,variant} from './u19b-variants.mjs';
const out='ai_docs/reports/u-19b-evidence',tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u19b-stage-'));
const names=process.argv.slice(2).length?process.argv.slice(2):['s0','s1','s2','s3','undo-items','undo-monsters','undo-amulet'];
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
try{
 for(const name of names){
  const sources={},hashes={};
  for(const file of sourceFiles){
   const stem=path.basename(file);let source;
   if(name.startsWith('undo-')){
    const pair={'undo-items':['s0','s1'],'undo-monsters':['s1','s2'],'undo-amulet':['s2','s3']}[name];
    const before=variant(pair[0],file),after=variant(pair[1],file);
    fs.writeFileSync(`${tmp}/before`,before);fs.writeFileSync(`${tmp}/after`,after);fs.writeFileSync(`${tmp}/${stem}`,after);
    if(before!==after){
     const diff=spawnSync('diff',['-u','--label',stem,'--label',stem,`${tmp}/before`,`${tmp}/after`],{encoding:'utf8'});
     if(diff.status!==1)throw Error('Expected a nonempty patch');
     fs.writeFileSync(`${out}/${name}-${stem}.patch`,diff.stdout);
     execFileSync('patch',['-R',`${tmp}/${stem}`],{input:diff.stdout});
    }
    source=fs.readFileSync(`${tmp}/${stem}`,'utf8');if(source!==before)throw Error('Reverse patch failed');
   }else source=variant(name,file);
   sources[file]=source;hashes[file]=sha(source);
  }
  fs.writeFileSync(`${out}/${name}-source-hashes.json`,JSON.stringify(hashes,null,2)+'\n');
  await build({entryPoints:['scripts/u19b-observe.ts'],outfile:`${tmp}/${name}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'u19b-stage',setup(b){b.onLoad({filter:/\/(BlueprintEngine|Architect|AutoGenerator|Game)\.ts$/},args=>{const file=sourceFiles.find(f=>args.path.endsWith('/'+f));if(file)return {contents:sources[file],loader:'ts'};});}}]});
  const fd=fs.openSync(`${out}/generation-${name}.txt`,'w'),r=spawnSync(process.execPath,[`${tmp}/${name}.mjs`,`${out}/generation-${name}.json.gz`],{stdio:['ignore',fd,fd]});fs.closeSync(fd);
  if(r.status!==0)throw Error(`${name}: ${r.status}`);console.log(name,'captured');
 }
 const read=name=>JSON.parse(gunzipSync(fs.readFileSync(`${out}/generation-${name}.json.gz`)));
 const diff=(a,b)=>b.flatMap((row,i)=>Object.keys(row).filter(k=>JSON.stringify(row[k])!==JSON.stringify(a[i][k])).map(field=>({seed:row.seed,depth:row.depth,field,before:a[i][field],after:row[field]})));
 const summary=[];
 for(const [a,b] of [['s0','s1'],['s1','s2'],['s2','s3'],['s0','undo-items'],['s1','undo-monsters'],['s2','undo-amulet']]){
  if(!fs.existsSync(`${out}/generation-${a}.json.gz`)||!fs.existsSync(`${out}/generation-${b}.json.gz`))continue;
  const differences=diff(read(a),read(b));summary.push({from:a,to:b,layers:new Set(differences.map(d=>`${d.seed}/${d.depth}`)).size,baselineFields:differences.filter(d=>['fp','n','species','items'].includes(d.field)).length,differences});
  if(b.startsWith('undo')&&differences.length)throw Error(`Counterfactual mismatch ${b}`);
 }
 fs.writeFileSync(`${out}/attribution.json`,JSON.stringify(summary,null,2)+'\n');console.log(summary.map(({from,to,layers,baselineFields})=>({from,to,layers,baselineFields})));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
