import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const dir='ai_docs/reports/w-15-evidence',hash=s=>createHash('sha256').update(s).digest('hex');
const cases=[
 ['explosion-bypass','src/engine/Core/Game.ts','entity.hp -= entity.absorbShieldDamage(damage);','entity.hp -= damage;'],
 ['poison-absorbed','src/engine/Core/Game.ts','entity.takeDamage(Math.max(1, entity.poisonAmount), true);','entity.takeDamage(Math.max(1, entity.poisonAmount));'],
 ['max-not-reset','src/entities/Creature.ts',"this.setStatusDuration('shielded', next);","this.statusDurations.shielded = next; this.maxShield = Math.max(this.maxShield, next);"],
 ['fraction-floor','src/entities/Creature.ts','return amount - Math.ceil(shield / 10);','return amount - Math.floor(shield / 10);'],
];
const results=[];
for(const [name,file,from,to] of cases){
 const original=fs.readFileSync(file,'utf8');if(!original.includes(from))throw Error(name+' mutation anchor missing');
 let r;try{
  fs.writeFileSync(file,original.replace(from,to));
  r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/w_15_shielding.test.ts','--maxWorkers=1','--reporter=json',`--outputFile=${dir}/negative-${name}.json`],{encoding:'utf8'});
  fs.writeFileSync(`${dir}/negative-${name}.log`,r.stdout+r.stderr);
 }finally{fs.writeFileSync(file,original);}
 const data=JSON.parse(fs.readFileSync(`${dir}/negative-${name}.json`,'utf8'));
 results.push({name,exit:r.status,failed:data.numFailedTests,before:hash(original),after:hash(fs.readFileSync(file))});
 if(r.status!==1||!data.numFailedTests||results.at(-1).before!==results.at(-1).after)throw Error(name+' not caught or restoration mismatch');
}
fs.writeFileSync(`${dir}/negative-summary.json`,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
