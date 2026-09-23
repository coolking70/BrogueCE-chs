import fs from 'node:fs';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
const dir='ai_docs/reports/w-18-evidence',game='src/engine/Core/Game.ts',combat='src/engine/Combat/Combat.ts';
const sha=s=>createHash('sha256').update(s).digest('hex'),results=[];
const cases=[
 ['wrong-direction',game,'monster.moveEntranced(this, -dx, -dy);','monster.moveEntranced(this, dx, dy);','actual player direction'],
 ['wait-follows',game,'this.justRested = true;', 'this.moveEntrancedMonsters(1, 0); this.justRested = true;','wait leaves an adjacent'],
 ['miss-keeps-entrancement',combat,"if (opts?.isWeaponAttack !== false) defender.setStatusDuration('entranced', 0);",'/* mutation: no release on melee */','directional melee even a miss'],
 ['no-landing-effects',game,'this.applyEnvironmentalEffects(target);','/* mutation: omit destination effects */','deep water is legal|follow onto gas|chasm: W11'],
 ['constant-duration',game,"target.setStatusDuration('entranced', staffEntrancementDuration(magnitude));", "target.setStatusDuration('entranced', 6);",'E=3|E=8'],
];
for(const [name,file,from,to,test]of cases){const original=fs.readFileSync(file,'utf8');if(original.split(from).length!==2)throw Error(`ambiguous mutation ${name}`);
 try{fs.writeFileSync(file,original.replace(from,to));const log=fs.openSync(`${dir}/negative-${name}.log`,'w');
  const r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/w_18_entrancement.test.ts','-t',test,'--maxWorkers=1','--reporter=json',`--outputFile=${dir}/negative-${name}.json`],{stdio:['ignore',log,log]});fs.closeSync(log);
  const data=JSON.parse(fs.readFileSync(`${dir}/negative-${name}.json`));results.push({name,file,exit:r.status,failed:data.numFailedTests,before:sha(original)});
 }finally{fs.writeFileSync(file,original);}
 results.at(-1).after=sha(fs.readFileSync(file));results.at(-1).restored=results.at(-1).before===results.at(-1).after;
}
fs.writeFileSync(`${dir}/negative-summary.json`,JSON.stringify(results,null,2)+'\n');console.log(results);if(results.some(r=>!r.failed||!r.restored))process.exitCode=1;
