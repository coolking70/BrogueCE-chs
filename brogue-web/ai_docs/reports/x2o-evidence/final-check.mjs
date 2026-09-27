import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const out='ai_docs/reports/x2o-evidence';
const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const summaries=Object.fromEntries(['build','full','drift','deep'].map(k=>[k,read(`${out}/${k}-final-summary.json`)]));
for(const s of Object.values(summaries)){assert.equal(s.exit,0);assert.deepEqual(s.changedInputs,[]);assert.deepEqual(s.changedDiscovery,[]);}
const freeze=read(`${out}/build-final-inputs.json`),discovery=read(`${out}/build-final-discovery.json`);
for(const k of ['full','drift','deep']){assert.deepEqual(read(`${out}/${k}-final-inputs.json`),freeze);assert.deepEqual(read(`${out}/${k}-final-discovery.json`),discovery);}
const changedFrozen=Object.entries(freeze).filter(([f,h])=>hash(f)!==h).map(([f])=>f);assert.deepEqual(changedFrozen,[]);
const full=read(`${out}/full-final.json`),drift=read(`${out}/drift-final.json`),deep=read(`${out}/deep-final.json`);
const tested=[...full.testResults,...drift.testResults];
const passed=new Set(tested.filter(t=>t.status==='passed').map(t=>path.relative(process.cwd(),t.name)));
const closure=read(`${out}/closure.json`);
const missing=closure.union.filter(f=>!passed.has(f));assert.deepEqual(missing,[]);
const discoveredMiss=discovery.filter(f=>!passed.has(path.relative(process.cwd(),path.resolve(f))));assert.deepEqual(discoveredMiss,[]);
const before=read(`${out}/baseline-before.json`),records=read(`${out}/recapture.json`).records;
const protectedChanges=[];
for(const [f,h]of Object.entries(before)){const after=hash(f);if(after!==h)protectedChanges.push(f);const record=records.find(r=>r.file===f);assert.equal(after,record?record.after:h);}
assert.deepEqual(protectedChanges,['src/test/fixtures/deep_generation_baseline.json']);
const ce=read('src/test/fixtures/x2o-ce-catalog.json');for(const [f,h]of Object.entries(ce.sources))assert.equal(hash('../'+f),h);
const files=execFileSync('git',['ls-files','-m','-o','--exclude-standard'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const crlf=files.filter(f=>fs.existsSync(f)&&!f.endsWith('.gz')&&!f.endsWith('.png')&&fs.readFileSync(f).includes(Buffer.from('\r\n')));assert.deepEqual(crlf,[]);
execFileSync('git',['diff','--check']);
const result={time:new Date().toISOString(),summaries,inputs:Object.keys(freeze).length,changedFrozen,discovered:discovery.length,uniquePassedFiles:passed.size,R:closure.R.length,union:closure.union.length,named:closure.S.required.length,sourceReaders:closure.S.sourceReaders.length,missing,discoveredMiss,protectedChanges,ceSourcesMatch:true,crlf,full:{files:full.testResults.length,passed:full.numPassedTests,failed:full.numFailedTests,pending:full.numPendingTests,todo:full.numTodoTests},drift:drift.numPassedTests,deep:deep.numPassedTests};
fs.writeFileSync(`${out}/final-checks.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
