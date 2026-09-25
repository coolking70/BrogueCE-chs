import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const dir=path.resolve('ai_docs/reports/u-04c-evidence'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'u04c-negative-'));
try {
 fs.cpSync('src',path.join(temp,'src'),{recursive:true});
 for(const f of ['package.json','vite.config.ts'])fs.copyFileSync(f,path.join(temp,f));
 fs.mkdirSync(path.join(temp,'node_modules'));
 for(const name of fs.readdirSync('node_modules').filter(n=>!n.startsWith('.')||n==='.bin'))
  fs.symlinkSync(fs.realpathSync(path.join('node_modules',name)),path.join(temp,'node_modules',name));
 const f=path.join(temp,'src/engine/Core/Game.ts'),source=fs.readFileSync(f,'utf8');
 const marker=`        // U04c/K31: CE membership is the final per-cell machine flag, including
        // external features and excluding cleared BP_NO_INTERIOR_FLAG cells.
        this.machineCells = collectMachineCells(this.grid);`;
 assert.equal(source.split(marker).length,2);
 fs.writeFileSync(f,source.replace(marker,`        this.machineCells = new Set();
        for (const mr of machineResults) {
            for (const c of mr.cells) this.machineCells.add(c.y * DCOLS + c.x);
        }`));
 const fd=fs.openSync(`${dir}/negative-source.txt`,'w');
 const args=['vitest','run','src/test/u_04c_machine_cells.test.ts','-t','seed424242 D2|real seed777 external',
  '--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${dir}/negative-source.json`];
 const result=spawnSync('npx',args,{cwd:temp,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 const tests=JSON.parse(fs.readFileSync(`${dir}/negative-source.json`));
 assert.equal(result.status,1);assert.equal(tests.numFailedTests,2);
 const summary={mutation:'Only restore union mr.cells in populateLevel',status:result.status,failedTests:tests.numFailedTests,
  failures:tests.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status==='failed').map(a=>({title:a.fullName,messages:a.failureMessages}))),caught:true};
 fs.writeFileSync(`${dir}/negative-check.json`,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({caught:true,failedTests:2}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
