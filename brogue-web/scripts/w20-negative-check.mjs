// Deliberately break one semantic boundary at a time; always restore exact bytes.
import fs from 'node:fs';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
const dir='ai_docs/reports/w-20-evidence',sha=b=>createHash('sha256').update(b).digest('hex');
const cases=[
 ['shared-status','src/entities/Monster.ts','clone.statusDurations = { ...this.statusDurations };','clone.statusDurations = this.statusDurations;','reverse mutation of clone.statusDurations'],
 ['shared-set','src/entities/Monster.ts','clone.abilityFlags = new Set(this.abilityFlags);','clone.abilityFlags = this.abilityFlags;','reverse mutation of clone.abilityFlags'],
 ['duplicate-id','src/entities/Monster.ts','clone.id = allocateEntityId();','clone.id = this.id;','audits EVERY'],
 ['copied-item','src/entities/Monster.ts','clone.carriedItem = null;','clone.carriedItem = this.carriedItem;','clone death triggers ordinary'],
 ['floor-hp','src/engine/Core/Game.ts','target.hp = Math.floor((target.hp + 1) / 2);','target.hp = Math.floor(target.hp / 2);','current HP'],
 ['clone-count-cap','src/engine/Core/Game.ts','const clone = this.cloneMonster(target);',"const clone = target instanceof Monster && this.alliedCloneCount(target) >= 100 ? null : this.cloneMonster(target);",'plenty has no 100'],
];
const results=[];
for(const [name,file,from,to,test] of cases){const original=fs.readFileSync(file);if(!original.toString().includes(from))throw Error(name+' replacement missing');let r;
 try{fs.writeFileSync(file,original.toString().replace(from,to));r=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/w_20_cloning.test.ts','-t',test,'--maxWorkers=1'],{encoding:'utf8'});fs.writeFileSync(`${dir}/negative-${name}.log`,r.stdout+r.stderr);}
 finally{fs.writeFileSync(file,original);}
 const restored=sha(fs.readFileSync(file))===sha(original),detected=r.status!==0&&/AssertionError/.test(r.stdout+r.stderr);results.push({name,file,test,exit:r.status,detected,restored,sha:sha(original)});if(!detected||!restored)throw Error(JSON.stringify(results.at(-1)));
}
fs.writeFileSync(`${dir}/negative-summary.json`,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results.map(({name,detected,restored})=>({name,detected,restored}))));
