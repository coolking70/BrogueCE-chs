// Final explicit-file gates. Hash every source, fixture, config and verification
// script before/after; reports/logs are outputs and intentionally not self-hashed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const dir='ai_docs/reports/u-02a-evidence';
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const files=[...walk('src'),...walk('public'),...walk('scripts'),...walk('../BrogueCE-master/src'), 'progress.md', 'ai_docs/tasks/u-02a.prompt.md', 'ai_docs/reports/x-0-survey.report.md',...fs.readdirSync('.').filter(f=>/^(package.*json|tsconfig.*json|vite.config.ts|index.html)$/.test(f))].sort();
const snapshot=()=>Object.fromEntries(files.map(f=>[f,hash(f)]));
const before=snapshot();
fs.writeFileSync(`${dir}/final-input-before.json`,JSON.stringify(before,null,2)+'\n');
const all=JSON.parse(fs.readFileSync(`${dir}/closure.json`)).all;
const gates=[
 ['audit','node',['scripts/u02a-audit.mjs']],
 ['guard-counterfactual','node',['scripts/u02a-guard-counterfactual.mjs']],
 ['continuation','node',['scripts/u02a-run-continuation.mjs']],
 ['build','npm',['run','build']],
 ['regression','npx',['vitest','run',...all.filter(f=>!f.endsWith('generation_baseline.test.ts')),'--maxWorkers=8','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-tests.json`]],
 ['drift','npm',['run','test:drift','--','--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-drift.json`]],
];
const outcomes=[];
for(const [name,cmd,args] of gates){
 const fd=fs.openSync(`${dir}/final-${name}.txt`,'w'), start=Date.now();
 const r=spawnSync(cmd,args,{stdio:['ignore',fd,fd]});fs.closeSync(fd);
 outcomes.push({name,cmd,args,status:r.status,signal:r.signal,durationMs:Date.now()-start});
 console.log(JSON.stringify(outcomes.at(-1)));
}
const after=snapshot(), changed=files.filter(f=>before[f]!==after[f]);
fs.writeFileSync(`${dir}/final-input-after.json`,JSON.stringify(after,null,2)+'\n');
fs.writeFileSync(`${dir}/final-check.json`,JSON.stringify({outcomes,changed,inputManifestSha256:hash(`${dir}/final-input-after.json`),final:true},null,2)+'\n');
const perFile=[];
for(const name of ['tests','drift']) {
 const file=`${dir}/final-${name}.json`;
 if(!fs.existsSync(file))continue;
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 for(const result of data.testResults)perFile.push({file:path.relative(process.cwd(),result.name),status:result.status,
  passed:result.assertionResults.filter(a=>a.status==='passed').length,
  failed:result.assertionResults.filter(a=>a.status==='failed').length,
  skipped:result.assertionResults.filter(a=>a.status!=='passed'&&a.status!=='failed').length});
}
fs.writeFileSync(`${dir}/final-files.json`,JSON.stringify(perFile,null,2)+'\n');
fs.writeFileSync(`${dir}/final-files.md`,'| 文件 | 状态 | 通过 | 失败 | 跳过 |\n|---|---|---:|---:|---:|\n'+perFile.map(f=>`| ${f.file} | ${f.status} | ${f.passed} | ${f.failed} | ${f.skipped} |`).join('\n')+'\n');
if(changed.length || outcomes.some(r=>r.status!==0))process.exitCode=1;
