// Final state only: explicit R+S files, build, independent drift, SHA before/after.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
const dir='ai_docs/reports/w-25-evidence';
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const sha=b=>createHash('sha256').update(b).digest('hex');
const head=f=>execFileSync('git',['show',`HEAD:brogue-web/${f}`]);
const methods=source=>{const tree=ts.createSourceFile('Game.ts',source,99,true),out={};const visit=n=>{if(ts.isMethodDeclaration(n))out[n.name.getText(tree)]=n.getText(tree);ts.forEachChild(n,visit);};visit(tree);return out;};
const old=methods(head('src/engine/Core/Game.ts').toString()),now=methods(fs.readFileSync('src/engine/Core/Game.ts','utf8'));
const changedMethods=Object.keys(now).filter(k=>old[k]!==now[k]);
const production=['src/data/arcana.json','src/engine/Combat/Bolt.ts','src/engine/Combat/BlinkTargeting.ts','src/engine/Core/Game.ts','src/engine/Items/ArcanaRecharge.ts','src/engine/Items/ItemLoader.ts','src/engine/UI/DetailGenerator.ts','src/engine/UI/Appearance.ts','src/components/GameCanvas.vue','src/locales/zh_CN.json'];
const allowedTests=['src/engine/Combat/BoltCatalog.test.ts','src/test/w_5_arcana_instance.test.ts','src/test/w_6_arcana_recharge.test.ts','src/test/w_12_blink_beckoning.test.ts','src/test/w_13_tunneling.test.ts','src/test/w_24_wand_catalog.test.ts','src/test/w_25_staff_catalog.test.ts'];
const changed=[...execFileSync('git',['diff','HEAD','--name-only','--relative','--','src'],{encoding:'utf8'}).trim().split('\n'),...execFileSync('git',['ls-files','--others','--exclude-standard','src'],{encoding:'utf8'}).trim().split('\n')].filter(Boolean);
const unexpected=changed.filter(f=>!production.includes(f)&&!allowedTests.includes(f));
const dataOld=JSON.parse(head('src/data/arcana.json')),dataNew=JSON.parse(fs.readFileSync('src/data/arcana.json'));
const unchangedCategories=Object.keys(dataOld).filter(k=>k!=='staffs').every(k=>JSON.stringify(dataOld[k])===JSON.stringify(dataNew[k]));
const retired=JSON.stringify(dataOld.staffs.find(s=>s.id==='staff_of_light'))===JSON.stringify(dataNew.staffs.find(s=>s.id==='staff_of_light'));
const w26Absent=['staff_of_obstruction','staff_of_discord','staff_of_protection'].every(id=>!dataNew.staffs.some(s=>s.id===id));
const printer=ts.createPrinter({removeComments:true});
const code=s=>printer.printFile(ts.createSourceFile('input.ts',s,99,true));
const effectUnchanged=code(old.zapBoltFromPlayer)===code(now.zapBoltFromPlayer);
const allowedMethods=['getArcanaPreview','confirmArcanaTarget','serializeItem','deserializeItem','toSnapshot','loadSnapshot','zapBoltFromPlayer'];
const baselineHash=sha(fs.readFileSync('src/test/fixtures/generation_baseline.json'));
const boundary={production,changedMethods,changedExistingTests:changed.filter(f=>f.endsWith('.test.ts')),unexpected,unchangedCategories,retired,w26Absent,effectUnchanged,baselineHash};
fs.writeFileSync(`${dir}/boundary.json`,JSON.stringify(boundary,null,2)+'\n');
if(unexpected.length||changedMethods.some(k=>!allowedMethods.includes(k))||!unchangedCategories||!retired||!w26Absent||!effectUnchanged||baselineHash!==JSON.parse(fs.readFileSync(`${dir}/baseline-hashes.json`)).after)throw Error('Scope changed');
execFileSync(process.execPath,['scripts/w25-test-scope.mjs'],{stdio:'inherit'});
const scope=JSON.parse(fs.readFileSync(`${dir}/closure.json`));
const files=scope.all.filter(f=>!f.endsWith('/generation_baseline.test.ts'));
const tracked=execFileSync('git',['ls-files','-z','package.json','package-lock.json','tsconfig*','vite.config.ts'],{encoding:'utf8'}).split('\0').filter(Boolean);
const manifest=()=>[...new Set([...walk('src'),...walk('public'),...walk('scripts'),...walk('../BrogueCE-master/src'),...tracked,'progress.md','ai_docs/tasks/w-25.prompt.md','ai_docs/reports/w-0-survey.report.md',`${dir}/closure.json`,`${dir}/browser-states.json`,`${dir}/drift-attribution.json`,`${dir}/drift-summary-before-recapture.md`])].sort().map(f=>`${sha(fs.readFileSync(f))}  ${f}`).join('\n')+'\n';
const before=manifest();fs.writeFileSync(`${dir}/sha256-before.txt`,before);
const run=(name,bin,args)=>{const start=new Date().toISOString(),log=fs.openSync(`${dir}/final-${name}.log`,'w');console.log(`${start} START ${name}`);
 const r=spawnSync(bin,args,{stdio:['ignore',log,log],env:{...process.env,W25_EVIDENCE:'1'}});fs.closeSync(log);const row={name,bin,args,start,end:new Date().toISOString(),exit:r.status,error:r.error?.message};console.log(`${row.end} END ${name}: ${r.status}`);return row;};
