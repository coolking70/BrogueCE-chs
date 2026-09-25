// Isolated single defects must fail behavior tests, not only catalog/count assertions.
import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
const cwd=process.cwd(),out=path.join(cwd,'ai_docs/reports/u-17d-evidence'),base=fs.mkdtempSync(path.join(os.tmpdir(),'u17d-negative-'));
const df='src/engine/Map/DungeonFeatureCatalog.ts',game='src/engine/Core/Game.ts';
const change=(s,a,b)=>{if(!s.includes(a))throw Error(`Mutation anchor absent: ${a}`);return s.replace(a,b);};
const cases=[...['SHOW_METHANE_VENT','METHANE_VENT_OPEN','PILOT_LIGHT','DISCOVER_PARALYSIS_VENT','REVEAL_PARALYSIS_VENT_SILENTLY','SHOW_POISON_GAS_VENT','POISON_GAS_VENT_OPEN','SHOW_POISON_GAS_TRAP','SHOW_FLAMETHROWER_TRAP'].map(id=>({name:`missing-${id}`,file:df,edit:s=>{const a=s.indexOf(`[DF.DF_${id}]: {`),b=s.indexOf('\n    },',a);if(a<0)throw Error(id);return s.slice(0,a)+s.slice(a,b).replace(/tile: TerrainType\.\w+/,'tile: null')+s.slice(b);}})),
 {name:'no-ordinary-trap-entry',file:game,edit:s=>change(s,"if (instantTarget || ((cellTerrainFlags(this.grid, x, y) & T_IS_DF_TRAP)\n                && !cell.layers.includes(TerrainType.TRAP) && !cell.layers.includes(TerrainType.PRESSURE_PLATE)))",'if (instantTarget)')},
 {name:'no-vent-search',file:game,edit:s=>s.replaceAll(/ \|\| t === TerrainType\.(MACHINE_METHANE_VENT_HIDDEN|MACHINE_PARALYSIS_VENT_HIDDEN|MACHINE_POISON_GAS_VENT_HIDDEN|GAS_TRAP_POISON_HIDDEN|FLAMETHROWER_HIDDEN)/g,'')},
 ...[14,19,21,27].map(index=>({name:`no-autogen-${index}`,file:'src/engine/Map/AutoGenerator.ts',edit:s=>{const a=s.indexOf(`index: ${index},`),b=s.indexOf('\n    },',a);return s.slice(0,a)+s.slice(a,b).replace("carrier: 'wired'","carrier: 'no-tile'")+s.slice(b);}})),
];const results=[];
try{
 const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${d}/${e.name}`):[`${d}/${e.name}`]);
 fs.writeFileSync(`${out}/negative-inputs.json`,JSON.stringify(Object.fromEntries(walk('src').map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),null,2)+'\n');
 fs.cpSync('src',`${base}/src`,{recursive:true});for(const p of ['package.json','vite.config.ts'])fs.copyFileSync(p,`${base}/${p}`);fs.symlinkSync(path.join(cwd,'node_modules'),`${base}/node_modules`,'dir');
 for(const c of cases){const original=fs.readFileSync(c.file,'utf8');fs.writeFileSync(`${base}/${c.file}`,c.edit(original));
  const fd=fs.openSync(`${out}/negative-${c.name}.txt`,'w');const r=spawnSync(process.execPath,[path.join(cwd,'node_modules/vitest/vitest.mjs'),'run','src/test/u_17d_vents.test.ts','-t','search reveals|180 player|175 actual|183/185|182 actual|real step|autoGen [0-9]+:','--maxWorkers=1','--reporter=json',`--outputFile=${out}/negative-${c.name}.json`],{cwd:base,stdio:['ignore',fd,fd]});fs.closeSync(fd);fs.writeFileSync(`${base}/${c.file}`,original);
  const report=JSON.parse(fs.readFileSync(`${out}/negative-${c.name}.json`));results.push({name:c.name,exit:r.status,failed:report.numFailedTests,titles:report.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status==='failed').map(a=>a.title))});if(r.status===0||report.numFailedTests===0)throw Error(`Surviving defect: ${c.name}`);
 }
}finally{fs.writeFileSync(`${out}/negative-summary.json`,JSON.stringify(results,null,2)+'\n');fs.rmSync(base,{recursive:true,force:true});}
