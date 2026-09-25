// Isolated single defects must fail behavior tests, not only catalog/count assertions.
import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
const cwd=process.cwd(),out=path.join(cwd,'ai_docs/reports/u-17e-evidence'),base=fs.mkdtempSync(path.join(os.tmpdir(),'u17e-negative-'));
const df='src/engine/Map/DungeonFeatureCatalog.ts',game='src/engine/Core/Game.ts';
const change=(s,a,b)=>{if(!s.includes(a))throw Error(`Mutation anchor absent: ${a}`);return s.replace(a,b);};
const behavior='85 pickup|140 two drops|141 CE6 blueprint|143 repeated|145 pressure|CE1/2 natural|CE6 full blueprint|CE7 full blueprint';
const cases=[...['ITEM_CAGE_CLOSE','ALTAR_COMMUTE','MAGIC_PIPING','ALTAR_RESURRECT','SACRIFICE_ALTAR','ITEM_CAGE_OPEN','INERT_PIPE','SACRIFICE_COMPLETE'].map(id=>({name:`missing-${id}`,file:df,edit:s=>{const a=s.indexOf(`[DF.DF_${id}]: {`),b=s.indexOf('\n    },',a);if(a<0)throw Error(id);return s.slice(0,a)+s.slice(a,b).replace(/tile: TerrainType\.\w+/,'tile: null')+s.slice(b);}})),
 {name:'no-commutation-consumer',file:game,edit:s=>change(s,'        this.commuteFloorItems();','')},
 {name:'no-sacrifice-mark',file:game,edit:s=>change(s,"leaderMon.markedForSacrifice = h.flags.includes('HORDE_SACRIFICE_TARGET');",'leaderMon.markedForSacrifice = false;')},
 {name:'no-sacrifice-entry',file:game,edit:s=>change(s,'if (entity instanceof Monster && entity.markedForSacrifice','if (false && entity instanceof Monster && entity.markedForSacrifice')},
 ...[6,7].map(id=>({name:`no-CE${id}-DF-start`,file:'src/data/blueprints.json',edit:s=>{const rows=JSON.parse(s);for(const f of rows.find(b=>b.ceBlueprintId===id).features)delete f.featureDF;return JSON.stringify(rows);}})),
 {name:'no-library-key-flags',file:'src/data/blueprints.json',edit:s=>{const rows=JSON.parse(s);for(const b of rows.filter(b=>[1,2,26].includes(b.ceBlueprintId)))for(const f of b.features)delete f.itemFlags;return JSON.stringify(rows);}},
];const results=[];
try{
 const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${d}/${e.name}`):[`${d}/${e.name}`]);
 fs.writeFileSync(`${out}/negative-inputs.json`,JSON.stringify(Object.fromEntries(walk('src').map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),null,2)+'\n');
 fs.cpSync('src',`${base}/src`,{recursive:true});for(const p of ['package.json','vite.config.ts'])fs.copyFileSync(p,`${base}/${p}`);fs.symlinkSync(path.join(cwd,'node_modules'),`${base}/node_modules`,'dir');
 for(const c of cases){const original=fs.readFileSync(c.file,'utf8');fs.writeFileSync(`${base}/${c.file}`,c.edit(original));
  const fd=fs.openSync(`${out}/negative-${c.name}.txt`,'w');const r=spawnSync(process.execPath,[path.join(cwd,'node_modules/vitest/vitest.mjs'),'run','src/test/u_17e_altars.test.ts','-t',behavior,'--maxWorkers=1','--reporter=json',`--outputFile=${out}/negative-${c.name}.json`],{cwd:base,stdio:['ignore',fd,fd]});fs.closeSync(fd);fs.writeFileSync(`${base}/${c.file}`,original);
  const report=JSON.parse(fs.readFileSync(`${out}/negative-${c.name}.json`));results.push({name:c.name,exit:r.status,failed:report.numFailedTests,titles:report.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status==='failed').map(a=>a.title))});if(r.status===0||report.numFailedTests===0)throw Error(`Surviving defect: ${c.name}`);
 }
}finally{fs.writeFileSync(`${out}/negative-summary.json`,JSON.stringify(results,null,2)+'\n');fs.rmSync(base,{recursive:true,force:true});}
