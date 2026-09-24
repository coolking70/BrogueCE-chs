// Compare fresh-instance generation against the unmodified input commit, without
// touching/re-capturing any checked-in baseline or changing the working source.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir = 'ai_docs/reports/u-18a-evidence';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brogue-u18a-generation-'));
const originals = ['src/engine/Map/DungeonFeature.ts', 'src/engine/Map/Scent.ts', 'src/engine/Map/SafetyMap.ts', 'src/engine/Map/WaypointMap.ts'];
const source = `
import {Game} from './src/engine/Core/Game';
import {rng} from './src/engine/Random';
import {terrainFingerprint} from './src/test/harness';
const rows=[];
for (const seed of [42,12345,777,999]) {
 const g=new Game();
 const draws=[0,0], original=rng.ranval;
 rng.ranval=function(s){draws[this.rngStates.indexOf(s)]++;return original.call(this,s);};
 g.startNewGame({seed});
 for(let depth=1;depth<=26;depth++) {
  if(depth>1){g.depth=depth;g.generateDepth(false,false);}
  rows.push({seed,depth,terrain:terrainFingerprint(g.grid),rng:JSON.parse(JSON.stringify(rng)),draws:[...draws]});
 }
 rng.ranval=original;
}
console.log(JSON.stringify(rows));`;
const results = {};
try {
 for (const label of ['before','after']) {
  const outfile=path.join(tmp,label+'.cjs');
  await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},outfile,bundle:true,platform:'node',format:'cjs',logLevel:'silent',plugins:label==='before'?[{
   name:'input-commit',setup(b){b.onLoad({filter:/\.ts$/},args=>{
    const rel=path.relative(process.cwd(),args.path);
    if(!originals.includes(rel))return;
    return {contents:execFileSync('git',['show','HEAD:brogue-web/'+rel],{encoding:'utf8'}),loader:'ts'};
   });},
  }]:[]});
  results[label]=JSON.parse(execFileSync(process.execPath,[outfile],{encoding:'utf8',maxBuffer:8e6}));
 }
 assert.deepEqual(results.after,results.before);
 fs.writeFileSync(`${dir}/fresh-generation.json`,JSON.stringify({equal:true,inputCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),rows:results.after},null,2)+'\n');
 console.log('104 layers: fresh generation terrain, both RNG states, substantive count and raw draw counts unchanged.');
} finally { fs.rmSync(tmp,{recursive:true,force:true}); }
