// Preserve the untouched historical guards; run HEAD in an isolated temporary checkout.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const dir=path.resolve('ai_docs/reports/u-14b-evidence');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'u14b-head-'));
try {
 const archive=execFileSync('git',['archive','HEAD','brogue-web/src','brogue-web/package.json','brogue-web/vite.config.ts','brogue-web/tsconfig.json','brogue-web/tsconfig.app.json','brogue-web/tsconfig.node.json','brogue-web/ai_docs/reports/w-18-evidence'],{cwd:'..',maxBuffer:30e6});
 execFileSync('tar',['-x','-C',temp],{input:archive});
 const project=path.join(temp,'brogue-web');fs.symlinkSync(path.resolve('node_modules'),path.join(project,'node_modules'));
 const fd=fs.openSync(`${dir}/counterfactual-head.txt`,'w');
 const r=spawnSync('npx',['vitest','run','src/test/u_08_terrain_bolts.test.ts','src/test/w_18_entrancement.test.ts','src/test/ui_1_rendering.test.ts','--maxWorkers=4','--reporter=json',`--outputFile=${dir}/counterfactual-head.json`],{cwd:project,stdio:['ignore',fd,fd]});fs.closeSync(fd);
 fs.writeFileSync(`${dir}/counterfactual.json`,JSON.stringify({kind:'unchanged original guards + original HEAD implementation',head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:r.status},null,2)+'\n');assert.equal(r.status,0);
}finally{fs.rmSync(temp,{recursive:true,force:true});}
