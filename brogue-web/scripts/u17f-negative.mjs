// Isolated single defects must fail behavior tests, not only catalog/count assertions.
import crypto from 'node:crypto';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';
const cwd=process.cwd(),out=path.join(cwd,'ai_docs/reports/u-17f-evidence'),base=fs.mkdtempSync(path.join(os.tmpdir(),'u17f-negative-'));
const df='src/engine/Map/DungeonFeatureCatalog.ts',game='src/engine/Core/Game.ts';
const change=(s,a,b)=>{if(!s.includes(a))throw Error(`Mutation anchor absent: ${a}`);return s.replace(a,b);};
const behavior='155 pickup|187 player entry|148 player approaches|87 pickup|88 matching key|191 player pulls|RUBBLE autogen|CE69 full blueprint|contact keys';
const cases=[...['WALL_CRACK','CRACKING_STATUE','COFFIN_BURSTS','WORM_TUNNEL_MARKER_ACTIVE','ALTAR_RETRACT','PORTAL_ACTIVATE','GRANITE_CRUMBLES'].map(id=>({name:`missing-${id}`,file:df,edit:s=>{const a=s.indexOf(`[DF.DF_${id}]: {`),b=s.indexOf('\n    },',a);if(a<0)throw Error(id);return s.slice(0,a)+s.slice(a,b).replace(/tile: TerrainType\.\w+/,'tile: null')+s.slice(b);}})),
 {name:'no-allied-horde',file:game,edit:s=>s.replaceAll("h.flags.includes('HORDE_ALLIED_WITH_PLAYER')",'false')},
 {name:'no-contact-key',file:game,edit:s=>change(s,'if (entity.hp > 0) this.useContactKeyAt(entity.loc.x, entity.loc.y);','')},
 {name:'no-rubble-autogen',file:'src/engine/Map/AutoGenerator.ts',edit:s=>change(s,"df: DF.DF_RUBBLE, ceDf: 'DF_RUBBLE'","df: null, ceDf: 'DF_RUBBLE'")},
 {name:'no-wake-transaction',file:game,edit:s=>change(s,'this.awakenDormantMonstersAt(origin, builtCells)','undefined')},
 {name:'no-evacuation-transaction',file:'src/engine/Map/DungeonFeature.ts',edit:s=>s.replaceAll('if (feat.flags & DFF_EVACUATE_CREATURES_FIRST)', 'if (false && feat.flags & DFF_EVACUATE_CREATURES_FIRST)')},
];const results=[];
try{
 const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${d}/${e.name}`):[`${d}/${e.name}`]);
 fs.writeFileSync(`${out}/negative-inputs.json`,JSON.stringify(Object.fromEntries(walk('src').map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),null,2)+'\n');
 fs.cpSync('src',`${base}/src`,{recursive:true});for(const p of ['package.json','vite.config.ts'])fs.copyFileSync(p,`${base}/${p}`);fs.symlinkSync(path.join(cwd,'node_modules'),`${base}/node_modules`,'dir');
 for(const c of cases.filter(c=>!process.argv[2]||c.name===process.argv[2])){const original=fs.readFileSync(c.file,'utf8');fs.writeFileSync(`${base}/${c.file}`,c.edit(original));
  const fd=fs.openSync(`${out}/negative-${c.name}.txt`,'w');const r=spawnSync(process.execPath,[path.join(cwd,'node_modules/vitest/vitest.mjs'),'run','src/test/u_17f_carriers.test.ts','-t',behavior,'--maxWorkers=1','--reporter=json',`--outputFile=${out}/negative-${c.name}.json`],{cwd:base,stdio:['ignore',fd,fd]});fs.closeSync(fd);fs.writeFileSync(`${base}/${c.file}`,original);
  const report=JSON.parse(fs.readFileSync(`${out}/negative-${c.name}.json`));results.push({name:c.name,exit:r.status,failed:report.numFailedTests,titles:report.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status==='failed').map(a=>a.title))});if(r.status===0||report.numFailedTests===0)throw Error(`Surviving defect: ${c.name}`);
 }
}finally{fs.writeFileSync(`${out}/negative-summary${process.argv[2]?"-"+process.argv[2]:""}.json`,JSON.stringify(results,null,2)+'\n');fs.rmSync(base,{recursive:true,force:true});}
