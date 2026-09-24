import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
const root=process.cwd(),dir=path.join(root,'ai_docs/reports/u-02b-evidence');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'brogue-u02b-negative-'));
const game='src/engine/Core/Game.ts',real=fs.readFileSync(game,'utf8');
const variants=[
 ['no-layer-seed','different actual',s=>s.replace('rng.seedRandomGenerator(level.levelSeed);','// Negative control: missing layer seed.')],
 ['old-player-position','different actual',s=>s.replace('const generationOrigin = this.levelSeeds[depth - 1]!.upStairsLoc;','const generationOrigin = this.player.loc;')],
 ['waypoint-after-return','first layer starts',s=>s.replace('                this.rebuildWaypoints(); // CE: inside the new level stream, before oldSeed.','').replace('rng.seedRandomGenerator(oldSeed);','rng.seedRandomGenerator(oldSeed);\n                this.rebuildWaypoints();')],
];
const results=[];
try{
 fs.cpSync('src',path.join(temp,'src'),{recursive:true});
 for(const f of ['package.json','vite.config.ts'])fs.copyFileSync(f,path.join(temp,f));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(temp,'node_modules'),'dir');
 fs.symlinkSync(path.join(root,'ai_docs'),path.join(temp,'ai_docs'),'dir');
 for(const [name,pattern,mutate]of variants){
  const source=mutate(real);assert.notEqual(source,real);fs.writeFileSync(path.join(temp,game),source);
  const output=path.join(dir,`negative-${name}.json`),fd=fs.openSync(path.join(dir,`negative-${name}.txt`),'w');
  const r=spawnSync(path.join(root,'node_modules/.bin/vitest'),['run','src/test/u_02b_level_rng.test.ts','-t',pattern,'--maxWorkers=1','--reporter=json',`--outputFile=${output}`],{cwd:temp,stdio:['ignore',fd,fd]});fs.closeSync(fd);
  const data=JSON.parse(fs.readFileSync(output));results.push({name,status:r.status,failed:data.numFailedTests,passed:data.numPassedTests,failures:data.testResults.flatMap(r=>r.assertionResults.filter(t=>t.status==='failed').map(t=>t.fullName))});
  assert.equal(r.status,1);assert.ok(data.numFailedTests>0);console.log(JSON.stringify(results.at(-1)));
 }
}finally{fs.writeFileSync(path.join(dir,'negative-summary.json'),JSON.stringify(results,null,2)+'\n');fs.rmSync(temp,{recursive:true,force:true});}
