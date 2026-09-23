// Intentional, short-lived mutations: always restore the exact original bytes.
import fs from 'node:fs';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
const dir='ai_docs/reports/w-16-evidence',file='src/engine/Core/Game.ts';const original=fs.readFileSync(file,'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');const results=[];
const cases=[
 ['presentation-only','this.monsters.push(blade);','// intentionally omit entity registration','E=2 creates'],
 ['wrong-first-turn','blade.ticksUntilTurn = blade.attackSpeed + 1;','blade.ticksUntilTurn = blade.moveSpeed;','first wait'],
 ['follows-player','blade.doesNotTrackLeader = true;','blade.doesNotTrackLeader = false;','does not track player'],
 ['false-autoid','autoID = true; // W-2 handoff: only a real entity identifies.','autoID = false; // mutant','E=2 creates'],
];
for(const [name,from,to,test]of cases){if(original.split(from).length!==2)throw Error(`ambiguous mutation ${name}`);
 try{
  fs.writeFileSync(file,original.replace(from,to));const log=fs.openSync(`${dir}/negative-${name}.log`,'w');
  const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/w_16_conjuration.test.ts','-t',test,'--maxWorkers=1','--reporter=json',`--outputFile=${dir}/negative-${name}.json`],{stdio:['ignore',log,log]});fs.closeSync(log);
  const data=JSON.parse(fs.readFileSync(`${dir}/negative-${name}.json`));results.push({name,exit:r.status,failed:data.numFailedTests});
 }finally{fs.writeFileSync(file,original);}
 results.at(-1).restored=hash(fs.readFileSync(file))===hash(original);
}
fs.writeFileSync(`${dir}/negative-summary.json`,JSON.stringify({before:hash(original),after:hash(fs.readFileSync(file)),results},null,2)+'\n');
console.log(results);if(results.some(r=>!r.failed||!r.restored))process.exitCode=1;
