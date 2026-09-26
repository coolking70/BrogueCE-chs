import fs from 'node:fs';import {spawn} from 'node:child_process';
const out='ai_docs/reports/u-19f-evidence',rows=JSON.parse(fs.readFileSync(`${out}/restored-rows.json`)),only=process.argv[2];
const cases=[...rows.map(i=>[`auto${i}`,'autogen',`autoGen row ${i} has`]),...['retire52','no-bump','no-spark'].map(v=>[v,'machines','natural CE52:']),...['retire55','old-wall','no-active-tunnel'].map(v=>[v,'machines','natural CE55:']),['old-search','autogen','autoGen row 22 has'],['no-flash','autogen','autoGen row 34 has']].filter(r=>!only||r[0]===only);
const results=only?JSON.parse(fs.readFileSync(`${out}/negative-summary.json`)).filter(r=>r.variant!==only):[];
for(let i=0;i<cases.length;i+=2)await Promise.all(cases.slice(i,i+2).map(async([variant,file,test])=>{
 const fd=fs.openSync(`${out}/negative-${variant}.txt`,'w');
 const status=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','scripts/u19f-counterfactual.config.ts',`src/test/u_19f_${file}.test.ts`,'-t',test,'--reporter=json',`--outputFile=${out}/negative-${variant}.json`],{env:{...process.env,U19F_VARIANT:variant},stdio:['ignore',fd,fd]});p.on('error',reject);p.on('close',resolve);});fs.closeSync(fd);
 const json=JSON.parse(fs.readFileSync(`${out}/negative-${variant}.json`)),failures=json.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status==='failed').map(a=>({test:a.fullName,messages:a.failureMessages})));
 const behaviorFailure=status!==0&&failures.length>0&&failures.every(f=>f.messages.some(m=>/AssertionError|Error: (autoGen|globe stayed dark|CE\d+: no route|.*flash.*color)/i.test(m)));
 results.push({variant,test,exit:status,behaviorFailure,failures});fs.writeFileSync(`${out}/negative-summary.json`,JSON.stringify(results,null,2)+'\n');console.log(variant,behaviorFailure);if(!behaviorFailure)throw Error(`Not caught by behavior: ${variant}`);
}));
