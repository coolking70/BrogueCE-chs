// Independent temporary checkout: demonstrate that the W20 guard must learn the
// new CE value container, and still rejects a shallow clone after that premise fix.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-14a-evidence',tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u14a-negative-'));
const outcomes=[];
try{
 for(const p of ['src','package.json','tsconfig.json','tsconfig.app.json','tsconfig.node.json','vite.config.ts']) if(fs.existsSync(p))fs.cpSync(p,path.join(tmp,p),{recursive:true});
 fs.symlinkSync(path.resolve('node_modules'),path.join(tmp,'node_modules'),'dir');
 const target=path.join(tmp,'src/test/w_20_cloning.test.ts'),current=fs.readFileSync(target,'utf8');
 const run=name=>{const r=spawnSync(process.execPath,[path.resolve('node_modules/vitest/vitest.mjs'),'run','src/test/w_20_cloning.test.ts','-t','audits EVERY','--maxWorkers=1','--reporter=verbose'],{cwd:tmp,encoding:'utf8'});fs.writeFileSync(`${dir}/negative-${name}.txt`,r.stdout+r.stderr);outcomes.push({name,status:r.status});return r;};
 fs.writeFileSync(target,execFileSync('git',['show','HEAD:brogue-web/src/test/w_20_cloning.test.ts'],{encoding:'utf8'}));
 const old=run('old-field-list');assert.equal(old.status,1);assert.match(old.stdout+old.stderr,/AssertionError/);
 fs.writeFileSync(target,current);
 const production=path.join(tmp,'src/entities/Monster.ts'),source=fs.readFileSync(production,'utf8');
 fs.writeFileSync(production,source.replace('clone.maxStatus = { ...this.maxStatus };','clone.maxStatus = this.maxStatus;'));
 const shallow=run('shared-max-status');assert.equal(shallow.status,1);assert.match(shallow.stdout+shallow.stderr,/maxStatus/);
 fs.writeFileSync(production,source);assert.equal(run('final-independent-container').status,0);
 fs.writeFileSync(`${dir}/counterfactual.json`,JSON.stringify(outcomes,null,2)+'\n');console.log(JSON.stringify(outcomes));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
