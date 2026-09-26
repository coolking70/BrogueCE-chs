import fs from 'node:fs';import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/u-19d-evidence',rows=[];
for(const [variant,test] of [['retire-lever','natural CE18'],['reject-cage-selection','explicit builder'],['reject-cage-final','no observer'],['discard-cage','deferred population'],['no-lever','both complete barrier'],['no-hole','natural CE22'],['no-cage','natural CE28'],['no-paralysis','natural CE67|natural CE68'],['no-statue-wake','natural CE69']]){
 const fd=fs.openSync(`${out}/negative-${variant}.txt`,'w');const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','scripts/u19d-counterfactual.config.ts','src/test/u_19d_machine_families.test.ts','-t',test],{env:{...process.env,U19D_VARIANT:variant},stdio:['ignore',fd,fd]});fs.closeSync(fd);
 const log=fs.readFileSync(`${out}/negative-${variant}.txt`,'utf8'),caught=r.status!==0&&/AssertionError|Error: (CE\d+: no route|walk did not finish)/.test(log);rows.push({variant,test,exit:r.status,behaviorFailure:caught});fs.writeFileSync(`${out}/negative-summary.json`,JSON.stringify(rows,null,2)+'\n');console.log(variant,caught);if(!caught)throw Error(`Not caught: ${variant}`);
}
