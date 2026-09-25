// Isolated single defects must fail behavior tests, not only catalog/count assertions.
import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
const cwd=process.cwd(),out=path.join(cwd,'ai_docs/reports/u-17e-evidence'),base=fs.mkdtempSync(path.join(os.tmpdir(),'u17e-return-negative-'));
const df='src/engine/Map/DungeonFeatureCatalog.ts',game='src/engine/Core/Game.ts';
const change=(s,a,b)=>{if(!s.includes(a))throw Error(`Mutation anchor absent: ${a}`);return s.replace(a,b);};
const behavior='T11 每层';
const cases=[{name:'invalid-library-return-binding',file:'src/engine/Generator/BlueprintEngine.ts',edit:s=>change(s,'theItem.keyLoc = [...(theItem.keyLoc ?? []), {\n                                loc: { x: pos.x, y: pos.y }','theItem.keyLoc = [...(theItem.keyLoc ?? []), {\n                                loc: { x: 0, y: 0 }')}];const results=[];
try{
 const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${d}/${e.name}`):[`${d}/${e.name}`]);
 fs.writeFileSync(`${out}/return-negative-inputs.json`,JSON.stringify(Object.fromEntries(walk('src').map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),null,2)+'\n');
 fs.cpSync('src',`${base}/src`,{recursive:true});for(const p of ['package.json','vite.config.ts'])fs.copyFileSync(p,`${base}/${p}`);fs.symlinkSync(path.join(cwd,'node_modules'),`${base}/node_modules`,'dir');
 for(const c of cases){const original=fs.readFileSync(c.file,'utf8');fs.writeFileSync(`${base}/${c.file}`,c.edit(original));
  const fd=fs.openSync(`${out}/negative-${c.name}.txt`,'w');const r=spawnSync(process.execPath,[path.join(cwd,'node_modules/vitest/vitest.mjs'),'run','src/test/b_4b_item_placement.test.ts','-t',behavior,'--maxWorkers=1','--reporter=json',`--outputFile=${out}/negative-${c.name}.json`],{cwd:base,stdio:['ignore',fd,fd]});fs.closeSync(fd);fs.writeFileSync(`${base}/${c.file}`,original);
  const report=JSON.parse(fs.readFileSync(`${out}/negative-${c.name}.json`));results.push({name:c.name,exit:r.status,failed:report.numFailedTests,titles:report.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status==='failed').map(a=>a.title))});if(r.status===0||report.numFailedTests===0)throw Error(`Surviving defect: ${c.name}`);
 }
}finally{fs.writeFileSync(`${out}/return-negative-summary.json`,JSON.stringify(results,null,2)+'\n');fs.rmSync(base,{recursive:true,force:true});}
