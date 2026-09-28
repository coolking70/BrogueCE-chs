import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
const evidence=path.resolve('ai_docs/reports/x3-u8c-evidence');
const additional=process.argv.includes('--additional');
const scroll=process.argv.includes('--scroll');
const label=scroll?'counterfactual-scroll':additional?'counterfactual-additional':'counterfactual';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'x3-u8c-baseline-'));
const app=path.join(root,'brogue-web');fs.mkdirSync(app);
const files=execFileSync('git',['ls-files','src','package.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json'],{encoding:'utf8'}).trim().split('\n');
for(const file of files){const dst=path.join(app,file);fs.mkdirSync(path.dirname(dst),{recursive:true});fs.writeFileSync(dst,execFileSync('git',['show',`HEAD:brogue-web/${file}`],{maxBuffer:20e6}));}
fs.symlinkSync(path.resolve('node_modules'),path.join(app,'node_modules'),'dir');
fs.symlinkSync(path.resolve('../BrogueCE-master'),path.join(root,'BrogueCE-master'),'dir');
const selected=scroll
 ? ['src/test/scroll_effects.test.ts','-t','AI 侧生效|AI 目标选择覆盖']
 : additional
 ? ['src/test/b_1_weapon_specials.test.ts','src/test/p4_6_attack_geometry.test.ts','src/test/x4b_flavor_text.test.ts','-t','QUICKLY 分支漏实现|分支优先级写反|攻击顺序写成正序|retains combat']
 : ['src/test/x3_u4_auto_travel.test.ts','src/test/x3_u6_messages.test.ts','src/test/p1_37_machine_flag_i18n.test.ts','src/test/p4_7_player_weapon_geometry.test.ts','-t','allows latest|every message|攻击顺序写成正序|漏了额外恢复回合|AD5b'];
const args=['vitest','run',...selected,'--maxWorkers=1','--no-file-parallelism','--reporter=json',`--outputFile=${evidence}/${label}-head.json`];
const fd=fs.openSync(`${evidence}/${label}-head.txt`,'w');
const run=spawnSync('npx',['--no-install',...args],{cwd:app,stdio:['ignore',fd,fd]});fs.closeSync(fd);
fs.writeFileSync(`${evidence}/${label}.json`,JSON.stringify({base:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),command:['npx','--no-install',...args],exit:run.status,source:'isolated git-show HEAD source tree',files:files.length},null,2)+'\n');
fs.rmSync(root,{recursive:true,force:true});console.log('baseline exit',run.status);process.exitCode=run.status;
