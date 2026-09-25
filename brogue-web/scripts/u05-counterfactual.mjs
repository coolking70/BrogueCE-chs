import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
const dir=path.resolve('ai_docs/reports/u-05-evidence'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'u05-counterfactual-'));
const sourceFiles=['src/engine/Core/Game.ts','src/engine/Items/ItemLoader.ts','src/engine/Generator/BlueprintEngine.ts'];
try{
 fs.cpSync('src',path.join(temp,'src'),{recursive:true});
 for(const f of ['package.json','vite.config.ts'])fs.copyFileSync(f,path.join(temp,f));
 fs.mkdirSync(path.join(temp,'node_modules'));
 for(const name of fs.readdirSync('node_modules').filter(n=>!n.startsWith('.')||n==='.bin'))fs.symlinkSync(fs.realpathSync(path.join('node_modules',name)),path.join(temp,'node_modules',name));
 fs.mkdirSync(path.join(temp,'ai_docs/reports/u-05-evidence'),{recursive:true});
 for(const f of ['historical-null-requests.json','ce-golden.json'])fs.copyFileSync(`${dir}/${f}`,path.join(temp,'ai_docs/reports/u-05-evidence',f));
 const outcomes=[];
 function run(name,file,pattern){const fd=fs.openSync(`${dir}/${name}.txt`,'w');
  const r=spawnSync('npx',['vitest','run',file,...(pattern?['-t',pattern]:[]),'--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${dir}/${name}.json`],{cwd:temp,stdio:['ignore',fd,fd]});fs.closeSync(fd);
  const j=JSON.parse(fs.readFileSync(`${dir}/${name}.json`)),result={name,status:r.status,passed:j.numPassedTests,failed:j.numFailedTests};outcomes.push(result);return result;
 }
 const oldTest='src/test/t_1_tail.test.ts';
 for(const f of sourceFiles)fs.writeFileSync(path.join(temp,f),execFileSync('git',['show',`HEAD:brogue-web/${f}`]));
 assert.equal(run('t1-head-control',oldTest,'AD-A3').status,0);
 for(const f of sourceFiles)fs.copyFileSync(f,path.join(temp,f));
 assert.equal(run('t1-current-original',oldTest,'AD-A3').failed,1);
 const original=fs.readFileSync(oldTest,'utf8');
 const proposed=original.replace('卷轴/药水恰 1（CE chooseKind 恰 1 次 rand_range','卷轴/药水恰 2（CE pickItemCategory + chooseKind 各 1 次 rand_range')
  .replace('`${category} 蓝图抽取的 RNG 消耗必须恰为 1（多掷/少掷在此翻红）`).toBe(1);','`${category} 蓝图抽取的 RNG 消耗必须恰为 2（类别 + 种类）`).toBe(2);');
 assert.notEqual(original,proposed);fs.writeFileSync(path.join(temp,oldTest),proposed);
 assert.equal(run('t1-proposal',oldTest,'AD-A3').status,0);
 fs.writeFileSync(`${dir}/proposed-t1.test.ts.txt`,proposed);
 const patch=spawnSync('diff',['-u','--label',oldTest,'--label',oldTest,path.resolve(oldTest),path.join(temp,oldTest)],{encoding:'utf8'});
 fs.writeFileSync(`${dir}/proposed-t1.patch`,patch.stdout);
 const target='src/engine/Items/MachineItemGeneration.ts',source=fs.readFileSync(target,'utf8');
 const variants={
  'negative-no-filter':source.replace('while (item && machineItemRejections(item, qualifiers, previous).length)', 'while (false && item && machineItemRejections(item, qualifiers, previous).length)'),
  'negative-cap-1000':source.replace('let failsafe = 1000;', 'let failsafe = 998;'),
  'negative-no-duplicates':source.replace("reasons.push('duplicate')",'void 0'),
 };
 for(const [name,value] of Object.entries(variants)){assert.notEqual(value,source);fs.writeFileSync(path.join(temp,target),value);assert.ok(run(name,'src/test/u_05_machine_items.test.ts').failed>0);}
 fs.writeFileSync(`${dir}/counterfactual.json`,JSON.stringify({outcomes,oldGuardUnchanged:true,negativeControlsCaught:true},null,2)+'\n');console.log(JSON.stringify(outcomes));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
