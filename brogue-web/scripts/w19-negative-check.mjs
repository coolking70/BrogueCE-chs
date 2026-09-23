import fs from 'node:fs';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
const dir='ai_docs/reports/w-19-evidence';const sha=b=>createHash('sha256').update(b).digest('hex');
const cases=[
 ['hp-proportion-only','src/engine/Combat/Polymorph.ts','Math.max(1, Math.trunc(fraction * newMax / 1000), newMax - (oldMax - hp))','Math.max(1, Math.trunc(fraction * newMax / 1000))'],
 ['demote-every-ally','src/entities/Monster.ts','if (this.isAlly) {\n            this.isAlly = false;','if (this.isAlly) {\n            demote();\n            this.isAlly = false;'],
 ['lose-old-haste','src/entities/Monster.ts',"const hasted = this.hasStatus('hasted') || this.hasStatus('haste');",'const hasted = false;'],
 ['change-entity-id','src/entities/Monster.ts','this.typeId = data.id;\n        this.name = ItemLoader.translateName(data.name);','this.id += 100000;\n        this.typeId = data.id;\n        this.name = ItemLoader.translateName(data.name);'],
 ['keep-old-status','src/entities/Monster.ts','this.statusDurations = {};\n        this.maxShield = 0;','this.statusDurations = { ...this.statusDurations };\n        this.maxShield = 0;'],
 ['autoid-old-visibility','src/engine/Core/Game.ts',"autoID = !target.hasStatus('invisible');","autoID = this.canObserveBoltTarget(target);"],
 ['lose-save-form','src/engine/Core/Game.ts','...(m.polymorphed ? { polymorph: {','...(false ? { polymorph: {'],
];
const summary=[];
for(const [name,file,from,to]of cases){
 const before=fs.readFileSync(file);if(!before.toString().includes(from))throw Error(`No mutation target: ${name}`);
 try{fs.writeFileSync(file,before.toString().replace(from,to));const result=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/w_19_polymorph.test.ts','--maxWorkers=1','--reporter=json',`--outputFile=${dir}/negative-${name}.json`],{encoding:'utf8'});fs.writeFileSync(`${dir}/negative-${name}.log`,result.stdout+result.stderr);const r=JSON.parse(fs.readFileSync(`${dir}/negative-${name}.json`));summary.push({name,file,exit:result.status,failed:r.numFailedTests,passed:r.numPassedTests,shaBefore:sha(before)});if(result.status===0||r.numFailedTests===0)throw Error(`Undetected mutation: ${name}`);
 }finally{fs.writeFileSync(file,before);if(summary.at(-1)?.name===name)summary.at(-1).shaAfter=sha(fs.readFileSync(file));}
 console.log(`${name}: ${summary.at(-1).failed} failed, restored`);
}
fs.writeFileSync(`${dir}/negative-summary.json`,JSON.stringify(summary,null,2)+'\n');
