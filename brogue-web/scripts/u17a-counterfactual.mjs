import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
const cwd=process.cwd(),out=path.join(cwd,'ai_docs/reports/u-17a-evidence');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'u17a-counterfactual-'));
const changed=execFileSync('git',['diff','--name-only'],{encoding:'utf8'}).trim().split('\n').filter(p=>p.startsWith('brogue-web/src/'));
const df='src/engine/Map/DungeonFeature.ts';
const variants=[
 {name:'head-premises',head:true,files:['src/test/c_4c_promotion.test.ts','src/test/f_2c_explosion.test.ts','src/test/u_08_terrain_bolts.test.ts']},
 {name:'head-catalog-premises',head:true,files:['src/test/c_4a_terrain_catalog.test.ts','src/test/c_4b_dungeon_feature.test.ts','src/test/c_7_lighting.test.ts'],test:'目录|glowLight|非零恰|留痕（对抗⑥）'},
 {name:'no-evacuation',from:/evacuateCreatures\(grid, blockingMap, effects\);/g,to:'/* counterfactual */',test:'evacuat'},
 {name:'no-refresh',from:'return refresh && refreshFeatureCell(grid, pos, feat.tile, effects);',to:'return false;',test:'instant fire|generic occupied'},
 {name:'subsequent-loses-refresh',from:/spawnDungeonFeature\(grid, (p.x, p.y|x, y), sub, abortIfBlocking\);/g,to:'spawnDungeonFeature(grid, $1, sub, abortIfBlocking, { refreshSideEffects: true });',test:'EVERY'},
 {name:'no-aggravation',from:'effects.aggravate?.(feat.effectRadius, { x, y });',to:'/* counterfactual */',test:'alarm uses'},
 {name:'message-text-collision',from:'const messageKey = feat.catalogId ?? feat;',to:'const messageKey = feat.description as unknown as DungeonFeature;',test:'message eligibility follows'},
 {name:'retired-grid-leaks',file:'src/engine/Core/Game.ts',from:/setDungeonFeatureEffects\((?:this.grid|level.grid), null\);/g,to:'/* counterfactual: old world port retained */',test:'retired grid'},
 {name:'lethal-continues-gas',file:'src/engine/Core/Game.ts',from:'if (instantTarget && entity.hp <= 0) return;',to:'/* counterfactual: continue after lethal explosion */',test:'lethal player contact'},
 {name:'deferred-death',file:'src/engine/Core/Game.ts',from:'if (creature === this.player && creature.hp <= 0 && !this.isGameOver)',to:'if (false && creature === this.player && creature.hp <= 0 && !this.isGameOver)',test:'lethal player contact'},
 {name:'no-item-fire',file:'src/engine/Core/Game.ts',from:'spawnDungeonFeature(this.grid, pos.x, pos.y, catalogFeature(DF.DF_ITEM_FIRE), false);',to:'/* missing burnItem successor */',test:'instant fire'},
 {name:'no-fire-registration',from:'effects.caughtFire?.(pos);',to:'/* missing cell flag */',test:'direct and descendant fires'},
 {name:'no-blocking-veto',from:'if (!blocking\n',to:'if (true || !blocking\n',test:'blocking veto'},
];
const requested=process.argv.slice(2);
const summary=requested.length?JSON.parse(fs.readFileSync(`${out}/counterfactual-summary.json`,'utf8')).filter(r=>!requested.includes(r.name)):[];
try{
 fs.cpSync('src',`${temp}/src`,{recursive:true});
 for(const file of ['package.json','vite.config.ts','tsconfig.json','tsconfig.app.json','tsconfig.node.json'])fs.copyFileSync(file,`${temp}/${file}`);
 fs.symlinkSync(path.join(cwd,'node_modules'),`${temp}/node_modules`,'dir');
 // Some source guards use the CE sibling path.
 const ce=path.join(temp,'..','BrogueCE-master');if(!fs.existsSync(ce))fs.symlinkSync(path.join(cwd,'../BrogueCE-master'),ce,'dir');
 for(const variant of variants.filter(v=>!requested.length||requested.includes(v.name))){
  for(const file of changed)fs.copyFileSync(path.join(cwd,file.slice(11)),path.join(temp,file.slice(11)));
  if(variant.head)for(const file of changed)fs.writeFileSync(path.join(temp,file.slice(11)),execFileSync('git',['show',`HEAD:${file}`]));
  else{
   const file=path.join(temp,variant.file??df),before=fs.readFileSync(file,'utf8'),after=before.replace(variant.from,variant.to);
   if(before===after)throw Error(`missed mutation ${variant.name}`);fs.writeFileSync(file,after);
  }
  const log=fs.openSync(`${out}/counterfactual-${variant.name}.txt`,'w');
  const args=[path.join(cwd,'node_modules/vitest/vitest.mjs'),'run',...(variant.files??['src/test/u_17a_df_transaction.test.ts']),...(variant.test?['-t',variant.test]:[]),'--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${out}/counterfactual-${variant.name}.json`];
  const run=spawnSync(process.execPath,args,{cwd:temp,stdio:['ignore',log,log]});fs.closeSync(log);
  summary.push({name:variant.name,exit:run.status,expected:variant.head?0:1});
  console.log(summary.at(-1));
 }
 fs.writeFileSync(`${out}/counterfactual-summary.json`,JSON.stringify(summary,null,2));
 if(summary.some(s=>s.exit!==s.expected))process.exitCode=1;
}finally{fs.rmSync(temp,{recursive:true,force:true});}
