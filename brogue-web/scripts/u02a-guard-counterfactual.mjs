// Reproduce the two stale zero-after-load premises without touching the working source.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
const root=process.cwd(), dir=path.join(root,'ai_docs/reports/u-02a-evidence');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'brogue-u02a-guards-'));
const tests=['src/test/b_1b_identification_persistence.test.ts','src/test/u_10_absorption_snapshot.test.ts'];
const results=[];
try {
 fs.cpSync('src',path.join(temp,'src'),{recursive:true});
 for(const f of fs.readdirSync(root).filter(f=>/^(package.*json|tsconfig.*json|vite.config.ts|index.html)$/.test(f)))fs.copyFileSync(f,path.join(temp,f));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');
 const game='src/engine/Core/Game.ts',real=fs.readFileSync(game,'utf8');
 const begin=real.indexOf('    public loadSnapshot('),end=real.indexOf('\n    }',begin);
 const body=real.slice(begin,end);
 assert.equal(body.split('rng.setState(snapshot.rngState);').length-1,2);
 const old=body.replace('rng.setState(snapshot.rngState);','rng.seedRandomGenerator(snapshot.seed);')
  .replace('rng.setState(snapshot.rngState);','// Counterfactual: leave old reseeded state.');
 fs.writeFileSync(path.join(temp,game),real.slice(0,begin)+old+real.slice(end));
 for(const f of tests)fs.writeFileSync(path.join(temp,f),execFileSync('git',['show',`HEAD:brogue-web/${f}`]));
 const run=(name,files)=>{
  const fd=fs.openSync(path.join(dir,`${name}.txt`),'w');
  const r=spawnSync(path.join(root,'node_modules/.bin/vitest'),['run',...files,'--maxWorkers=2','--reporter=json',`--outputFile=${path.join(dir,name+'.json')}`],{cwd:temp,stdio:['ignore',fd,fd]});
  fs.closeSync(fd);results.push({name,status:r.status,signal:r.signal});assert.equal(r.status,0,name);
 };
 run('final-guard-old-reseed',tests);
 fs.writeFileSync(path.join(temp,game),real);
 for(const f of tests)fs.copyFileSync(f,path.join(temp,f));
 run('final-guard-corrected-premises',[...tests,'src/test/u_02a_rng_snapshot.test.ts']);
} finally {
 fs.writeFileSync(path.join(dir,'guard-counterfactual.json'),JSON.stringify(results,null,2)+'\n');
 fs.rmSync(temp,{recursive:true,force:true});
}
console.log(JSON.stringify(results));
