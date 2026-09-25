import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
const dir='ai_docs/reports/u-18a-2-evidence', stage=process.argv[2];
const files=['src/engine/Core/Game.ts','src/engine/Map/Pathfinding.ts','src/engine/Items/ItemSpawnHeatMap.ts'];
fs.mkdirSync(`${dir}/${stage}`,{recursive:true});
if(!process.argv.includes('--replay'))for(const f of files)fs.copyFileSync(f,`${dir}/${stage}/${path.basename(f)}.txt`);
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'u18a2-'));
try{
 await build({entryPoints:['scripts/u18a2-generation.ts'],outfile:`${temp}/capture.mjs`,bundle:true,platform:'node',format:'esm',
 plugins:[{name:'frozen-stage',setup(b){b.onLoad({filter:/\/(Game|Pathfinding|ItemSpawnHeatMap)\.ts$/},args=>({contents:fs.readFileSync(`${dir}/${stage}/${path.basename(args.path)}.txt`,'utf8'),loader:'ts'}));}}]});
 const log=fs.openSync(`${dir}/${stage}/generation.txt`,'w');
 const r=spawnSync(process.execPath,[`${temp}/capture.mjs`,`${dir}/${stage}/generation.json.gz`],{stdio:['ignore',log,log]});fs.closeSync(log);
 if(r.status!==0)throw Error(`capture failed ${r.status}`);
 if(process.argv.includes('--replay')) console.log(stage,'capture replayed');
 else {
  const drift=fs.openSync(`${dir}/${stage}/drift.txt`,'w');
  const d=spawnSync('npm',['run','test:drift'],{stdio:['ignore',drift,drift]});fs.closeSync(drift);
  fs.writeFileSync(`${dir}/${stage}/status.json`,JSON.stringify({capture:r.status,rawDrift:d.status})+'\n');
  console.log(stage,{capture:r.status,rawDrift:d.status});
 }
}finally{fs.rmSync(temp,{recursive:true,force:true});}
