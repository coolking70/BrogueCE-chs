import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/x2g-evidence',results=[];
const cases=[['poison','quaff, throw'],['growth','uses CE surface'],['darkness','darkness throw'],['blood','8000 damage'],['puff','zombies emit'],['chance','submerges at 20%'],['visibility','1024 CE'],['bolt','hides identity'],['save','submerges at 20%'],['tint','renders rot tint']];
for(const [variant,title] of cases){
 const json=`${out}/negative-${variant}.json`,fd=fs.openSync(`${out}/negative-${variant}.txt`,'w');
 const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','scripts/x2g-counterfactual.config.ts','src/test/x2g_native_effects.test.ts','-t',title,'--maxWorkers=1','--reporter=json',`--outputFile=${json}`],{env:{...process.env,X2G_VARIANT:variant},stdio:['ignore',fd,fd]});fs.closeSync(fd);
 const report=JSON.parse(fs.readFileSync(json));
 const failures=report.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status==='failed').map(a=>({test:a.fullName,messages:a.failureMessages})));
 results.push({variant,title,exit:r.status,failures});fs.writeFileSync(`${out}/negatives.json`,JSON.stringify(results,null,2)+'\n');
 if(r.status!==1||!failures.length)throw Error('Negative not detected '+variant);
 console.log(variant+': detected');
}
