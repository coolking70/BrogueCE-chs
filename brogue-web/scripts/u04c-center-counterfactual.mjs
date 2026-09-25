import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const dir=path.resolve('ai_docs/reports/u-04c-evidence'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'u04c-center-'));
try {
 fs.cpSync('src',path.join(temp,'src'),{recursive:true});
 for(const f of ['package.json','vite.config.ts'])fs.copyFileSync(f,path.join(temp,f));
 fs.mkdirSync(path.join(temp,'node_modules'));
 for(const name of fs.readdirSync('node_modules').filter(n=>!n.startsWith('.')||n==='.bin'))
  fs.symlinkSync(fs.realpathSync(path.join('node_modules',name)),path.join(temp,'node_modules',name));
 const game='src/engine/Core/Game.ts',test='src/test/blueprint_center.test.ts';
 function run(name,source,tests) {
  fs.writeFileSync(path.join(temp,game),source);fs.writeFileSync(path.join(temp,test),tests);
  const fd=fs.openSync(`${dir}/${name}.txt`,'w');
  const result=spawnSync('npx',['vitest','run',test,'-t','c\\) 反转|e\\) ', '--maxWorkers=1',
   '--reporter=default','--reporter=json',`--outputFile.json=${dir}/${name}.json`],{cwd:temp,stdio:['ignore',fd,fd]});
  fs.closeSync(fd);const report=JSON.parse(fs.readFileSync(`${dir}/${name}.json`));
  return {name,status:result.status,passed:report.numPassedTests,failed:report.numFailedTests,
   failures:report.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status==='failed').map(a=>({title:a.fullName,messages:a.failureMessages})))};
 }
 const old=run('center-old-control',fs.readFileSync(`${dir}/before-Game.ts.txt`,'utf8'),fs.readFileSync(`${dir}/before-blueprint_center.test.ts.txt`,'utf8'));
 assert.equal(old.status,0);assert.equal(old.passed,2);console.log('Original assertions pass on original source.');
 const source=fs.readFileSync(game,'utf8'),marker='        // P1-31：进层落位（CE RogueMain.c:817-869';
 assert.equal(source.split(marker).length,2);
 const injected=`        // Adversary: restore undeclared treasure at an unnumbered former center.
        for (const machine of machineResults) {
            const cell = this.grid.getCell(machine.center.x, machine.center.y);
            if (cell?.machineNumber === 0 && cell.isPassable) {
                const treasure = ItemLoader.spawnScroll('scroll_of_enchantment', machine.center.x, machine.center.y);
                if (treasure) this.items.push(treasure);
                break;
            }
        }
`;
 const negative=run('center-direct-negative',source.replace(marker,injected+marker),fs.readFileSync(test,'utf8'));
 assert.equal(negative.status,1);assert.equal(negative.failed,2);console.log('Undeclared direct-center treasure caught by both guards.');
 fs.writeFileSync(`${dir}/center-counterfactual.json`,JSON.stringify({old,negative,caught:true},null,2)+'\n');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
