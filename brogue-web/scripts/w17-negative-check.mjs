// Targeted adversarial mutations; exact bytes restored in finally, no guard changes.
import fs from 'node:fs';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
const dir='ai_docs/reports/w-17-evidence',game='src/engine/Core/Game.ts',formula='src/engine/Combat/Domination.ts';
const sha=s=>createHash('sha256').update(s).digest('hex'),results=[];
const cases=[
 ['inclusive-boundary',formula,'target.hp * 5 < target.maxHp','target.hp * 5 <= target.maxHp','HP 20/100'],
 ['failure-cures',game,'const success = rng.randPercent(wandDominate(target));',"target.setStatusDuration('discordant', 0); const success = rng.randPercent(wandDominate(target));",'chance 80 percent failure'],
 ['keeps-key',game,'if (monster.carriedItem) {','if (false && monster.carriedItem) {','success frees a captive'],
 ['group-converts',game,'follower.leader = replacement;', 'follower.leader = replacement; follower.isAlly = true;','converting a leader elects'],
 ['lost-save-ally',game,'monster.isAlly = m.allegiance.isAlly === true;','monster.isAlly = false;','active/dormant JSON round trip'],
];
for(const [name,file,from,to,test]of cases){const original=fs.readFileSync(file,'utf8');if(original.split(from).length!==2)throw Error(`ambiguous mutation ${name}`);
 try{fs.writeFileSync(file,original.replace(from,to));const log=fs.openSync(`${dir}/negative-${name}.log`,'w');
  const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/w_17_domination.test.ts','-t',test,'--maxWorkers=1','--reporter=json',`--outputFile=${dir}/negative-${name}.json`],{stdio:['ignore',log,log]});fs.closeSync(log);
  const data=JSON.parse(fs.readFileSync(`${dir}/negative-${name}.json`));results.push({name,file,exit:r.status,failed:data.numFailedTests,before:sha(original)});
 }finally{fs.writeFileSync(file,original);}
 results.at(-1).after=sha(fs.readFileSync(file));results.at(-1).restored=results.at(-1).before===results.at(-1).after;
}
fs.writeFileSync(`${dir}/negative-summary.json`,JSON.stringify(results,null,2)+'\n');console.log(results);if(results.some(r=>!r.failed||!r.restored))process.exitCode=1;
