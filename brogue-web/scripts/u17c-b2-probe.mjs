// Preserve every B2 assertion; record the exact level before a failure.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'u17c-b2-')),out=path.resolve('ai_docs/reports/u-17c-evidence');
try{
 fs.cpSync('src',`${temp}/src`,{recursive:true});for(const p of ['package.json','vite.config.ts'])fs.copyFileSync(p,`${temp}/${p}`);fs.symlinkSync(path.resolve('node_modules'),`${temp}/node_modules`,'dir');
 const file=`${temp}/src/test/b2_transcription.test.ts`;let s=fs.readFileSync(file,'utf8');
 s=s.replace('                    for(const machine of observations) {',`                    writeFileSync(${JSON.stringify(out+'/b2-current-level.json')},JSON.stringify({seed,depth,observations,machines:call[3],monsters:game.monsters.map(m=>({name:m.name,loc:m.loc,hp:m.hp,home:m.machineHome})),dormant:game.dormantMonsters.map(m=>({name:m.name,loc:m.loc,home:m.machineHome})),cells:observations.flatMap(m=>m.spawns.map(s=>({pos:s.pos,cell:game.grid.getCell(s.pos.x,s.pos.y)})))},null,2));\n                    for(const machine of observations) {`);
 fs.writeFileSync(file,s);const fd=fs.openSync(`${out}/b2-probe.txt`,'w');const r=spawnSync(process.execPath,[path.resolve('node_modules/vitest/vitest.mjs'),'run','src/test/b2_transcription.test.ts','-t','observes committed CE71','--reporter=default','--reporter=json',`--outputFile.json=${out}/b2-probe.json`],{cwd:temp,env:{...process.env,B2_SCAN_OUTPUT:`${out}/b2-current-scan.json`},stdio:['ignore',fd,fd]});fs.closeSync(fd);console.log({diagnosticExit:r.status});
}finally{fs.rmSync(temp,{recursive:true,force:true});}
