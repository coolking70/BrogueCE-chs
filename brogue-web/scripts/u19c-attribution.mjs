import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync,execFileSync} from 'node:child_process';import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-19c-evidence',files=['src/engine/Core/Game.ts','src/engine/Generator/BlueprintEngine.ts','src/engine/Generator/Architect.ts'];
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const saved=(file,stage)=>fs.readFileSync(`${out}/${path.basename(file,'.ts')}-${stage}.ts.txt`,'utf8');
const currentFiles=Object.fromEntries(files.map(f=>[f,fs.readFileSync(f,'utf8')]));
const s6Files={...currentFiles,[files[0]]:saved(files[0],'s6')};
const finals={...s6Files};
const gameFile=files[0],bpFile=files[1];
const traceStart=finals[gameFile].indexOf('                    // U25 reports final ownership/location');
const traceEnd=finals[gameFile].indexOf('                    const leader = spawn.entities[0];',traceStart);
if(traceStart<0||traceEnd<traceStart)throw Error('Missing final trace stage');
finals[gameFile]=finals[gameFile].slice(0,traceStart)+finals[gameFile].slice(traceEnd);
finals[bpFile]=finals[bpFile].replace(`        if (torchBearer && torch) {
            if (this.entities && (!torchBearer.entities?.[0] || torchBearer.entities[0].hp <= 0)) return fail('item bearer removed during construction');
            torchBearer.carriedItem = torch;
        }`, '        if (torchBearer && torch) torchBearer.carriedItem = torch;');
