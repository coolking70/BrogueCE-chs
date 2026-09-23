// Final immutable-source run: explicit R+S file list, build, and independent drift.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
const dir='ai_docs/reports/w-18-evidence';
const sha=b=>createHash('sha256').update(b).digest('hex');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const head=f=>execFileSync('git',['show',`HEAD:brogue-web/${f}`]);
const methods=source=>{const t=ts.createSourceFile('Game.ts',source,99,true),r={};const visit=n=>{if(ts.isMethodDeclaration(n))r[n.name.getText(t)]=n.getText(t);ts.forEachChild(n,visit);};visit(t);return r;};
const old=methods(head('src/engine/Core/Game.ts').toString()),now=methods(fs.readFileSync('src/engine/Core/Game.ts','utf8'));
const allowed=['createMonsterFromSnapshot','generateTestDepth','update','handlePlayerAction','applyDirectBoltDamage','applyBasicBoltEffect','applyBoltEffect','throwItemAt','findLiveSeizer','diveConfirmationNeeded','monstersFall','advancementLoop','serializeMonster','deserializeMonster','placeCreature','stepAutoPathInner'];
const protectedFiles=['src/data/arcana.json','src/data/monsters.json','src/data/mutations.json','src/engine/Combat/Bolt.ts','src/engine/Combat/BoltCatalog.ts','src/engine/Combat/BoltTrajectory.ts','src/engine/Items/Item.ts','src/engine/Items/ItemLoader.ts','src/engine/Items/ArcanaInstance.ts','src/engine/Items/ArcanaRecharge.ts','src/engine/Items/ArcanaEnchantment.ts','src/engine/Random.ts','src/engine/Environment/Gas.ts','src/engine/Map/DungeonFeature.ts','src/engine/Map/DungeonFeatureCatalog.ts','src/engine/Map/TerrainCatalog.ts','src/engine/Map/Promotion.ts','src/engine/Map/Grid.ts','src/engine/Generator/BlueprintEngine.ts','src/engine/Map/AutoGenerator.ts','src/engine/Map/WaypointMap.ts','src/entities/Player.ts','src/test/fixtures/generation_baseline.json'];
const boundary={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),changedGameMethods:Object.keys(old).filter(k=>old[k]!==now[k]),addedGameMethods:Object.keys(now).filter(k=>!(k in old)),unchangedFiles:Object.fromEntries(protectedFiles.map(f=>[f,{sha:sha(fs.readFileSync(f)),equal:head(f).equals(fs.readFileSync(f))}])),protectedMethods:Object.fromEntries(['generateDepth','objectiveTimeBlock','finishTurnEpilogue','triggerDeathFeatures','dropMonsterLoot','removeDeadMonsters','playerTurnEnded','tickCreatureStatuses','rebuildWaypoints','tickArcanaResources','useArcanaItem','castMonsterBolt','findNearbySpawnSpot','spawnHordeAt','summonMinionsFor','trySplitMonster'].map(k=>[k,old[k]!==undefined&&old[k]===now[k]]))};
fs.writeFileSync(`${dir}/boundary.json`,JSON.stringify(boundary,null,2)+'\n');
if(boundary.changedGameMethods.some(k=>!allowed.includes(k))||boundary.addedGameMethods.some(k=>k!=='moveEntrancedMonsters')||Object.values(boundary.unchangedFiles).some(x=>!x.equal)||Object.values(boundary.protectedMethods).some(x=>!x))throw Error('Unexpected boundary change');
const trackedTests=execFileSync('git',['ls-files','src'],{encoding:'utf8'}).trim().split('\n').filter(f=>f.endsWith('.test.ts'));
const unchangedExistingTests=trackedTests.every(f=>head(f).equals(fs.readFileSync(f)));
fs.writeFileSync(`${dir}/test-boundary.json`,JSON.stringify({unchangedExistingTests,existingTestCount:trackedTests.length},null,2)+'\n');
if(!unchangedExistingTests)throw Error('Existing test changed');
execFileSync(process.execPath,['scripts/w18-test-scope.mjs']);
const scope=JSON.parse(fs.readFileSync(`${dir}/closure.json`,'utf8'));
const manifest=()=>[...walk('src'),...walk('public'),...walk('scripts'),'progress.md',`${dir}/ce-entrancement.c`,`${dir}/ce-entrancement.txt`,'ai_docs/tasks/w-18.prompt.md','ai_docs/reports/w-0-survey.report.md',...['Items','PowerTables','Math','Combat','Time','Monsters','Movement','Rogue','Globals','Architect','Grid','RogueMain','IO','GlobalsBase'].map(s=>`../BrogueCE-master/src/brogue/${s}.${s==='Rogue'?'h':'c'}`),'../BrogueCE-master/src/variants/GlobalsBrogue.c',...fs.readdirSync('.').filter(f=>/^(package.*\.json|tsconfig.*\.json|vite\.config\..*|index\.html)$/.test(f))].sort().map(f=>`${sha(fs.readFileSync(f))}  ${f}`).join('\n')+'\n';
const before=manifest();fs.writeFileSync(`${dir}/sha256-before.txt`,before);
const runs=[['build','npm',['run','build']],['regression',process.execPath,['node_modules/vitest/vitest.mjs','run',...scope.all.filter(f=>!f.endsWith('/generation_baseline.test.ts')),'--maxWorkers=8','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-regression.json`]],['drift','npm',['run','test:drift','--','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-drift.json`]]];
const results=[];
for(const [name,bin,args]of runs){
 const start=new Date().toISOString(),log=fs.openSync(`${dir}/final-${name}.log`,'w');console.log(`${start} START ${name}`);
 const r=spawnSync(bin,args,{stdio:['ignore',log,log],env:process.env});fs.closeSync(log);
 results.push({name,bin,args,start,end:new Date().toISOString(),exit:r.status,error:r.error?.message});console.log(`${results.at(-1).end} END ${name} exit=${r.status}`);
}
// Only timeout failures qualify for a serial rerun; never raise timeout limits.
const retries=[];
const batch=JSON.parse(fs.readFileSync(`${dir}/final-regression.json`,'utf8'));
for(const t of batch.testResults.filter(t=>t.status==='failed')) {
 const failed=t.assertionResults.filter(a=>a.status==='failed');
 if(!failed.length||!failed.every(a=>(a.failureMessages??[]).some(m=>/Test timed out|Hook timed out|Timeout of \d+ms exceeded/i.test(m))))continue;
 const file=path.relative(process.cwd(),t.name),name=`serial-${retries.length+1}`,out=`${dir}/final-${name}.json`;
 const bin=process.execPath,args=['node_modules/vitest/vitest.mjs','run',file,'--maxWorkers=1','--reporter=default','--reporter=json',`--outputFile.json=${out}`];
 const log=fs.openSync(`${dir}/final-${name}.log`,'w'),start=new Date().toISOString();console.log(`${start} START ${name} ${file}`);
 const r=spawnSync(bin,args,{stdio:['ignore',log,log],env:process.env});fs.closeSync(log);
 retries.push({name,file,bin,args,start,end:new Date().toISOString(),exit:r.status});
 console.log(`${retries.at(-1).end} END ${name} exit=${r.status}`);
}
const after=manifest();fs.writeFileSync(`${dir}/sha256-after.txt`,after);
const summary={results,retries,filesHashed:before.trim().split('\n').length,shaBefore:sha(before),shaAfter:sha(after),unchanged:before===after};
fs.writeFileSync(`${dir}/final-summary.json`,JSON.stringify(summary,null,2)+'\n');
const counts={},perFile=[],fileResults=new Map();
for(const run of ['regression','drift',...retries.map(r=>r.name)]){
 const d=JSON.parse(fs.readFileSync(`${dir}/final-${run}.json`,'utf8'));
 for(const t of d.testResults)fileResults.set(t.name,{t,run});
}
for(const {t,run} of fileResults.values()){
 const statuses={};for(const a of t.assertionResults){statuses[a.status]=(statuses[a.status]??0)+1;counts[a.status]=(counts[a.status]??0)+1;}
 perFile.push({file:path.relative(process.cwd(),t.name),status:t.status,statuses,run});
}
fs.writeFileSync(`${dir}/final-files.json`,JSON.stringify({counts,perFile:perFile.sort((a,b)=>a.file.localeCompare(b.file))},null,2)+'\n');
console.log(JSON.stringify({...summary,counts,results:results.map(({name,exit})=>({name,exit}))},null,2));
process.exitCode=before===after&&results.filter(r=>r.name!=='regression').every(r=>r.exit===0)&&perFile.every(f=>f.status==='passed')?0:1;
