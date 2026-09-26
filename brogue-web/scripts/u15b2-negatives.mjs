import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/u-15b2-evidence';
const cases=[['wide-timer','1944 original'],['no-birth','ordinary birth draws'],['no-curse','ordinary birth draws'],['double-birth','same resource fields'],['wrong-order','matches all eight'],['uncapped-e','sums effective E'],['zero-light','sums effective E'],['no-light','refreshes actual Game'],['float-darkness','144 compiled'],['no-reaping','caps by target HP'],['no-hp-cap','caps by target HP'],['after-shield','caps by target HP'],['drain-positive','caps by target HP'],['no-staff-drain','1944 original'],['drain-ready-charm','drains charged/full'],['wisdom-charm','caps by target HP']];
const results=[];
for(const [variant,test] of cases){
 const fd=fs.openSync(`${out}/negative-${variant}.txt`,'w');
 const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','scripts/u15b2-counterfactual.config.ts','src/test/u_15b2_ring_birth.test.ts','-t',test,'--reporter=json',`--outputFile=${out}/negative-${variant}.json`],{env:{...process.env,U15B2_VARIANT:variant},stdio:['ignore',fd,fd]});fs.closeSync(fd);
 const json=JSON.parse(fs.readFileSync(`${out}/negative-${variant}.json`));const failures=json.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status==='failed').map(a=>({test:a.fullName,messages:a.failureMessages})));
 const caught=r.status!==0&&failures.length>0&&failures.every(f=>f.messages.some(m=>m.includes('AssertionError')));
 results.push({variant,test,exit:r.status,caught,failures});fs.writeFileSync(`${out}/negative-summary.json`,JSON.stringify(results,null,2)+'\n');console.log(variant,caught);if(!caught)throw Error(`Not caught: ${variant}`);
}
