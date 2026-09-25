import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
const dir='ai_docs/reports/u-18a-2-evidence',fixture='src/test/fixtures/generation_baseline.json';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function run(name,cmd,args){
 const fd=fs.openSync(`${dir}/${name}.txt`,'w');const result=spawnSync(cmd,args,{stdio:['ignore',fd,fd]});fs.closeSync(fd);
 console.log(name,result.status);assert.equal(result.status,0,`${name} failed`);
}
// Recapture is authorized only after the full existing guard set and independent guards pass.
for(const report of ['regression-prefinal','unit-final'])assert.equal(read(`${dir}/${report}.json`).success,true,report);
const cf=read(`${dir}/counterfactual.json`);assert.equal(cf.length,6);assert.ok(cf.every(r=>r.reversedPatchReproducesPrevious&&r.caught>0));
const baseline=read(`${dir}/baseline-before.json`);
const final=JSON.parse(gunzipSync(fs.readFileSync(`${dir}/s4c/generation.json.gz`)));
const levels=Object.fromEntries(baseline.seeds.map(seed=>[seed,final.filter(r=>r.seed===seed).map(({fp,n,species,items})=>({fp,n,species,items}))]));
assert.deepEqual(levels,baseline.levels);
const beforeSHA256=hash(fixture);assert.equal(beforeSHA256,hash(`${dir}/baseline-before.json`));
fs.writeFileSync(fixture,JSON.stringify({...baseline,note:'U18a-2 steps 1–4: all-layer entry PB/DL, CE diagonal obstruction and discovery-aware item placement. One recapture after staged drift, reverse-patch attribution and guards; fp/n/species/items unchanged. Extended RNG/GAS drift: ai_docs/reports/u-18a-2.report.md',levels},null,2)+'\n');
fs.writeFileSync(`${dir}/recapture.json`,JSON.stringify({beforeSHA256,afterSHA256:hash(fixture),valuesUnchanged:true,metadataOnly:true,recaptureCount:1,guardReports:['regression-prefinal','unit-final'],counterfactuals:cf.length},null,2)+'\n');
run('audit-final','node',['scripts/u18a2-audit.mjs']);
const frozen=read(`${dir}/final-input-sha256.json`);
run('build-final','npm',['run','build']);
const tests=fs.readFileSync(`${dir}/tests.txt`,'utf8').trim().split('\n');
run('regression-final','npx',['vitest','run',...tests,'--maxWorkers=8','--reporter=default','--reporter=json',`--outputFile.json=${dir}/regression-final.json`]);
run('drift-final','npm',['run','test:drift']);
const changed=Object.keys(frozen).filter(p=>hash(p)!==frozen[p]);assert.deepEqual(changed,[]);
const existing=execFileSync('git',['ls-files','src/test','src/data','src/engine'],{encoding:'utf8'}).trim().split('\n').filter(p=>p.endsWith('.test.ts')||p.includes('/fixtures/'));
const modified=[];
for(const p of existing){if(p===fixture)continue;const old=execFileSync('git',['show',`HEAD:brogue-web/${p}`]);if(!old.equals(fs.readFileSync(p)))modified.push(p);}
assert.deepEqual(modified,[]);execFileSync('git',['diff','--check']);
const r=read(`${dir}/regression-final.json`);assert.equal(r.success,true);
fs.writeFileSync(`${dir}/final-audit.json`,JSON.stringify({frozenInputs:Object.keys(frozen).length,changed,existingTestsAndFixtures:existing.length-1,modified,baselineSHA256:hash(fixture),tests:r.numPassedTests,pending:r.numPendingTests,todo:r.numTodoTests,failed:r.numFailedTests,diffCheck:true},null,2)+'\n');
fs.writeFileSync(`${dir}/final-results.md`,'| File | Passed | Pending/todo | Failed |\n|---|---:|---:|---:|\n'+r.testResults.map(f=>`| ${f.name.split('/brogue-web/').pop()} | ${f.assertionResults.filter(t=>t.status==='passed').length} | ${f.assertionResults.filter(t=>['pending','todo'].includes(t.status)).length} | ${f.assertionResults.filter(t=>t.status==='failed').length} |`).join('\n')+'\n');
console.log('Final frozen gates passed.');
