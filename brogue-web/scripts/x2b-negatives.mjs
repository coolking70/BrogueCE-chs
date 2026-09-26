import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/x2b-evidence';
const cases=[['effective-only','fresh cells'],['skip-gas','fresh cells'],['layer-write','fresh cells'],['home-write','fresh cells'],
 ['snapshot','snapshot restoration'],['room-restore','test-room restore'],['search','search uses'],['force','force respects'],['stagger','stagger checks'],
 ['generation-arcs','generation arc counts'],['flight','flight walks'],['travel','auto travel uses'],['hidden-travel','auto travel does not'],['split','random player teleport']];
const rows=[];
for(const [variant,title]of cases){
 const json=`${out}/negative-${variant}.json`,fd=fs.openSync(`${out}/negative-${variant}.txt`,'w');
 const r=spawnSync('npx',['vitest','run','--config','scripts/x2b-counterfactual.config.ts','src/test/x2b_terrain_derivation.test.ts','-t',title,'--maxWorkers=1','--reporter=json',`--outputFile=${json}`],{env:{...process.env,X2B_VARIANT:variant},stdio:['ignore',fd,fd]});
 fs.closeSync(fd);const results=JSON.parse(fs.readFileSync(json));
 const failures=results.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status==='failed').map(a=>({test:a.fullName,messages:a.failureMessages})));
 rows.push({variant,title,exit:r.status,failures});fs.writeFileSync(`${out}/negatives.json`,JSON.stringify(rows,null,2)+'\n');
 console.log(variant,failures.length?'DETECTED':'MISSED');if(r.status!==1||!failures.length)throw Error(`Invalid negative ${variant}`);
}
