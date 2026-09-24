// Final explicit-file gates. Hash every source, fixture, config and verification
// script before/after; reports/logs are outputs and intentionally not self-hashed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const dir='ai_docs/reports/u-13-evidence/adjudication';
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const files=[...walk('src'),...walk('public'),...walk('scripts'),...walk('../BrogueCE-master/src'), 'ai_docs/reports/u-13-evidence/ce-combat.json', 'ai_docs/reports/u-13-evidence/ce-combat.c', 'ai_docs/reports/u-13-evidence/catalog-ranges.json', 'ai_docs/reports/u-13-evidence/closure.json', 'ai_docs/tasks/u-13.prompt.md', 'ai_docs/reports/x-0-survey.report.md',...fs.readdirSync('.').filter(f=>/^(package.*json|tsconfig.*json|vite.config.ts|index.html)$/.test(f)), `${dir}/run-final-gates.mjs`].sort();
const snapshot=()=>Object.fromEntries(files.map(f=>[f,hash(f)]));
const before=snapshot();
fs.writeFileSync(`${dir}/final-input-before.json`,JSON.stringify(before,null,2)+'\n');
const all=JSON.parse(fs.readFileSync('ai_docs/reports/u-13-evidence/closure.json')).all;
const startedAt=new Date().toISOString();
const gates=[
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
 // Run all three authorized gates; record every exit code.
}
const after=snapshot(), changed=files.filter(f=>before[f]!==after[f]);
fs.writeFileSync(`${dir}/final-input-after.json`,JSON.stringify(after,null,2)+'\n');
fs.writeFileSync(`${dir}/final-check.json`,JSON.stringify({startedAt,finishedAt:new Date().toISOString(),outcomes,changed,inputManifestSha256:hash(`${dir}/final-input-after.json`),final:true},null,2)+'\n');
if(changed.length || outcomes.some(r=>r.status!==0))process.exitCode=1;
