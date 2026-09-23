// Deliberately break one semantic boundary at a time; always restore exact bytes.
import fs from 'node:fs';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
const dir='ai_docs/reports/w-21-evidence',sha=b=>createHash('sha256').update(b).digest('hex');
const cases=[
 ['percentage-hp','src/entities/Monster.ts','this.maxHp += 12;','this.maxHp = Math.floor(this.maxHp * 1.3);','matches 540'],
 ['rounded-damage','src/entities/Monster.ts','Math.trunc(min / 10)','Math.round(min / 10)','matches 540'],
 ['clear-all-statuses','src/entities/Creature.ts','if (panacea) {','if (panacea) { this.statusDurations = {};','matches compiled CE'],
 ['weak-one-cleared','src/entities/Creature.ts',"this.getStatusDuration('weakened') > 1","this.getStatusDuration('weakened') > 0",'matches compiled CE'],
 ['lost-count-save','src/engine/Core/Game.ts','monster.newPowerCount = m.newPowerCount ?? 0;','monster.newPowerCount = 0;','JSON saves'],
 ['polymorph-clears-count','src/entities/Monster.ts','this.polymorphed = true;','this.polymorphed = true; this.newPowerCount = this.totalPowerCount = 0;','actual polymorph'],
 ['invisible-autoid','src/engine/Core/Game.ts','if (target instanceof Monster && target.empower()) {\n                    autoID = this.canObserveBoltTarget(target);','if (target instanceof Monster && target.empower()) {\n                    autoID = true;','autoID observes'],
];
const results=[];
for(const [name,file,from,to,test] of cases){const original=fs.readFileSync(file);if(!original.toString().includes(from))throw Error(name+' replacement missing');let r;
 try{fs.writeFileSync(file,original.toString().replaceAll(from,to));r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/w_21_empowerment.test.ts','-t',test,'--maxWorkers=1'],{encoding:'utf8'});fs.writeFileSync(`${dir}/negative-${name}.log`,r.stdout+r.stderr);}
 finally{fs.writeFileSync(file,original);}
 const restored=sha(fs.readFileSync(file))===sha(original),detected=r.status!==0&&/AssertionError/.test(r.stdout+r.stderr);results.push({name,file,test,exit:r.status,detected,restored,sha:sha(original)});if(!detected||!restored)throw Error(JSON.stringify(results.at(-1)));
}
fs.writeFileSync(`${dir}/negative-summary.json`,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results.map(({name,detected,restored})=>({name,detected,restored}))));
