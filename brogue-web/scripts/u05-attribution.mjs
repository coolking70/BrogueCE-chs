import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
const dir='ai_docs/reports/u-05-evidence', temp=fs.mkdtempSync(path.join(os.tmpdir(),'u05-stage-'));
const files=['src/engine/Core/Game.ts','src/engine/Items/ItemLoader.ts','src/engine/Generator/BlueprintEngine.ts'];
const hash=s=>createHash('sha256').update(s).digest('hex');
const base=JSON.parse(fs.readFileSync(`${dir}/baseline-before.json`));
const stages=['control','staff-wand','ring-charm','category','final'];
const input={}, results={};
for(const stage of stages){
 const source=Object.fromEntries(files.map(file=>{
  const snapshot=`${dir}/stage-${stage}.${path.basename(file)}.txt`;
  return [file,stage==='final'?fs.readFileSync(file,'utf8'):fs.existsSync(snapshot)?fs.readFileSync(snapshot,'utf8'):execFileSync('git',['show',`HEAD:brogue-web/${file}`],{encoding:'utf8'})];
 }));
 input[stage]=Object.fromEntries(Object.entries(source).map(([f,s])=>[f,hash(s)]));
 const outfile=path.join(temp,stage+'.cjs');
 await build({entryPoints:['scripts/u05-generation.ts'],outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent',plugins:[{name:'one-stage',setup(b){
  b.onLoad({filter:/src\/engine\/(Core\/Game|Items\/ItemLoader|Generator\/BlueprintEngine)\.ts$/},a=>({contents:source[files.find(f=>a.path.endsWith(f))],loader:'ts'}));
 }}]});
 const r=spawnSync(process.execPath,[outfile,`${dir}/generation-${stage}.json`],{encoding:'utf8'});
 fs.writeFileSync(`${dir}/generation-${stage}.txt`,r.stdout+r.stderr);
 if(r.status!==0)throw Error(stage+': '+r.stderr);
 results[stage]=JSON.parse(fs.readFileSync(`${dir}/generation-${stage}.json`));
 console.log(stage,r.stdout.trim());
}
const diff=(a,b)=>base.seeds.flatMap(seed=>a[seed].flatMap((row,i)=>Object.keys(row).filter(k=>row[k]!==b[seed][i][k]).map(field=>({seed,depth:i+1,field,before:row[field],after:b[seed][i][field]}))));
const transitions=stages.slice(1).map((stage,i)=>{
 const previous=stages[i],changes=diff(results[previous].levels,results[stage].levels);
 const first=base.seeds.map(seed=>{
  const depth=results[stage].traces[seed].findIndex((r,i)=>JSON.stringify(r.events)!==JSON.stringify(results[previous].traces[seed][i].events));
  return {seed,depth:depth+1,previous:results[previous].traces[seed][depth]?.events,current:results[stage].traces[seed][depth]?.events};
 });
 return {previous,stage,changes,changedLayers:new Set(changes.map(d=>`${d.seed}/${d.depth}`)).size,first};
});
const problems=Object.values(results.final.traces).flatMap(rows=>rows.flatMap(r=>r.problems));
const result={input,controlDiff:diff(base.levels,results.control.levels),transitions,problems};
fs.writeFileSync(`${dir}/drift-attribution.json`,JSON.stringify(result,null,2)+'\n');
if(result.controlDiff.length||problems.length)throw Error('Unexplained control drift / independent ownership failure; no recapture.');
fs.writeFileSync(`${dir}/baseline-candidate.json`,JSON.stringify({...base,note:'U05 machine materialization and CE quality rerolls; three-stage attribution and independent guards: ai_docs/reports/u-05.report.md',levels:Object.fromEntries(base.seeds.map(s=>[s,results.final.levels[s]]))},null,2)+'\n');
console.log(JSON.stringify({controlDiff:result.controlDiff.length,problems:problems.length,transitions:transitions.map(t=>({stage:t.stage,fields:t.changes.length,layers:t.changedLayers}))}));