const results=[run('build','npm',['run','build']),run('regression',process.execPath,['node_modules/vitest/vitest.mjs','run',...files,'--maxWorkers=8','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-regression.json`]),run('drift','npm',['run','test:drift','--','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-drift.json`])];
const retries=[];
const batch=JSON.parse(fs.readFileSync(`${dir}/final-regression.json`));
for(const t of batch.testResults.filter(t=>t.status==='failed')){
 const failed=t.assertionResults.filter(a=>a.status==='failed');
 if(!failed.length||!failed.every(a=>a.failureMessages.some(m=>/Test timed out|Hook timed out|Timeout of \d+ms exceeded/i.test(m))))continue;
 const file=path.relative(process.cwd(),t.name),name=`serial-${retries.length+1}`;
 retries.push({file,...run(name,process.execPath,['node_modules/vitest/vitest.mjs','run',file,'--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-${name}.json`])});
}
const after=manifest();fs.writeFileSync(`${dir}/sha256-after.txt`,after);
const perFile=new Map();
for(const name of ['regression','drift',...retries.map(r=>r.name)])for(const t of JSON.parse(fs.readFileSync(`${dir}/final-${name}.json`)).testResults){
 const statuses={};for(const a of t.assertionResults)statuses[a.status]=(statuses[a.status]??0)+1;
 const file=path.relative(process.cwd(),t.name);perFile.set(file,{file,status:t.status,statuses,run:name});
}
const counts={};for(const f of perFile.values())for(const [s,n] of Object.entries(f.statuses))counts[s]=(counts[s]??0)+n;
const finalFiles=[...perFile.values()].sort((a,b)=>a.file.localeCompare(b.file));
fs.writeFileSync(`${dir}/final-files.json`,JSON.stringify({counts,files:finalFiles},null,2)+'\n');
const summary={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),results,retries,counts,fileCount:finalFiles.length,filesHashed:before.trim().split('\n').length,shaBefore:sha(before),shaAfter:sha(after),unchanged:before===after,baselineBefore:JSON.parse(fs.readFileSync(`${dir}/baseline-hashes.json`)).before,baselineAfter:baselineHash};
fs.writeFileSync(`${dir}/final-summary.json`,JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify({...summary,results:results.map(({name,exit})=>({name,exit}))},null,2));
process.exitCode=summary.unchanged&&results.filter(r=>r.name!=='regression').every(r=>r.exit===0)&&finalFiles.every(f=>f.status==='passed')&&finalFiles.length===scope.all.length?0:1;
