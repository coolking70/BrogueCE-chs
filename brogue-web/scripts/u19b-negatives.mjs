import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/u-19b-evidence',results=[];
for(const name of ['s0','no-vestibule','no-room','no-item-autogen','no-monster-autogen','no-monster-area','no-rollback','no-amulet']){
 const fd=fs.openSync(`${out}/negative-${name}.txt`,'w');
 const r=spawnSync('npm',['exec','vitest','--','run','src/test/u_19b_pending_occupancy.test.ts','--config','scripts/u19b-counterfactual.config.ts','--reporter=json',`--outputFile=${out}/negative-${name}.json`],{env:{...process.env,U19B_VARIANT:name},stdio:['ignore',fd,fd]});fs.closeSync(fd);
 const data=JSON.parse(fs.readFileSync(`${out}/negative-${name}.json`,'utf8'));
 results.push({variant:name,exit:r.status,passed:data.numPassedTests,failed:data.numFailedTests,failures:data.testResults.flatMap(t=>t.assertionResults.filter(a=>a.status==='failed').map(a=>a.fullName))});
 if(r.status===0||!data.numFailedTests)throw Error(`Surviving mutant ${name}`);
 fs.writeFileSync(`${out}/negative-summary.json`,JSON.stringify(results,null,2)+'\n');console.log(results.at(-1));
}
