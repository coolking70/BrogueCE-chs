// Collect every rejected layer tuple using a temporary copy of the old whitelist.
// This is a diagnostic, not a gate. Production and original tests are untouched.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const base=fs.mkdtempSync(path.join(os.tmpdir(),'u19c-layers-')),out=path.resolve('ai_docs/reports/u-19c-evidence');
try{
 fs.cpSync('src',`${base}/src`,{recursive:true});for(const p of ['package.json','vite.config.ts'])fs.copyFileSync(p,`${base}/${p}`);fs.symlinkSync(path.resolve('node_modules'),`${base}/node_modules`,'dir');
 const file=`${base}/src/test/c_4b_dungeon_feature.test.ts`;let s=fs.readFileSync(file,'utf8');
 fs.writeFileSync(`${out}/layers-probe-direct.json`,'[]');
 const start=s.indexOf("    it('F3 留痕");let part=s.slice(start);
 const begin='                        const nonEmpty: number[] = [];';
 const end='                        expect(cell.layers[L.GAS], `seed=${seed} D${depth} (${x},${y}) GAS 恒空`).toBe(C.NOTHING);';
 if(!part.includes(begin)||!part.includes(end))throw Error('Missing diagnostic anchor');
 part=part.replace(begin,'                        try {\n'+begin).replace(end,end+`\n                        } catch (error) { u19cRejected.push({seed,depth,x,y,layers:cell.layers.map(t=>C[t]),machineNumber:cell.machineNumber,error:String(error)}); saveU19c(${JSON.stringify(out+'/layers-probe-direct.json')}, JSON.stringify(u19cRejected,null,2)); }`);
 s="import {writeFileSync as saveU19c} from 'node:fs';\nconst u19cRejected: unknown[]=[];\n"+s.slice(0,start)+part;
 fs.writeFileSync(file,s);const fd=fs.openSync(`${out}/layers-probe.txt`,'w');const r=spawnSync(process.execPath,[path.resolve('node_modules/vitest/vitest.mjs'),'run','src/test/c_4b_dungeon_feature.test.ts','-t','F3 留痕'],{cwd:base,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 const log=fs.readFileSync(`${out}/layers-probe.txt`,'utf8');const rows=JSON.parse(fs.readFileSync(`${out}/layers-probe-direct.json`));fs.writeFileSync(`${out}/layers-probe.json`,JSON.stringify({diagnosticExit:r.status,rows},null,2)+'\n');console.log(r.status,rows);
}finally{fs.rmSync(base,{recursive:true,force:true});}
