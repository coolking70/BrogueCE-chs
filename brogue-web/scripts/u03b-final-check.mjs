import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
const dir='ai_docs/reports/u-03b-evidence';
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const write=(n,v)=>fs.writeFileSync(`${dir}/${n}.json`,JSON.stringify(v,null,2)+'\n');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const initial=JSON.parse(fs.readFileSync(`${dir}/session-input-before.json`));
const allowed=['progress.md','scripts/u03-state-contract.json','src/engine/Core/EntitySnapshot.ts','src/engine/Core/Game.ts','src/entities/Monster.ts','src/test/fixtures/generation_baseline.json','src/test/c_5_fall_subsystem.test.ts','src/test/g_2_gas_df_wiring.test.ts','src/test/u_02b_level_rng.test.ts','src/test/c_4a_0_layer_model.test.ts','src/test/c_4b_dungeon_feature.test.ts','src/test/ui_2_protection.test.ts','src/test/w_11_teleport_placement.test.ts'];
if(fs.existsSync(`${dir}/guard-approval.json`))allowed.push(...JSON.parse(fs.readFileSync(`${dir}/guard-approval.json`)).files);
const changed=Object.keys(initial).filter(f=>!fs.existsSync(f)||hash(f)!==initial[f]);
assert.ok(changed.every(f=>allowed.includes(f)),`unexpected modifications: ${changed.filter(f=>!allowed.includes(f))}`);
const protectedTests=Object.keys(initial).filter(f=>f.endsWith('.test.ts')&&!allowed.includes(f));
assert.ok(protectedTests.every(f=>hash(f)===initial[f]));
const ceChanged=execFileSync('git',['diff','HEAD','--name-only','--','../BrogueCE-master'],{encoding:'utf8'}).trim();assert.equal(ceChanged,'');
write('boundary',{allowed,changed,protectedTests:protectedTests.length,allProtectedTestsUnchanged:true,CEUnchanged:true});
const baseline='src/test/fixtures/generation_baseline.json',recapture=JSON.parse(fs.readFileSync(`${dir}/recapture.json`));assert.equal(hash(baseline),recapture.afterSHA256);
const files=[...new Set([...walk('src'),...walk('public'),...walk('scripts'),...walk('../BrogueCE-master/src'),
 'progress.md','ai_docs/tasks/u-03b.prompt.md','ai_docs/reports/u-03.report.md','ai_docs/reports/x-0-survey.report.md',
 ...fs.readdirSync('.').filter(f=>/^(package.*json|tsconfig.*json|vite.config.ts|index.html)$/.test(f))])].sort();
const snapshot=()=>Object.fromEntries(files.map(f=>[f,hash(f)]));
const before=snapshot();write('final-input-before',before);const outcomes=[];
function run(name,cmd,args){const fd=fs.openSync(`${dir}/${name}.txt`,'w'),start=Date.now();const r=spawnSync(cmd,args,{stdio:['ignore',fd,fd]});fs.closeSync(fd);outcomes.push({name,cmd,args,status:r.status,signal:r.signal,durationMs:Date.now()-start});write('outcomes',outcomes);console.log(JSON.stringify(outcomes.at(-1)));}
run('final-premise-audit',process.execPath,['scripts/u03b-premise-audit.mjs']);
run('final-scope',process.execPath,['scripts/u03b-test-scope.mjs']);
const closure=JSON.parse(fs.readFileSync(`${dir}/closure.json`)),all=closure.all;assert.equal(closure.unresolved.length,0);assert.equal(closure.nonliteral.length,0);
assert.ok(all.some(f=>f.includes('p1_30')));assert.ok(all.some(f=>f.includes('u24')));
run('final-build','npm',['run','build']);
run('final-regression','npx',['vitest','run',...all.filter(f=>!f.endsWith('generation_baseline.test.ts')),'--maxWorkers=8','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-tests.json`]);
run('final-drift','npm',['run','test:drift','--','--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-drift.json`]);
const after=snapshot();write('final-input-after',after);const inputChanges=files.filter(f=>before[f]!==after[f]);
const perFile=[],failures=[];
for(const name of ['final-tests','final-drift'])for(const f of JSON.parse(fs.readFileSync(`${dir}/${name}.json`)).testResults){
 const file=path.relative(process.cwd(),f.name);perFile.push({file,status:f.status,passed:f.assertionResults.filter(a=>a.status==='passed').length,failed:f.assertionResults.filter(a=>a.status==='failed').length,skipped:f.assertionResults.filter(a=>a.status==='pending'||a.status==='skipped').length,todo:f.assertionResults.filter(a=>a.status==='todo').length});
 for(const a of f.assertionResults.filter(a=>a.status==='failed'))failures.push({file,title:a.fullName,messages:a.failureMessages});
}
const actual=perFile.map(f=>f.file).sort(),coverage={expected:all.length,actual:actual.length,missing:all.filter(f=>!actual.includes(f)),extra:actual.filter(f=>!all.includes(f)),duplicates:actual.filter((f,i)=>actual.indexOf(f)!==i)};
write('result-coverage',coverage);write('failures',failures);write('final-files',perFile);
fs.writeFileSync(`${dir}/final-files.md`,'| 文件 | 状态 | 通过 | 失败 | 跳过 | todo |\n|---|---|---:|---:|---:|---:|\n'+perFile.map(f=>`| ${f.file} | ${f.status} | ${f.passed} | ${f.failed} | ${f.skipped} | ${f.todo} |`).join('\n')+'\n');
const result={outcomes,changed:inputChanges,inputCount:files.length,inputManifestSHA256:hash(`${dir}/final-input-after.json`),baselineSHA256:hash(baseline),final:true,
 totals:perFile.reduce((a,f)=>({files:a.files+1,passed:a.passed+f.passed,failed:a.failed+f.failed,skipped:a.skipped+f.skipped,todo:a.todo+f.todo}),{files:0,passed:0,failed:0,skipped:0,todo:0})};
write('final-check',result);console.log(JSON.stringify(result));
if(inputChanges.length||coverage.missing.length||coverage.extra.length||coverage.duplicates.length||outcomes.some(o=>o.status!==0)||failures.length)process.exitCode=1;
