import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/x2o-evidence',results=[];
for(const variant of ['ordinary-uniform','summon-uniform','lost-clump','wrong-depth','wrong-remainder']){
 const log=fs.openSync(`${out}/negative-${variant}.txt`,'w');
 const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/x2o_horde_clump.test.ts','--config','scripts/x2o-negative.config.ts','--maxWorkers=1','--reporter=json',`--outputFile=${out}/negative-${variant}.json`],{env:{...process.env,X2O_VARIANT:variant},stdio:['ignore',log,log]});fs.closeSync(log);
 const data=JSON.parse(fs.readFileSync(`${out}/negative-${variant}.json`));
 const failures=data.testResults.flatMap(t=>t.assertionResults.filter(a=>a.status==='failed').map(a=>a.fullName));
 results.push({variant,exit:r.status,failures});assert.equal(r.status,1);assert(failures.length);
}
fs.writeFileSync(`${out}/negatives.json`,JSON.stringify(results,null,2)+'\n');console.log(results);