const between=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
function source(stage,file){
 if(stage==='s8')return currentFiles[file];
 if(stage==='s7')return file===gameFile?saved(file,'s7'):s6Files[file];
 if(stage==='s6')return s6Files[file];
 if(['s0','s1','s2'].includes(stage))return saved(file,stage==='s0'?'before':stage);
 if(stage==='s5')return finals[file];
 if(stage.startsWith('s5')){
  let s=source('s4',file);const rank=['s5a','s5b','s5c','s5d'].indexOf(stage);
  if(file.endsWith('BlueprintEngine.ts'))return finals[file]; // live floor item query
  if(file.endsWith('Game.ts')){
   if(rank>=1)s=s.replace('...machineResults.flatMap(m => [...m.itemSpawns, ...m.monsterSpawns]).map(s => s.pos),', '...machineResults.flatMap(m => [...m.itemSpawns.filter(s => !s.entity),\n                ...m.monsterSpawns.filter(s => !s.entities)]).map(s => s.pos),');
   if(rank>=2){
    const a='    private findMinionSpawnSpot(',b='    /**\n     * P4-2：';s=s.replace(between(s,a,b),between(finals[file],a,b));
    s=s.replace('this.findMinionSpawnSpot(centerPos, memberMData, h.spawnsIn, false);','this.findMinionSpawnSpot(centerPos, memberMData, h.spawnsIn, false, !!collected);');
   }
   if(rank>=3)s=s.replace('                    this.grid = new Grid(DCOLS, DROWS);','                    this.grid = new Grid(DCOLS, DROWS);\n                    this.player.loc = {x: 0, y: 0}; // CE removes the player during digDungeon.');
  }
  return s;
 }
 let s=saved(file,'s2');
 if(file.endsWith('Game.ts')){
  s=s.replace('this.spawnHordeAt(picked, spawn.pos, roll.depth, false, undefined, collected);','this.spawnHordeAt(picked, spawn.pos, depth, false, undefined, collected);');
  if(stage==='s3a')return s;
  const a='    private spawnHordeAt(',b='    /** CE spawnMinions:';
  s=s.replace(between(s,a,b),between(finals[file],a,b).replace('h.spawnsIn, false, !!collected)','h.spawnsIn, false)'));
  if(stage==='s3b')return s;
  const c='    private createMachineRuntime(',d='    /** Resolve a blueprint monster';
  s=s.replace(between(s,c,d),between(finals[file],c,d));
 }else if(file.endsWith('BlueprintEngine.ts')&&stage==='s4'){
  // Rollback/observation changes only; preserve s2 reservation readers.
  s=s.replace('if (!machineLeader) machineLeader = mon;','if (!machineLeader || machineLeader.hp <= 0) machineLeader = mon;');
  const a='        const fail = (reason: string): null => {',b='        const priorItemIds';
  const final=finals[file];const start=final.indexOf(a),end=final.indexOf('\n        };',start)+11;
  if(start<0||end<start)throw Error('Missing rollback block');
  s=s.replace('        const generatedItems: MachineItemSpawn[] = [];','        const generatedItems: MachineItemSpawn[] = [];\n'+final.slice(start,end));
  for(const reason of ['`feature #${feat}: child machine failed`','`feature #${feat}: ${placed} < minimum ${minInstances}`',"'adopted item destination blocked'","'item ownership invariant'","'no passable room center'"])s=s.replace(`return recordMachineRollback(observation, ${reason});`,`return fail(${reason});`);
 }
 return s;
}
const stages=['s0','s1','s2','s3a','s3b','s4','s5a','s5b','s5c','s5d','s5','s6','s7','s8'];
const names=process.argv.slice(2).length?process.argv.slice(2):stages;
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u19c-attribution-'));
try{
 for(const name of names){
  const sources={};
  for(const file of files){
   if(name.startsWith('undo-')){
    const current=name.slice(5),prior=stages[stages.indexOf(current)-1];if(!prior)throw Error(name);
    const a=source(prior,file),b=source(current,file);fs.writeFileSync(`${tmp}/before`,a);fs.writeFileSync(`${tmp}/after`,b);fs.writeFileSync(`${tmp}/target`,b);
    if(a!==b){const r=spawnSync('diff',['-u','--label',file,'--label',file,`${tmp}/before`,`${tmp}/after`],{encoding:'utf8'});if(r.status!==1)throw Error('diff');fs.writeFileSync(`${out}/${name}-${path.basename(file)}.patch`,r.stdout);execFileSync('patch',['-R',`${tmp}/target`],{input:r.stdout});}
    sources[file]=fs.readFileSync(`${tmp}/target`,'utf8');if(sources[file]!==a)throw Error('reverse patch differs');
   }else sources[file]=source(name,file);
  }
  fs.writeFileSync(`${out}/${name}-source-hashes.json`,JSON.stringify(Object.fromEntries(Object.entries(sources).map(([f,s])=>[f,sha(s)])),null,2)+'\n');
  await build({entryPoints:['scripts/u19c-observe.ts'],outfile:`${tmp}/${name}.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'stage',setup(b){b.onLoad({filter:/\/(Game|BlueprintEngine|Architect)\.ts$/},a=>{const file=files.find(f=>a.path.endsWith('/'+f));if(file)return {contents:sources[file],loader:'ts'};});}}]});
  const fd=fs.openSync(`${out}/generation-${name}.txt`,'w');const r=spawnSync(process.execPath,[`${tmp}/${name}.mjs`,`${out}/generation-${name}.json.gz`],{stdio:['ignore',fd,fd]});fs.closeSync(fd);if(r.status!==0)throw Error(`${name} exit ${r.status}`);console.log(name,'captured');
 }
 const read=n=>JSON.parse(gunzipSync(fs.readFileSync(`${out}/generation-${n}.json.gz`)));
 const pairs=stages.slice(1).map((b,i)=>[stages[i],b]).concat(stages.slice(1).map((s,i)=>[stages[i],`undo-${s}`]));
 const rows=[];
 for(const [a,b] of pairs){if(!fs.existsSync(`${out}/generation-${a}.json.gz`)||!fs.existsSync(`${out}/generation-${b}.json.gz`))continue;const before=read(a),after=read(b),differences=after.flatMap((r,i)=>Object.keys(r).filter(k=>JSON.stringify(r[k])!==JSON.stringify(before[i][k])).map(field=>({seed:r.seed,depth:r.depth,field})));rows.push({from:a,to:b,layers:new Set(differences.map(d=>`${d.seed}/${d.depth}`)).size,fields:Object.fromEntries([...new Set(differences.map(d=>d.field))].map(f=>[f,differences.filter(d=>d.field===f).length])),differences});if(b.startsWith('undo')&&differences.length)throw Error(`Reverse mismatch ${b}`);}
 fs.writeFileSync(`${out}/attribution.json`,JSON.stringify(rows,null,2)+'\n');console.log(rows.map(({differences,...r})=>r));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
