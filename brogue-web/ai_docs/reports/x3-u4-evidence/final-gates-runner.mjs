import fs from 'node:fs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/x3-u4-evidence';
const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const inputs={};
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=`${dir}/${e.name}`;if(e.isDirectory())walk(f);else inputs[f]=hash(f);}}
walk('src');for(const f of ['package.json','package-lock.json','vite.config.ts','scripts/u03-state-contract.json'])inputs[f]=hash(f);
fs.writeFileSync(`${out}/final-inputs.json`,JSON.stringify(inputs,null,2)+'\n');
const results=[];
async function run(name,command,args,env={}){
 const started=new Date(),fd=fs.openSync(`${out}/${name}.txt`,'w');console.log(started.toISOString(),name);
 const code=await new Promise((resolve,reject)=>{const p=spawn(command,args,{env:{...process.env,...env},stdio:['ignore',fd,fd]});p.on('error',reject);p.on('exit',resolve);});fs.closeSync(fd);
 results.push({name,command,args,env,started:started.toISOString(),seconds:(Date.now()-started.getTime())/1000,code});
 fs.writeFileSync(`${out}/final-validation.json`,JSON.stringify(results,null,2)+'\n');
 assert.equal(code,0,`${name} failed`);
}
await run('typecheck-final','npx',['vue-tsc','-b']);
await run('build-final','npm',['run','build']);
await run('trace-audit','node',['scripts/x3-u4-trace-audit.mjs']);
const trace='ai_docs/reports/u-r4-trace.json.gz',before=hash(trace);
await run('ur4-capture','npx',['vitest','run','src/test/u_r4_trace.test.ts','--maxWorkers=1'],{UR4_CAPTURE:'1'});
assert.deepEqual(JSON.parse(gunzipSync(fs.readFileSync(trace))),JSON.parse(gunzipSync(fs.readFileSync(`${out}/ur4-current.json.gz`))));
fs.writeFileSync(`${out}/golden-registration.json`,JSON.stringify({method:'UR4_CAPTURE=1 npx vitest run src/test/u_r4_trace.test.ts --maxWorkers=1',before,after:hash(trace),equalsAttributedCandidate:true,ur2:hash('ai_docs/reports/u-r2-trace.json'),ur3:hash('ai_docs/reports/u-r3-trace.json.gz')},null,2)+'\n');
const names=['u_00_new_run','u_03_whole_run_snapshot','x3b_display_recording','p4_3_special_monster_flags','x3_u4_auto_travel','g_3_gas_effects','u_14a_status_gaps','x3_u1_movement_safety','x3_u2_ally_captive','u_27_recording','x2a_recording_checkpoint','x4a_movement_rendering','x4b_flavor_text','w_18_entrancement','u_r2_trace','u_r3_trace','u_r4_trace','p1_30_i18n_gate','u24_hardcoded_text'];
const files=names.map(n=>`src/test/${n}.test.ts`);
fs.writeFileSync(`${out}/followup-scope.txt`,files.join('\n')+'\n');
await run('followup','npx',['vitest','run',...files,'--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${out}/followup-results.json`]);
await run('drift','npm',['run','test:drift','--','--maxWorkers=1']);
const changed=Object.keys(inputs).filter(f=>hash(f)!==inputs[f]);
fs.writeFileSync(`${out}/final-input-check.json`,JSON.stringify({count:Object.keys(inputs).length,changed},null,2)+'\n');
assert.deepEqual(changed,[]);
