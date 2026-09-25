// User-authorized U03 test corrections. Preserve all original §8 evidence.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
const dir = 'ai_docs/reports/u-03-evidence/adjudication';
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const write = (name, value) => fs.writeFileSync(`${dir}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
const walk = d => fs.readdirSync(d, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(d,e.name)) : [path.join(d,e.name)]);
const allowed = [
 'b_1b_identification_persistence','c_4a_0_layer_model','f_1_fire_as_terrain','p1_37_machine_flag_i18n',
 'u_02b_level_rng','w_13_tunneling','w_24_wand_catalog','w_25_staff_catalog','w_6_arcana_recharge','w_7_arcana_enchantment',
].map(n => `src/test/${n}.test.ts`).sort();
const initial = JSON.parse(fs.readFileSync(`${dir}/session-input-before.json`));
const sessionChanged = Object.keys(initial).filter(f => hash(f) !== initial[f]).sort();
assert.deepEqual(sessionChanged, allowed, 'Only the ten authorized tests may change in this session');
const baseline = 'src/test/fixtures/generation_baseline.json';
const baselineSHA256 = hash(baseline);
assert.equal(baselineSHA256, crypto.createHash('sha256').update(execFileSync('git',['show',`HEAD:brogue-web/${baseline}`])).digest('hex'));
fs.writeFileSync(`${dir}/authorized-tests.patch`,execFileSync('git',['diff','HEAD','--',...allowed]));
const diff = fs.readFileSync(`${dir}/authorized-tests.patch`,'utf8');
assert.ok(!/^\+[^+].*\.(?:skip|todo|only)\s*\(/m.test(diff), 'No new skip/todo/only');
write('boundary', {allowed, sessionChanged, unauthorizedChanges:[], initialFileCount:Object.keys(initial).length,
    productionUnchanged:true, scriptsUnchanged:true, configUnchanged:true, baselineSHA256});
const files = [...new Set([...walk('src'),...walk('public'),...walk('scripts'),...walk('../BrogueCE-master/src'),
 'progress.md','ai_docs/tasks/u-03.prompt.md','ai_docs/reports/x-0-survey.report.md',
 'ai_docs/reports/u-00.report.md','ai_docs/reports/u-01.report.md','ai_docs/reports/u-02a.report.md','ai_docs/reports/u-02b.report.md','ai_docs/reports/u-10.report.md',
 `${dir}/rerun.mjs`,...fs.readdirSync('.').filter(f=>/^(package.*json|tsconfig.*json|vite.config.ts|index.html)$/.test(f))])].sort();
const snapshot = () => Object.fromEntries(files.map(f=>[f,hash(f)]));
const before = snapshot(); write('final-input-before',before);
const outcomes = [];
function run(name,cmd,args,displayArgs=args) {
 const fd=fs.openSync(`${dir}/${name}.txt`,'w'),start=Date.now();
 const r=spawnSync(cmd,args,{stdio:['ignore',fd,fd]});fs.closeSync(fd);
 const result={name,cmd,args:displayArgs,status:r.status,signal:r.signal,durationMs:Date.now()-start};
 outcomes.push(result);write('outcomes',outcomes);console.log(JSON.stringify(result));
}
// The scanner itself is unchanged; redirect only its evidence directory in memory.
const scope=fs.readFileSync('scripts/u03-test-scope.mjs','utf8');
const declaration="const dir = 'ai_docs/reports/u-03-evidence';";
assert.equal(scope.split(declaration).length,2);
run('scope',process.execPath,['--input-type=module','-e',scope.replace(declaration,`const dir = '${dir}';`)],
 ['--input-type=module','-e',`scripts/u03-test-scope.mjs (unchanged scanner; output=${dir})`]);
const all=JSON.parse(fs.readFileSync(`${dir}/closure.json`)).all;
assert.deepEqual(all,JSON.parse(fs.readFileSync('ai_docs/reports/u-03-evidence/closure.json')).all);
run('build','npm',['run','build']);
run('regression','npx',['vitest','run',...all.filter(f=>!f.endsWith('generation_baseline.test.ts')),'--maxWorkers=8',
 '--reporter=default','--reporter=json',`--outputFile.json=${dir}/tests.json`]);
run('drift','npm',['run','test:drift','--','--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${dir}/drift.json`]);
const after=snapshot(),changed=files.filter(f=>before[f]!==after[f]);write('final-input-after',after);
const perFile=[],failures=[];
for(const name of ['tests','drift']) {
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
const result={outcomes,changed,inputCount:files.length,inputManifestSHA256:hash(`${dir}/final-input-after.json`),baselineSHA256,final:true,
 totals:perFile.reduce((a,f)=>({files:a.files+1,passed:a.passed+f.passed,failed:a.failed+f.failed,skipped:a.skipped+f.skipped,todo:a.todo+f.todo}),{files:0,passed:0,failed:0,skipped:0,todo:0})};
write('final-check',result);console.log(JSON.stringify(result));
if(changed.length||coverage.missing.length||coverage.extra.length||coverage.duplicates.length||outcomes.some(o=>o.status!==0)||failures.length)process.exitCode=1;
