// Old-rule counterfactual: unmodified HEAD guards against unmodified HEAD production.
// Never changes the working source, guards, or baseline.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
const root=process.cwd(),dir=path.join(root,'ai_docs/reports/u-02b-evidence');
const base=fs.mkdtempSync(path.join(os.tmpdir(),'brogue-u02b-guards-'));
const temp=path.join(base,'brogue-web');fs.mkdirSync(temp);
fs.symlinkSync(path.resolve('../BrogueCE-master'),path.join(base,'BrogueCE-master'),'dir');
fs.symlinkSync(path.join(root,'ai_docs'),path.join(temp,'ai_docs'),'dir');
const tests=['src/test/u_02a_rng_snapshot.test.ts','src/test/p1_31_35_placement_snapshot.test.ts','src/test/b_1b_identification_persistence.test.ts','src/test/u_10_absorption_snapshot.test.ts',...['p4_3_special_monster_flags','u_06_monster_damage','u_08_terrain_bolts','w_5_arcana_instance','w_7_arcana_enchantment','w_8_staff_damage','w_24_wand_catalog','w_25_staff_catalog','w_13_tunneling','c_5_fall_subsystem','f_2a_fire_mechanics','v_2b_9c_effects','c_4b_dungeon_feature','blueprint_center','v_2b_7_features'].map(n=>'src/test/'+n+'.test.ts')];
try{
 fs.cpSync('src',path.join(temp,'src'),{recursive:true});
 fs.copyFileSync('vite.config.ts',path.join(temp,'vite.config.ts'));fs.copyFileSync('package.json',path.join(temp,'package.json'));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');
 for(const f of [...tests,'src/engine/Random.ts','src/engine/Core/Game.ts','src/engine/Map/WaypointMap.ts'])fs.writeFileSync(path.join(temp,f),execFileSync('git',['show',`HEAD:brogue-web/${f}`]));
 const fd=fs.openSync(path.join(dir,'guard-expanded-counterfactual.txt'),'w');
 const r=spawnSync(path.join(root,'node_modules/.bin/vitest'),['run',...tests,'--maxWorkers=4','--reporter=json',`--outputFile=${path.join(dir,'guard-expanded-counterfactual-tests.json')}`],{cwd:temp,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 fs.writeFileSync(path.join(dir,'guard-expanded-counterfactual.json'),JSON.stringify({status:r.status,tests,source:'HEAD (pre-U02b)',guards:'HEAD unmodified'},null,2)+'\n');
 process.exitCode=r.status??1;
}finally{fs.rmSync(base,{recursive:true,force:true});}
