// Final gates on frozen source. No test expectation, scanner or baseline rewrites.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const dir = 'ai_docs/reports/u-05-evidence';
const walk = d => fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const files = [...new Set([...walk('src'),...walk('public'),...walk('scripts'),...walk('../BrogueCE-master/src'),
    'progress.md','ai_docs/tasks/u-05.prompt.md','ai_docs/reports/u-05-evidence/ce-golden.json','ai_docs/reports/u-05-evidence/historical-null-requests.json','ai_docs/reports/x-0-survey.report.md',
    'ai_docs/reports/u-00.report.md','ai_docs/reports/u-01.report.md','ai_docs/reports/u-02a.report.md','ai_docs/reports/u-02b.report.md','ai_docs/reports/u-10.report.md',
    ...fs.readdirSync('.').filter(f=>/^(package.*json|tsconfig.*json|vite.config.ts|index.html)$/.test(f))])].sort();
const snapshot = () => Object.fromEntries(files.map(f=>[f,hash(f)]));
const before = snapshot(); fs.writeFileSync(`${dir}/final-input-before.json`,JSON.stringify(before,null,2)+'\n');
const outcomes = [];
function run(name,cmd,args) {
    const fd=fs.openSync(`${dir}/final-${name}.txt`,'w'),start=Date.now();
    const r=spawnSync(cmd,args,{stdio:['ignore',fd,fd]});fs.closeSync(fd);
    const result={name,cmd,args,status:r.status,signal:r.signal,durationMs:Date.now()-start};
    outcomes.push(result); console.log(JSON.stringify(result));
}
run('scope','node',['scripts/u05-test-scope.mjs']);
run('generation','node',['scripts/u05-final-generation.mjs']);
run('build','npm',['run','build']);
const all=JSON.parse(fs.readFileSync(`${dir}/closure.json`)).all;
run('regression','npx',['vitest','run',...all.filter(f=>!f.endsWith('generation_baseline.test.ts')),'--maxWorkers=6',
    '--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-tests.json`]);
run('drift','npm',['run','test:drift','--','--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-drift.json`]);
const after=snapshot(),changed=files.filter(f=>before[f]!==after[f]);
fs.writeFileSync(`${dir}/final-input-after.json`,JSON.stringify(after,null,2)+'\n');
const perFile=[],failures=[];
for(const name of ['tests','drift']) {
    const result=JSON.parse(fs.readFileSync(`${dir}/final-${name}.json`));
    for(const f of result.testResults) {
        const file=path.relative(process.cwd(),f.name);
        perFile.push({file,status:f.status,passed:f.assertionResults.filter(a=>a.status==='passed').length,
            failed:f.assertionResults.filter(a=>a.status==='failed').length,skipped:f.assertionResults.filter(a=>a.status!=='passed'&&a.status!=='failed').length});
        for(const a of f.assertionResults.filter(a=>a.status==='failed'))failures.push({file,title:a.fullName,messages:a.failureMessages});
    }
}
const actual=perFile.map(f=>f.file).sort();
const coverage={expected:all.length,actual:actual.length,missing:all.filter(f=>!actual.includes(f)),extra:actual.filter(f=>!all.includes(f)),duplicates:actual.filter((f,i)=>actual.indexOf(f)!==i)};
fs.writeFileSync(`${dir}/result-coverage.json`,JSON.stringify(coverage,null,2)+'\n');
fs.writeFileSync(`${dir}/failures.json`,JSON.stringify(failures,null,2)+'\n');
fs.writeFileSync(`${dir}/final-files.json`,JSON.stringify(perFile,null,2)+'\n');
fs.writeFileSync(`${dir}/final-files.md`,'| 文件 | 状态 | 通过 | 失败 | 跳过 |\n|---|---|---:|---:|---:|\n'+perFile.map(f=>`| ${f.file} | ${f.status} | ${f.passed} | ${f.failed} | ${f.skipped} |`).join('\n')+'\n');
const result={outcomes,changed,inputCount:files.length,inputManifestSHA256:hash(`${dir}/final-input-after.json`),final:true,
    totals:perFile.reduce((a,f)=>({files:a.files+1,passed:a.passed+f.passed,failed:a.failed+f.failed,skipped:a.skipped+f.skipped}),{files:0,passed:0,failed:0,skipped:0})};
fs.writeFileSync(`${dir}/final-check.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.totals));
if(changed.length || coverage.missing.length || coverage.extra.length || coverage.duplicates.length || outcomes.some(o=>o.status!==0))process.exitCode=1;
