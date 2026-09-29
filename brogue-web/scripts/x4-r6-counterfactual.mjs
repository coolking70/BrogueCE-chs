/** R6 production-only rollback. Existing tests and all golden fixtures remain
 * byte-identical. Invoke only after the initial full gate process has finished. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const out='ai_docs/reports/x4-r6-evidence',raw='output/x4-r6';
const read=f=>JSON.parse(fs.readFileSync(f));const hash=b=>createHash('sha256').update(b).digest('hex');
const gates=read(`${out}/initial-gates.json`);assert(gates.some(r=>r.label==='drift'),'Wait for the initial full run');
const initial=read(`${raw}/initial-test.json`),drift=read(`${raw}/initial-drift.json`);
const originalStubs=['u_06_monster_damage','u_09_learning_consumers','u_11_corpse_learning','w_10_poison','w_15_shielding','w_4_bolt_reflection','w_8_staff_damage'];
const selected=initial.testResults.filter(t=>!t.name.endsWith('/x4_r6_integration.test.ts')
 && (t.status==='failed'||originalStubs.some(name=>t.name.endsWith(`/${name}.test.ts`))));
const names=selected.flatMap(t=>t.assertionResults.filter(a=>a.status==='failed'||originalStubs.some(n=>t.name.endsWith(`/${n}.test.ts`))).map(a=>a.fullName));
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const changed=execFileSync('git',['diff','--name-only','HEAD','--','src'],{encoding:'utf8'}).trim().split('\n').filter(Boolean).map(f=>f.replace(/^brogue-web\//,''))
 .filter(f=>!f.includes('/test/')&&!/\.(test|spec)\./.test(f));
const added=execFileSync('git',['ls-files','--others','--exclude-standard','--','src'],{encoding:'utf8'}).trim().split('\n').filter(f=>f&&!f.includes('/test/'));
const files=[...new Set([...changed,...added,'scripts/u03-state-contract.json'])];
const final=Object.fromEntries(files.map(f=>[f,fs.readFileSync(f)]));
const head=Object.fromEntries(files.map(f=>{try{return[f,execFileSync('git',['show',`HEAD:brogue-web/${f}`],{maxBuffer:20e6,stdio:['ignore','pipe','ignore']})];}catch{return[f,null];}}));
const untouched=execFileSync('git',['ls-files','src/test','src/**/*.test.ts','ai_docs/reports/u-r2-trace.json','ai_docs/reports/u-r3-trace.json.gz','ai_docs/reports/u-r4-trace.json.gz'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const guardsBefore=Object.fromEntries(untouched.map(f=>[f,hash(fs.readFileSync(f))]));
fs.writeFileSync(`${raw}/counterfactual-source-backups.json`,JSON.stringify(Object.fromEntries(files.map(f=>[f,final[f].toString('utf8')]))));
const manifest={sources:files.filter(f=>head[f]).map(f=>({file:f,head:hash(head[f]),final:hash(final[f])})),added:files.filter(f=>!head[f]).map(f=>({file:f,head:null,final:hash(final[f])}))};
fs.writeFileSync(`${out}/counterfactual-manifest.json`,JSON.stringify(manifest,null,2)+'\n');
const results=[];
function run(label,args,env={}){
 const log=`${raw}/${label}.log`,fd=fs.openSync(log,'w'),start=Date.now();console.log('START',label);
 const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',...args],{stdio:['ignore',fd,fd],env:{...process.env,...env}});fs.closeSync(fd);
 results.push({label,args,exit:r.status,seconds:(Date.now()-start)/1000,log});fs.writeFileSync(`${out}/counterfactual-results.json`,JSON.stringify(results,null,2)+'\n');console.log('END',label,r.status);return r.status;
}
try{
 for(const f of files){if(head[f])fs.writeFileSync(f,head[f]);else fs.unlinkSync(f);}
 const pattern=[...names.map(escape),...drift.testResults.flatMap(t=>t.assertionResults.map(a=>escape(a.fullName)))].join('|');
 run('counterfactual-old-tests',[...new Set([...selected.map(t=>t.name),'src/test/generation_baseline.test.ts']), '--testNamePattern',pattern,'--maxWorkers=2','--reporter=default','--reporter=json',`--outputFile=${raw}/counterfactual-old-tests.json`],{});
 run('counterfactual-generation',['--config','scripts/x4-r6-generation.config.ts','--maxWorkers=1'],{X4_R6_STAGE:'head'});
}catch(e){console.error(e);throw e;}
finally{
 for(const f of files)fs.writeFileSync(f,final[f]);
 for(const f of files)assert.equal(hash(fs.readFileSync(f)),hash(final[f]),f);
 for(const f of untouched)assert.equal(hash(fs.readFileSync(f)),guardsBefore[f],`guard/fixture changed: ${f}`);
}

run('final-generation',['--config','scripts/x4-r6-generation.config.ts','--maxWorkers=1'],{X4_R6_STAGE:'final'});
run('final-original-traces',[...([2,3,4].map(n=>`src/test/u_r${n}_trace.test.ts`)),'--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile=${raw}/final-original-traces.json`]);
