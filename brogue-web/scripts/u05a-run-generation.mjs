import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
const dir='ai_docs/reports/u-05a-evidence';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'u05a-attribution-'));
const modified=['src/engine/Generator/BlueprintEngine.ts','src/engine/Core/Game.ts'];
const hash=x=>createHash('sha256').update(x).digest('hex');
const input=Object.fromEntries(modified.map(f=>[f,{current:hash(fs.readFileSync(f)),control:hash(execFileSync('git',['show',`HEAD:brogue-web/${f}`]))}]));
for(const control of [true,false]){
 const mode=control?'control':'current',out=path.join(temp,`${mode}.cjs`);
 await build({entryPoints:['scripts/u05a-generation.ts'],outfile:out,bundle:true,platform:'node',format:'cjs',logLevel:'silent',plugins:control?[{name:'ownership-only-control',setup(b){
  b.onLoad({filter:/src\/(engine\/Core\/Game|engine\/Generator\/BlueprintEngine)\.ts$/},args=>{
   const file=modified.find(f=>args.path.endsWith(f));
   return {contents:execFileSync('git',['show',`HEAD:brogue-web/${file}`],{encoding:'utf8'}),loader:'ts'};
  });
 }}]:[]});
 const r=spawnSync(process.execPath,[out,`${dir}/generation-${mode}.json`],{encoding:'utf8'});
 fs.writeFileSync(`${dir}/generation-${mode}.txt`,r.stdout+r.stderr);
 if(r.status!==0)throw Error(`${mode}: ${r.stderr}`);
 console.log(mode,r.stdout.trim());
}
const base=JSON.parse(fs.readFileSync(`${dir}/baseline-before.json`));
const control=JSON.parse(fs.readFileSync(`${dir}/generation-control.json`)), current=JSON.parse(fs.readFileSync(`${dir}/generation-current.json`));
const diff=(a,b)=>base.seeds.flatMap(seed=>a[seed].flatMap((v,i)=>Object.keys(v).filter(k=>v[k]!==b[seed][i][k]).map(field=>({seed,depth:i+1,field,before:v[field],after:b[seed][i][field]}))));
const changes=diff(base.levels,current.levels),controlDiff=diff(base.levels,control.levels);
const first=base.seeds.map(seed=>{
 const i=current.traces[seed].findIndex((r,i)=>JSON.stringify(r.events)!==JSON.stringify(control.traces[seed][i].events));
 return {seed,depth:i+1,current:current.traces[seed][i],control:control.traces[seed][i]};
});
const problems=Object.entries(current.traces).flatMap(([seed,rows])=>rows.flatMap(r=>r.problems.map(p=>({seed,depth:r.depth,...p}))));
const result={input,controlDiff,fields:Object.fromEntries(['fp','n','species','items'].map(k=>[k,changes.filter(d=>d.field===k).length])),changedLayers:new Set(changes.map(d=>`${d.seed}:${d.depth}`)).size,changes,first,problems};
fs.writeFileSync(`${dir}/drift-attribution.json`,JSON.stringify(result,null,2)+'\n');
if(controlDiff.length || problems.length)throw Error('Stop: unexplained drift or conservation failure; do not recapture.');
fs.writeFileSync(`${dir}/baseline-candidate.json`,JSON.stringify({note:'U05a ownership-only correction; attribution and independent conservation guards: ai_docs/reports/u-05a.report.md',seeds:base.seeds,levels:Object.fromEntries(base.seeds.map(s=>[s,current.levels[s]]))},null,2)+'\n');
console.log(JSON.stringify({controlDiff:controlDiff.length,problems:problems.length,fields:result.fields,changedLayers:result.changedLayers}));
