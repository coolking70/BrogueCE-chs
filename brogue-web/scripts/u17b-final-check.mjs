import fs from 'node:fs';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/u-17b-evidence';
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${d}/${e.name}`):[`${d}/${e.name}`]);
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const inputs=()=>Object.fromEntries([...walk('src'),...walk('public'),...walk('scripts'),...fs.readdirSync('.').filter(p=>/^(package.*json|.*config.*|index.html)$/.test(p))].filter(p=>fs.statSync(p).isFile()).sort().map(p=>[p,sha(p)]));
const save=(name,data)=>fs.writeFileSync(`${out}/${name}.json`,JSON.stringify(data,null,2)+'\n');
const before=inputs();save('frozen-inputs-before',before);
const results=[];
function run(name,cmd,args){
 const started=new Date().toISOString(),fd=fs.openSync(`${out}/${name}.txt`,'w');
 const r=spawnSync(cmd,args,{stdio:['ignore',fd,fd]});fs.closeSync(fd);
 const result={name,command:[cmd,...args],started,ended:new Date().toISOString(),exit:r.status,signal:r.signal};
 results.push(result);save('final-gates',results);console.log(result);
}
run('audit-final',process.execPath,['scripts/u17b-audit.mjs']);
run('build-final','npm',['run','build']);
run('regression-final','npm',['test','--',...fs.readFileSync(`${out}/tests.txt`,'utf8').trim().split('\n'),'--maxWorkers=6','--reporter=default','--reporter=json',`--outputFile.json=${out}/regression-final.json`]);
run('drift-final','npm',['run','test:drift']);
const after=inputs();save('frozen-inputs-after',after);
const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before[p]!==after[p]);
save('frozen-input-differences',changed);
save('baseline-after',Object.fromEntries(walk('src').filter(p=>/baseline.*\.json$/.test(p)).map(p=>[p,sha(p)])));
if(changed.length||results.some(r=>r.exit!==0))process.exitCode=1;
