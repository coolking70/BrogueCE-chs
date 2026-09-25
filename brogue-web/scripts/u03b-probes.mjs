import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
const root=process.cwd(),dir=path.resolve('ai_docs/reports/u-03b-evidence'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'u03b-probe-'));
const modes=process.argv.slice(2);const results=[];
try {
 fs.cpSync('src',path.join(temp,'src'),{recursive:true});fs.copyFileSync('package.json',path.join(temp,'package.json'));fs.copyFileSync('vite.config.ts',path.join(temp,'vite.config.ts'));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');fs.symlinkSync(path.join(root,'ai_docs'),path.join(temp,'ai_docs'),'dir');fs.symlinkSync(path.join(root,'scripts'),path.join(temp,'scripts'),'dir');
 for(const mode of modes) {
  for(const f of ['src/engine/Core/Game.ts','src/entities/Monster.ts','src/engine/Core/EntitySnapshot.ts','src/engine/Movement/LevelTravel.ts'])fs.copyFileSync(path.join(root,f),path.join(temp,f));
  let file='src/test/u_03b_level_travel.test.ts',pattern;
  if(mode==='head-graph'||mode==='head-phase'||mode==='head-expanded') {
   for(const f of ['src/engine/Core/Game.ts','src/entities/Monster.ts','src/engine/Core/EntitySnapshot.ts'])fs.writeFileSync(path.join(temp,f),execFileSync('git',['show',`HEAD:brogue-web/${f}`]));
   const historical = mode==='head-graph'?['src/test/u_03_whole_run_snapshot.test.ts']:mode==='head-phase'?['src/test/u_02b_level_rng.test.ts','src/test/c_5_fall_subsystem.test.ts','src/test/g_2_gas_df_wiring.test.ts']:['src/test/c_4a_0_layer_model.test.ts','src/test/c_4b_dungeon_feature.test.ts','src/test/u_10_absorption_snapshot.test.ts','src/test/ui_2_protection.test.ts','src/test/w_11_teleport_placement.test.ts'];
   for(const f of historical) fs.writeFileSync(path.join(temp,f),execFileSync('git',['show',`HEAD:brogue-web/${f}`]));
   file=mode==='head-graph'?'src/test/u_03_whole_run_snapshot.test.ts':'src/test/u_02b_level_rng.test.ts';pattern=mode==='head-graph'?'restores one object per ID':mode==='head-expanded'?'生成不产气|F3 留痕|queued survivor|quiverNumber 为零值|CE fire-trap depression':'first layer starts|different actual D1|踩上渊格的同一动作|泥格晋升命中后';
  }else {
   const f=path.join(temp,mode==='delay'?'src/engine/Movement/LevelTravel.ts':'src/engine/Core/Game.ts');let s=fs.readFileSync(f,'utf8');
   const old=mode==='delay'?'Math.floor(distance*m.movementSpeed/100)+1':mode==='warm'?'(cached.awaySince ?? 0)) : 50);':'                this.updateEnvironment();';
   const replacement=mode==='delay'?'Math.floor(distance*m.movementSpeed/100)':mode==='warm'?'(cached.awaySince ?? 0)) : 49);':'                this.tickCreatureStatuses(); this.updateEnvironment();';
   if(s.split(old).length!==2)throw Error(`mutation ambiguous ${mode}`);s=s.replace(old,replacement);fs.writeFileSync(f,s);
   pattern=mode==='delay'?'distance × current speed':mode==='warm'?'new level runs 50':'real gas, fire and promotion';
  }
  const fd=fs.openSync(path.join(dir,`probe-${mode}.txt`),'w');const r=spawnSync(path.join(root,'node_modules/.bin/vitest'),['run',...(mode==='head-expanded'?['src/test/c_4a_0_layer_model.test.ts','src/test/c_4b_dungeon_feature.test.ts','src/test/u_10_absorption_snapshot.test.ts','src/test/ui_2_protection.test.ts','src/test/w_11_teleport_placement.test.ts']:[file]),...(mode==='head-phase'?['src/test/c_5_fall_subsystem.test.ts','src/test/g_2_gas_df_wiring.test.ts']:[]),'-t',pattern,'--maxWorkers=1','--reporter=json',`--outputFile=${path.join(dir,`probe-${mode}.json`)}`],{cwd:temp,stdio:['ignore',fd,fd]});fs.closeSync(fd);
  results.push({mode,status:r.status,file,pattern});
 }
 fs.writeFileSync(path.join(dir,modes.includes('head-expanded')?'expanded-counterfactual.json':modes.includes('head-phase')?'phase-counterfactual.json':'probes.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
