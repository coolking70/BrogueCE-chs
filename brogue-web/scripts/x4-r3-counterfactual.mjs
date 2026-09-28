/** Wait for the initial complete gates. Revert only this unit's production
 * bytes; original tests and original fixtures are checked before AND after. */
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
const out='ai_docs/reports/x4-r3-evidence', raw='output/x4-r3';
const state=JSON.parse(fs.readFileSync(`${out}/initial-state.json`));
const hash=b=>createHash('sha256').update(b).digest('hex');
assert(!fs.existsSync(`${out}/counterfactual-results.json`),'Do not overwrite the original proof');
assert(JSON.parse(fs.readFileSync(`${out}/initial-gates.json`)).length===4,'Initial full gates must finish');
for(const [f,sha] of Object.entries(state.fixtures)) assert.equal(hash(fs.readFileSync(f)),sha,f);
const initial=JSON.parse(fs.readFileSync(`${raw}/initial-test.json`));
const failures=initial.testResults.flatMap(t=>t.assertionResults.filter(a=>a.status==='failed')
    .map(a=>({file:t.name,name:a.fullName,messages:a.failureMessages})));
fs.writeFileSync(`${out}/initial-failures.json`,JSON.stringify(failures.map(f=>({...f,messages:f.messages.map(m=>m.slice(0,1200))})),null,2)+'\n');
const files=[...new Set(failures.filter(f=>!f.file.includes('x4_r3_')).map(f=>f.file))];
const tests=Object.fromEntries(files.map(f=>[f,hash(fs.readFileSync(f))]));
const final=Object.fromEntries([...state.production,...state.added].map(f=>[f,fs.readFileSync(f)]));
fs.writeFileSync(`${raw}/counterfactual-source-backups.json.gz`,gzipSync(JSON.stringify(
    Object.fromEntries(Object.entries(final).map(([f,bytes])=>[f,bytes.toString('utf8')])))));
const heads=Object.fromEntries(state.production.map(f=>[f,execFileSync('git',['show',`HEAD:brogue-web/${f}`],{maxBuffer:16*1024*1024})]));
const results=[];
function run(label,args,env={}) {
    const log=`${raw}/${label}.log`,fd=fs.openSync(log,'w'),start=Date.now();
    console.log('START',label,new Date().toISOString());
    const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run',...args],{
        stdio:['ignore',fd,fd],windowsHide:true,env:{...process.env,...env}});
    fs.closeSync(fd);fs.writeFileSync(log,fs.readFileSync(log,'utf8').replace(/\r\n/g,'\n'));
    results.push({label,args,exit:r.status,seconds:(Date.now()-start)/1000,log});
    fs.writeFileSync(`${out}/counterfactual-results.json`,JSON.stringify(results,null,2)+'\n');
    console.log('END',label,r.status);
}
try {
    for(const f of state.production) fs.writeFileSync(f,heads[f]);
    for(const f of state.added) fs.renameSync(f,`${f}.x4-r3-held`);
    fs.writeFileSync(`${out}/counterfactual-manifest.json`,JSON.stringify({
        sources:state.production.map(f=>({file:f,head:hash(heads[f]),final:hash(final[f])})),
        added:state.added.map(f=>({file:f,final:hash(final[f])})),tests,fixtures:state.fixtures},null,2)+'\n');
    run('counterfactual-old-tests',[...new Set([...files,'src/test/generation_baseline.test.ts',
        'src/test/u_r2_trace.test.ts','src/test/u_r3_trace.test.ts','src/test/u_r4_trace.test.ts']),'--maxWorkers=8',
        '--reporter=default','--reporter=json',`--outputFile=${raw}/counterfactual-old-tests.json`]);
    run('counterfactual-generation',['--config','scripts/x4-r3-generation.config.ts'],{X4_R3_STAGE:'head'});
} finally {
    for(const f of state.production) fs.writeFileSync(f,final[f]);
    for(const f of state.added) fs.renameSync(`${f}.x4-r3-held`,f);
    for(const f of [...state.production,...state.added]) assert.equal(hash(fs.readFileSync(f)),hash(final[f]),f);
    for(const [f,sha] of Object.entries({...tests,...state.fixtures})) assert.equal(hash(fs.readFileSync(f)),sha,f);
}
run('final-generation',['--config','scripts/x4-r3-generation.config.ts'],{X4_R3_STAGE:'final'});
// The initial diagnostic suite saw an in-flight fix for negated mutation DF
// metadata. Check all original traces again on the frozen production revision.
run('final-original-traces',['src/test/u_r2_trace.test.ts','src/test/u_r3_trace.test.ts','src/test/u_r4_trace.test.ts',
    '--maxWorkers=3','--reporter=default','--reporter=json',`--outputFile=${raw}/final-original-traces.json`]);
process.exitCode=results.some(r=>r.label!=='final-original-traces'&&r.exit!==0)?1:0;
