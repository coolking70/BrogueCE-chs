import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const dir='ai_docs/reports/u-04c-evidence';
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const write=(name,v)=>fs.writeFileSync(`${dir}/${name}.json`,JSON.stringify(v,null,2)+'\n');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const initial=JSON.parse(fs.readFileSync(`${dir}/session-input-before.json`));
const allowed=['progress.md','scripts/u03-state-contract.json','src/engine/Core/Game.ts','src/engine/Generator/BlueprintEngine.ts',
 'src/engine/Movement/CreaturePlacement.ts','src/test/u_03_whole_run_snapshot.test.ts','src/test/w_11_teleport_placement.test.ts','src/test/blueprint_center.test.ts','src/test/fixtures/generation_baseline.json'].sort();
const sessionChanged=Object.keys(initial).filter(f=>!fs.existsSync(f)||hash(f)!==initial[f]).sort();
assert.deepEqual(sessionChanged,allowed,'Unexpected modification since U04c started');
const initialSources=Object.keys(initial).filter(f=>f.startsWith('src/')||f.startsWith('scripts/'));
const added=[...walk('src'),...walk('scripts')].filter(f=>!initialSources.includes(f)).sort();
assert.ok(added.every(f=>f==='src/engine/Map/MachineCells.ts'||f==='src/test/u_04c_machine_cells.test.ts'||f.startsWith('scripts/u04c-')));
const protectedTests=Object.keys(initial).filter(f=>f.endsWith('.test.ts')&&!allowed.includes(f));
assert.ok(protectedTests.every(f=>hash(f)===initial[f]));
const baseline='src/test/fixtures/generation_baseline.json',recapture=JSON.parse(fs.readFileSync(`${dir}/recapture.json`));
assert.equal(hash(baseline),recapture.afterSHA256);
assert.equal(hash('src/test/p1_37_machine_flag_i18n.test.ts'),initial['src/test/p1_37_machine_flag_i18n.test.ts']);
write('boundary',{allowed,sessionChanged,added,protectedTestCount:protectedTests.length,allProtectedTestsUnchanged:true,
 p137SHA256:hash('src/test/p1_37_machine_flag_i18n.test.ts'),baselineBefore:recapture.beforeSHA256,baselineAfter:recapture.afterSHA256});
const files=[...new Set([...walk('src'),...walk('public'),...walk('scripts'),...walk('../BrogueCE-master/src'),
 'progress.md','ai_docs/reports/x-0-survey.report.md',...fs.readdirSync('.').filter(f=>/^(package.*json|tsconfig.*json|vite.config.ts|index.html)$/.test(f))])].sort();
const snapshot=()=>Object.fromEntries(files.map(f=>[f,hash(f)]));
const before=snapshot();write('final-input-before',before);
const outcomes=[];
function run(name,cmd,args) {
 const fd=fs.openSync(`${dir}/${name}.txt`,'w'),start=Date.now();
 const result=spawnSync(cmd,args,{stdio:['ignore',fd,fd]});fs.closeSync(fd);
 const row={name,cmd,args,status:result.status,signal:result.signal,durationMs:Date.now()-start};
 outcomes.push(row);write('outcomes',outcomes);console.log(JSON.stringify(row));
}
run('final-scope',process.execPath,['scripts/u04c-test-scope.mjs']);
const closure=JSON.parse(fs.readFileSync(`${dir}/closure.json`)),all=closure.all;
assert.equal(closure.unresolved.length,0);assert.equal(closure.nonliteral.length,0);
run('final-build','npm',['run','build']);
run('final-regression','npx',['vitest','run',...all.filter(f=>!f.endsWith('generation_baseline.test.ts')),
 '--maxWorkers=8','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-tests.json`]);
run('final-drift','npm',['run','test:drift','--','--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-drift.json`]);
const after=snapshot(),changed=files.filter(f=>before[f]!==after[f]);write('final-input-after',after);
const perFile=[],failures=[];
for(const name of ['final-tests','final-drift']) {
 const result=JSON.parse(fs.readFileSync(`${dir}/${name}.json`));
 for(const f of result.testResults) {
  const file=path.relative(process.cwd(),f.name);
  perFile.push({file,status:f.status,passed:f.assertionResults.filter(a=>a.status==='passed').length,
   failed:f.assertionResults.filter(a=>a.status==='failed').length,
   skipped:f.assertionResults.filter(a=>a.status==='pending'||a.status==='skipped').length,
   todo:f.assertionResults.filter(a=>a.status==='todo').length});
  for(const a of f.assertionResults.filter(a=>a.status==='failed'))failures.push({file,title:a.fullName,messages:a.failureMessages});
 }
}
const actual=perFile.map(f=>f.file).sort();
const coverage={expected:all.length,actual:actual.length,missing:all.filter(f=>!actual.includes(f)),extra:actual.filter(f=>!all.includes(f)),duplicates:actual.filter((f,i)=>actual.indexOf(f)!==i)};
write('result-coverage',coverage);write('failures',failures);write('final-files',perFile);
fs.writeFileSync(`${dir}/final-files.md`,'| 文件 | 状态 | 通过 | 失败 | 跳过 | todo |\n|---|---|---:|---:|---:|---:|\n'+perFile.map(f=>`| ${f.file} | ${f.status} | ${f.passed} | ${f.failed} | ${f.skipped} | ${f.todo} |`).join('\n')+'\n');
const result={outcomes,changed,inputCount:files.length,inputManifestSHA256:hash(`${dir}/final-input-after.json`),baselineSHA256:hash(baseline),final:true,
 totals:perFile.reduce((a,f)=>({files:a.files+1,passed:a.passed+f.passed,failed:a.failed+f.failed,skipped:a.skipped+f.skipped,todo:a.todo+f.todo}),{files:0,passed:0,failed:0,skipped:0,todo:0})};
write('final-check',result);console.log(JSON.stringify(result));
if(changed.length||coverage.missing.length||coverage.extra.length||coverage.duplicates.length||outcomes.some(o=>o.status!==0)||failures.length)process.exitCode=1;
