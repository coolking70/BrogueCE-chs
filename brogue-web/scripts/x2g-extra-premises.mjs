import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {spawnSync,execFileSync} from 'node:child_process';
const root=process.cwd(),out=path.join(root,'ai_docs/reports/x2g-evidence');
const files=['w_4_bolt_reflection.test.ts','u_17a_df_transaction.test.ts','b_2_throwing.test.ts','u_06_monster_damage.test.ts','u_14a_status_gaps.test.ts','u_08_terrain_bolts.test.ts'];
const original=Object.fromEntries(files.map(f=>[f,execFileSync('git',['show',`HEAD:brogue-web/src/test/${f}`],{encoding:'utf8'})]));
const revised={...original};
revised[files[0]]=revised[files[0]].replace('{ isWeaponAttack: true });', '{ isWeaponAttack: true, grid: g.grid });');
revised[files[1]]=revised[files[1]].replace('![84,142,146,192,', '![32,39,41,54,134,136,84,142,146,192,');
revised[files[2]]=revised[files[2]].replace('登记钉子：POTION_DARKNESS 投掷 DF 未齐前不进入生成池','登记钉子：X2g POTION_DARKNESS 投掷 DF 闭环后按 CE 频率入池')
 .replace("expect(ItemLoader.genPotions.find(p => p.id === 'potion_of_darkness')).toBeUndefined();", "expect(ItemLoader.genPotions.find(p => p.id === 'potion_of_darkness')).toMatchObject({ frequency: 7 });");
revised[files[3]]=revised[files[3]].replaceAll('{ isWeaponAttack: true });', '{ isWeaponAttack: true, grid: g.grid });');
revised[files[4]]=revised[files[4]].replace('CE fear source is commented; fear scroll and incomplete darkness throw remain outside the pool','CE fear source stays retired; X2g completed darkness throw returns at CE frequency')
 .replace("expect(ItemLoader.genPotions.find(p=>p.id==='potion_of_darkness')).toBeUndefined();", "expect(ItemLoader.genPotions.find(p=>p.id==='potion_of_darkness')).toMatchObject({frequency:7});");
revised[files[5]]=revised[files[5]].replace('![84,142,146,192,', '![32,39,41,54,134,136,84,142,146,192,');
for(const f of files){fs.writeFileSync(`${out}/original-${f}.txt`,original[f]);fs.writeFileSync(`${out}/repaired-${f}.txt`,revised[f]);}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'x2g-extra-premises-')),project=path.join(tmp,'brogue-web'),results=[];
try{
 fs.mkdirSync(project);fs.symlinkSync(path.join(root,'ai_docs'),path.join(project,'ai_docs'),'dir');fs.symlinkSync(path.join(root,'node_modules'),path.join(project,'node_modules'),'dir');
 fs.symlinkSync(path.resolve(root,'../BrogueCE-master'),path.join(tmp,'BrogueCE-master'),'dir');
 fs.copyFileSync('package.json',path.join(project,'package.json'));
 for(const [label,stage,repaired] of [['s0','s0',false],['review','review',false],['repaired','review',true]]){
  fs.rmSync(path.join(project,'src'),{recursive:true,force:true});fs.cpSync('src',path.join(project,'src'),{recursive:true});
  const sources=JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-${stage}.json.gz`)));
  const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
  for(const p of walk(path.join(project,'src'))){const f=path.relative(project,p);if(!f.startsWith('src/test/')&&/\.(ts|json)$/.test(f)&&!(f in sources))fs.rmSync(p);}
  for(const [f,s] of Object.entries(sources)){fs.mkdirSync(path.dirname(path.join(project,f)),{recursive:true});fs.writeFileSync(path.join(project,f),s);}
  for(const f of files)fs.writeFileSync(path.join(project,'src/test',f),(repaired?revised:original)[f]);
  fs.copyFileSync(`${out}/ce-terrain-additions.json`,path.join(project,'src/test/fixtures/x2g-ce-terrain.json'));
  const json=`${out}/extra-premises-${label}.json`,fd=fs.openSync(`${out}/extra-premises-${label}.txt`,'w');
  const args=['node_modules/vitest/vitest.mjs','run',...files.map(f=>`src/test/${f}`),'-t','never reflects from monster|historical U17a projection|登记钉子|retains accuracy miss|BE_ATTACK on an ASLEEP|CE fear source|new closed terrain set','--maxWorkers=1','--reporter=json',`--outputFile=${json}`];
  const r=spawnSync(process.execPath,args,{cwd:project,stdio:['ignore',fd,fd]});fs.closeSync(fd);
  const v=JSON.parse(fs.readFileSync(json));results.push({label,exit:r.status,passed:v.numPassedTests,failed:v.numFailedTests,tests:v.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status!=='skipped').map(a=>({name:a.fullName,status:a.status,messages:a.failureMessages})))});
  assert.equal(v.numPassedTests,label==='review'?0:9);assert.equal(v.numFailedTests,label==='review'?9:0);
 }
 fs.writeFileSync(`${out}/extra-premises-summary.json`,JSON.stringify(results,null,2)+'\n');
} finally{fs.rmSync(tmp,{recursive:true,force:true});}
