import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const out = 'ai_docs/reports/x3-u6-evidence';
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const list = (args) => execFileSync('rg', args, {encoding:'utf8'}).trim().split('\n').filter(Boolean);
const references = list(['-l','-g','*.test.ts','logger|Logger|MessageStrip|Sidebar|acknowledge|hidden door|picked up|status\\.player\\.[a-z_]+_off','src/test']);
const required = list(['--files','src/test','-g','*.test.ts']).filter(f => /\/(p1_30|u24|u_27_recording|x2a_recording_checkpoint|x3b_display_recording|x3_u[1-4]|x4a|x4b|fe_1_touch|i_1_interaction|u_r[234]|u_03)/.test(f));
const tests = [...new Set([...references,...required,'src/test/x3_u6_messages.test.ts'])].sort();
fs.writeFileSync(`${out}/test-selection.json`, JSON.stringify({pattern:'logger|Logger|MessageStrip|Sidebar|acknowledge|hidden door|picked up|status.player.*_off',references,required,tests},null,2)+'\n');
const inputFiles = [...list(['--files','src','scripts','-g','*.ts','-g','*.vue','-g','*.json']), 'package.json','package-lock.json'];
const frozen = Object.fromEntries(inputFiles.map(f=>[f,sha(f)]));
fs.writeFileSync(`${out}/gate-inputs.json`,JSON.stringify(frozen,null,2)+'\n');
const results=[];
for(const [name,cmd,args] of [
    ['types','npx',['vue-tsc','-b']],
    ['build','npm',['run','build']],
    ['targeted','npx',['vitest','run',...tests,'--maxWorkers=2']],
    ['drift','npm',['run','test:drift','--','--maxWorkers=1']],
]) {
    const start=new Date(), fd=fs.openSync(`${out}/${name}.txt`,'w');
    console.log(name,'started',start.toISOString());
    const run=spawnSync(cmd,args,{stdio:['ignore',fd,fd]});fs.closeSync(fd);
    results.push({name,command:[cmd,...args],exit:run.status,signal:run.signal,started:start.toISOString(),seconds:(Date.now()-start.getTime())/1000});
    fs.writeFileSync(`${out}/gate-results.json`,JSON.stringify(results,null,2)+'\n');
    console.log(name,'exit',run.status);
}
const changed=Object.entries(frozen).filter(([f,h])=>sha(f)!==h).map(([f])=>f);
fs.writeFileSync(`${out}/gate-integrity.json`,JSON.stringify({inputs:inputFiles.length,changed},null,2)+'\n');
if(changed.length||results.some(r=>r.exit!==0))process.exitCode=1;
