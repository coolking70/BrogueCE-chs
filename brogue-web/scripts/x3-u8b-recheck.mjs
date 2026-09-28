import fs from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const out='ai_docs/reports/x3-u8b-evidence', list=a=>execFileSync('rg',a,{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const sha=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const original=JSON.parse(fs.readFileSync(`${out}/test-selection.json`));
const pattern='equipItem\\(|executeItemCommand\\(.equip';
const direct=list(['-l','-g','*.test.ts',pattern,'src']);
const tests=[...new Set([...direct,...original.required])].sort();
fs.writeFileSync(`${out}/recheck-selection.json`,JSON.stringify({pattern,direct,required:original.required,tests},null,2)+'\n');
const old=JSON.parse(fs.readFileSync(`${out}/gate-inputs.json`));
const frozen=Object.fromEntries(Object.keys(old).map(f=>[f,sha(f)]));
const delta=Object.keys(old).filter(f=>old[f]!==frozen[f]);
fs.writeFileSync(`${out}/repair-inputs.json`,JSON.stringify({changed:delta,before:Object.fromEntries(delta.map(f=>[f,old[f]])),after:Object.fromEntries(delta.map(f=>[f,frozen[f]]))},null,2)+'\n');
fs.writeFileSync(`${out}/recheck-inputs.json`,JSON.stringify(frozen,null,2)+'\n');
const results=[];
for(const [name,cmd,args] of [
 ['types','npx',['vue-tsc','-b']],
 ['build','npm',['run','build']],
 ['targeted','npx',['vitest','run',...tests,'--maxWorkers=1','--no-file-parallelism','--reporter=default','--reporter=json',`--outputFile.json=${out}/recheck-targeted.json`]],
 ['drift','npm',['run','test:drift','--','--maxWorkers=1','--no-file-parallelism']],
]){
 const start=new Date(),fd=fs.openSync(`${out}/recheck-${name}.txt`,'w');console.log(name,'started',start.toISOString(),name==='targeted'?`${tests.length} files`:'');
 const r=spawnSync(cmd,args,{stdio:['ignore',fd,fd]});fs.closeSync(fd);
 results.push({name,command:[cmd,...args],exit:r.status,signal:r.signal,started:start.toISOString(),seconds:(Date.now()-start.getTime())/1000});
 fs.writeFileSync(`${out}/recheck-results.json`,JSON.stringify(results,null,2)+'\n');console.log(name,'exit',r.status);
}
const changed=Object.entries(frozen).filter(([f,h])=>sha(f)!==h).map(([f])=>f);
fs.writeFileSync(`${out}/recheck-integrity.json`,JSON.stringify({inputs:Object.keys(frozen).length,changed},null,2)+'\n');
if(changed.length||results.some(r=>r.exit!==0))process.exitCode=1;
