// Freeze all implementation/test inputs, then run explicit-file final gates.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
const dir='ai_docs/reports/u-10-evidence';
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const files=[...walk('src'),...walk('public'),...walk('scripts'),...walk('../BrogueCE-master/src'),'progress.md',`${dir}/browser.json`,`${dir}/closure.json`,`${dir}/initial-hashes.json`,'ai_docs/tasks/u-10.prompt.md','ai_docs/reports/x-0-survey.report.md',...fs.readdirSync('.').filter(f=>/^(package.*json|tsconfig.*json|vite.config.ts|index.html)$/.test(f))].sort();
const snapshot=()=>Object.fromEntries(files.map(f=>[f,hash(f)]));const before=snapshot();fs.writeFileSync(`${dir}/final-input-before.json`,JSON.stringify(before,null,2)+'\n');
const all=JSON.parse(fs.readFileSync(`${dir}/closure.json`)).all;
const gates=[
 ['boundary','node',['scripts/u10-audit.mjs']],
 ['build','npm',['run','build']],
 ['regression','npx',['vitest','run',...all.filter(f=>!f.endsWith('generation_baseline.test.ts')),'--maxWorkers=8','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-tests.json`]],
 ['drift','npm',['run','test:drift','--','--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-drift.json`]],
];
const outcomes=[];for(const[name,cmd,args]of gates){const fd=fs.openSync(`${dir}/final-${name}.txt`,'w'),start=Date.now();const r=spawnSync(cmd,args,{stdio:['ignore',fd,fd]});fs.closeSync(fd);outcomes.push({name,cmd,args,status:r.status,signal:r.signal,durationMs:Date.now()-start});console.log(JSON.stringify(outcomes.at(-1)));if(r.status!==0&&name!=='regression')break;}
const after=snapshot(),changed=files.filter(f=>before[f]!==after[f]);fs.writeFileSync(`${dir}/final-input-after.json`,JSON.stringify(after,null,2)+'\n');fs.writeFileSync(`${dir}/final-check.json`,JSON.stringify({outcomes,changed,inputCount:files.length,inputManifestSha256:hash(`${dir}/final-input-after.json`),final:changed.length===0&&outcomes.length===gates.length&&outcomes.every(r=>r.status===0)},null,2)+'\n');
const rows=[];for(const file of ['final-tests.json','final-drift.json'])if(fs.existsSync(`${dir}/${file}`)){const j=JSON.parse(fs.readFileSync(`${dir}/${file}`));for(const r of j.testResults){const count=status=>r.assertionResults.filter(a=>a.status===status).length;rows.push(`| ${path.relative(process.cwd(),r.name)} | ${r.status} | ${count('passed')} | ${count('failed')} | ${count('pending')} | ${count('todo')} |`);}}
fs.writeFileSync(`${dir}/final-files.md`,'这是最终状态下的运行结果，不是中途快照。\n\n| 文件 | 结果 | passed | failed | skipped | todo |\n|---|---|---:|---:|---:|---:|\n'+rows.join('\n')+'\n');
if(changed.length||outcomes.some(r=>r.status!==0))process.exitCode=1;
