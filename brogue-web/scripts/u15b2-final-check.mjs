import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {spawnSync,execFileSync} from 'node:child_process';
const out='ai_docs/reports/u-15b2-evidence';
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${d}/${e.name}`):[`${d}/${e.name}`]);
const inputs=[...walk('src'),...walk('public'),...walk('scripts'),...fs.readdirSync('.').filter(f=>/^(package.*\.json|.*config.*\.[jt]s|tsconfig.*\.json|index\.html)$/.test(f))].filter(f=>!f.endsWith('.DS_Store')).sort();
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const hash=()=>Object.fromEntries(inputs.map(f=>[f,sha(f)]));
const save=(name,value)=>fs.writeFileSync(`${out}/${name}.json`,JSON.stringify(value,null,2)+'\n');
const traceCapture=JSON.parse(fs.readFileSync(`${out}/trace-recapture.json`));if(sha(traceCapture.file)!==traceCapture.after)throw Error('UR4 trace differs from attributed recapture');
const capture=JSON.parse(fs.readFileSync(`${out}/recapture.json`));if(sha('src/test/fixtures/generation_baseline.json')!==capture.after)throw Error('Baseline differs from one-time capture');
execFileSync(process.execPath,['scripts/u15b2-audit.mjs'],{stdio:'inherit'});
fs.writeFileSync(`${out}/failures-final.ndjson`,'');
const before=hash();save('frozen-inputs-before',before);const gates=[];
for(const [name,cmd,args] of [['build','npm',['run','build']],['regression','npm',['test','--','--maxWorkers=4','--reporter=default','--reporter=json','--reporter=./scripts/u15b2-failure-reporter.mjs',`--outputFile=${out}/regression-final.json`]],['drift','npm',['run','test:drift']],['diff-check','git',['diff','--check']]]){
 const start=new Date().toISOString(),fd=fs.openSync(`${out}/${name}-final.txt`,'w');const r=spawnSync(cmd,args,{stdio:['ignore',fd,fd]});fs.closeSync(fd);gates.push({name,command:[cmd,...args],start,end:new Date().toISOString(),exit:r.status});save('final-gates',gates);console.log(name,r.status);
}
const baselineBefore=JSON.parse(fs.readFileSync(`${out}/baseline-hashes-before.json`));
const baselineAfter=Object.fromEntries(Object.keys(baselineBefore).map(f=>[f,sha(f)]));save('baseline-hashes-after',baselineAfter);
const unexpectedBaselineChanges=Object.keys(baselineBefore).filter(f=>baselineAfter[f] !== (f.endsWith('/generation_baseline.json') ? capture.after : f===traceCapture.file ? traceCapture.after : baselineBefore[f]));
const after=hash();save('frozen-inputs-after',after);const changed=inputs.filter(f=>before[f]!==after[f]);save('frozen-input-differences',changed);
const result=JSON.parse(fs.readFileSync(`${out}/regression-final.json`));const actual=new Set(result.testResults.map(r=>path.relative(process.cwd(),r.name)));const required=fs.readFileSync(`${out}/tests.txt`,'utf8').trim().split('\n');const missing=required.filter(f=>!actual.has(f));save('closure-coverage',{required:required.length,executed:actual.size,missing});
const named=['p1_30','u24','u_01','u_03','u_05','u_15b','b_1b','b_4a','w_5_','w_6_','w_7_','u_r2','u_r4'];const namedCoverage=Object.fromEntries(named.map(n=>[n,[...actual].filter(f=>f.split('/').at(-1).startsWith(n))]));save('named-guard-coverage',namedCoverage);const missingNamed=named.filter(n=>!namedCoverage[n].length);
const deferred=result.testResults.flatMap(r=>r.assertionResults.filter(a=>['pending','todo','skipped'].includes(a.status)).map(a=>({file:path.relative(process.cwd(),r.name),test:a.fullName,status:a.status})));save('existing-deferred-tests',deferred);
fs.writeFileSync(`${out}/final-results.md`,'| Test file | Passed | Failed | Pending/todo |\n|---|---:|---:|---:|\n'+result.testResults.map(r=>`| ${path.relative(process.cwd(),r.name)} | ${r.assertionResults.filter(a=>a.status==='passed').length} | ${r.assertionResults.filter(a=>a.status==='failed').length} | ${r.assertionResults.filter(a=>a.status!=='passed'&&a.status!=='failed').length} |`).join('\n')+'\n');
save('final-summary',{gates,files:result.testResults.length,passed:result.numPassedTests,failed:result.numFailedTests,pending:result.numPendingTests,todo:result.numTodoTests,changedInputs:changed,missing,missingNamed,unexpectedBaselineChanges,baselineBefore:capture.before,baselineAfter:capture.after,traceCapture,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),staged:execFileSync('git',['diff','--cached','--name-only'],{encoding:'utf8'}).trim()});
if(gates.some(g=>g.exit!==0)||changed.length||missing.length||missingNamed.length||unexpectedBaselineChanges.length)process.exitCode=1;
