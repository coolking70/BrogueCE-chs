import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const out='ai_docs/reports/x4-r2-evidence';
const before=JSON.parse(fs.readFileSync(`${out}/closure-preconditions.json`));
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const changed=Object.keys(before.files).filter(file=>sha(file)!==before.files[file]);
if(JSON.stringify(changed)!==JSON.stringify([before.onlyPlannedChange]))throw Error(`Unexpected post-full-suite changes: ${changed}`);
const focused=JSON.parse(fs.readFileSync(`${out}/closure-u19f.json`));
if(focused.numFailedTests!==0||focused.numPassedTests!==3)throw Error('Full U19f file must pass before closure');
const results=[];
for(const [label,command] of [['typecheck','npx vue-tsc -b'],['build','npm run build']]){
 const log=`${out}/closure-${label}.log`,fd=fs.openSync(log,'w'),start=Date.now();
 const r=spawnSync('cmd.exe',['/d','/s','/c',command],{stdio:['ignore',fd,fd],windowsHide:true});
 fs.closeSync(fd);fs.writeFileSync(log,fs.readFileSync(log,'utf8').replace(/\r\n/g,'\n'));
 results.push({label,command,exit:r.status,seconds:(Date.now()-start)/1000,log});
 console.log(label,r.status);
}
fs.writeFileSync(`${out}/closure-verification.json`,JSON.stringify({changed,afterSha256:sha(changed[0]),
 focusedTest:{file:'closure-u19f.json',command:'node node_modules/vitest/vitest.mjs run src/test/u_19f_machines.test.ts --maxWorkers=1 --reporter=json --outputFile=ai_docs/reports/x4-r2-evidence/closure-u19f.json',passed:focused.numPassedTests,failed:focused.numFailedTests},
 checks:results,fullSuiteRepeatedAfterClosure:false},null,2)+'\n');
process.exitCode=results.some(r=>r.exit!==0)?1:0;
