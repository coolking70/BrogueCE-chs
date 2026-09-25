// Verify the repaired non-vacuity premise still rejects duplicate CE5 prizes.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
const cwd=process.cwd(),out=path.join(cwd,'ai_docs/reports/u-17d-evidence'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'u17d-pedestal-'));
try{
 fs.cpSync('src',`${temp}/src`,{recursive:true});for(const p of ['package.json','vite.config.ts'])fs.copyFileSync(p,`${temp}/${p}`);fs.symlinkSync(path.join(cwd,'node_modules'),`${temp}/node_modules`,'dir');
 const p=`${temp}/src/data/blueprints.json`,rows=JSON.parse(fs.readFileSync(p));for(const f of rows.find(b=>b.ceBlueprintId===5).features)f.flags=f.flags.filter(flag=>flag!=='MF_ALTERNATIVE');fs.writeFileSync(p,JSON.stringify(rows));
 const fd=fs.openSync(`${out}/negative-pedestal.txt`,'w'),r=spawnSync(process.execPath,[path.join(cwd,'node_modules/vitest/vitest.mjs'),'run','src/test/v_2a_vestibule_return.test.ts','-t','T3 基座二选一','--maxWorkers=1','--reporter=json',`--outputFile=${out}/negative-pedestal.json`],{cwd:temp,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 const report=JSON.parse(fs.readFileSync(`${out}/negative-pedestal.json`)),errors=report.testResults.flatMap(f=>f.assertionResults.flatMap(a=>a.failureMessages));
 if(r.status!==1||!errors.some(s=>s.includes('发出 2 件基座大奖')))throw Error('Duplicate-prize defect did not fail the preserved XOR assertion');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
