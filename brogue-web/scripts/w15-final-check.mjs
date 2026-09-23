// Final immutable-source run: explicit R+S file list, build, and independent drift.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
const dir='ai_docs/reports/w-15-evidence';
const sha=b=>createHash('sha256').update(b).digest('hex');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const head=f=>execFileSync('git',['show',`HEAD:brogue-web/${f}`]);
const methods=source=>{const t=ts.createSourceFile('Game.ts',source,99,true),r={};const visit=n=>{if(ts.isMethodDeclaration(n))r[n.name.getText(t)]=n.getText(t);ts.forEachChild(n,visit);};visit(t);return r;};
const old=methods(head('src/engine/Core/Game.ts').toString()),now=methods(fs.readFileSync('src/engine/Core/Game.ts','utf8'));
const allowed=['createMonsterFromSnapshot','generateTestDepth','tunnelAt','applyBoltEffect','applyMonsterBoltHit','negateCreatureMagic','crystalizeFromPlayer','tryTriggerWeaponRunic','applyWeaponRunicEffect','tryTriggerArmorRunic','resolvePoisonDamage','trySplitMonster','playerFalls','monstersFall','toSnapshot','serializeMonster','deserializeMonster','loadSnapshot','resolveBurningDamage','resolveExplosionDamage','applyEnvironmentalEffects'];
const protectedFiles=['src/data/arcana.json','src/data/monsters.json','src/data/mutations.json','src/engine/Combat/BoltCatalog.ts','src/engine/Combat/BoltTrajectory.ts','src/engine/Movement/CreaturePlacement.ts','src/engine/Items/Item.ts','src/engine/Items/ItemLoader.ts','src/engine/Items/ArcanaInstance.ts','src/engine/Items/ArcanaRecharge.ts','src/engine/Items/ArcanaEnchantment.ts','src/engine/Random.ts','src/engine/Environment/Gas.ts','src/engine/Map/DungeonFeature.ts','src/engine/Map/DungeonFeatureCatalog.ts','src/engine/Map/TerrainCatalog.ts','src/engine/Map/Promotion.ts','src/engine/Map/Grid.ts','src/engine/Generator/BlueprintEngine.ts','src/engine/Map/AutoGenerator.ts','src/engine/Map/WaypointMap.ts','src/entities/Player.ts','src/test/fixtures/generation_baseline.json'];
const boundary={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),changedGameMethods:Object.keys(old).filter(k=>old[k]!==now[k]),addedGameMethods:Object.keys(now).filter(k=>!(k in old)),unchangedFiles:Object.fromEntries(protectedFiles.map(f=>[f,{sha:sha(fs.readFileSync(f)),equal:head(f).equals(fs.readFileSync(f))}])),protectedMethods:Object.fromEntries(['generateDepth','objectiveTimeBlock','playerTurnEnded','finishTurnEpilogue','triggerDeathFeatures','dropMonsterLoot','removeDeadMonsters','handlePlayerAction','tickCreatureStatuses','applyDirectBoltDamage','applyBasicBoltEffect','applyBoltResult','rebuildWaypoints','tickArcanaResources','useArcanaItem','castMonsterBolt'].map(k=>[k,old[k]!==undefined&&old[k]===now[k]]))};
fs.writeFileSync(`${dir}/boundary.json`,JSON.stringify(boundary,null,2)+'\n');
if(boundary.changedGameMethods.some(k=>!allowed.includes(k))||boundary.addedGameMethods.length||Object.values(boundary.unchangedFiles).some(x=>!x.equal)||Object.values(boundary.protectedMethods).some(x=>!x))throw Error('Unexpected boundary change');
execFileSync(process.execPath,['scripts/w15-test-scope.mjs']);execFileSync(process.execPath,['scripts/w15-damage-audit.mjs']);
const scope=JSON.parse(fs.readFileSync(`${dir}/closure.json`,'utf8'));
const manifest=()=>[...walk('src'),...walk('public'),...walk('scripts'),'progress.md','ai_docs/tasks/w-15.prompt.md','ai_docs/reports/w-0-survey.report.md',...['Items','PowerTables','Math','Combat','Time','Monsters','Movement','Rogue','Globals','Architect'].map(s=>`../BrogueCE-master/src/brogue/${s}.${s==='Rogue'?'h':'c'}`),'../BrogueCE-master/src/variants/GlobalsBrogue.c',...fs.readdirSync('.').filter(f=>/^(package.*\.json|tsconfig.*\.json|vite\.config\..*|index\.html)$/.test(f))].sort().map(f=>`${sha(fs.readFileSync(f))}  ${f}`).join('\n')+'\n';
const before=manifest();fs.writeFileSync(`${dir}/sha256-before.txt`,before);
const runs=[['build','npm',['run','build']],['regression',process.execPath,['node_modules/vitest/vitest.mjs','run',...scope.all.filter(f=>!f.endsWith('/generation_baseline.test.ts')),'--maxWorkers=4','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-regression.json`]],['drift','npm',['run','test:drift','--','--reporter=default','--reporter=json',`--outputFile.json=${dir}/final-drift.json`]]];
const results=[];
for(const [name,bin,args]of runs){
 const start=new Date().toISOString(),log=fs.openSync(`${dir}/final-${name}.log`,'w');console.log(`${start} START ${name}`);
 const r=spawnSync(bin,args,{stdio:['ignore',log,log],env:process.env});fs.closeSync(log);
 results.push({name,bin,args,start,end:new Date().toISOString(),exit:r.status,error:r.error?.message});console.log(`${results.at(-1).end} END ${name} exit=${r.status}`);
}
const after=manifest();fs.writeFileSync(`${dir}/sha256-after.txt`,after);
const summary={results,filesHashed:before.trim().split('\n').length,shaBefore:sha(before),shaAfter:sha(after),unchanged:before===after};
fs.writeFileSync(`${dir}/final-summary.json`,JSON.stringify(summary,null,2)+'\n');
const counts={},perFile=[];
for(const run of ['regression','drift']){
 const d=JSON.parse(fs.readFileSync(`${dir}/final-${run}.json`,'utf8'));
 for(const t of d.testResults){const statuses={};for(const a of t.assertionResults){statuses[a.status]=(statuses[a.status]??0)+1;counts[a.status]=(counts[a.status]??0)+1;}
 perFile.push({file:path.relative(process.cwd(),t.name),status:t.status,statuses,run});}
}
fs.writeFileSync(`${dir}/final-files.json`,JSON.stringify({counts,perFile:perFile.sort((a,b)=>a.file.localeCompare(b.file))},null,2)+'\n');
console.log(JSON.stringify({...summary,counts,results:results.map(({name,exit})=>({name,exit}))},null,2));
process.exitCode=before===after&&results.every(r=>r.exit===0)?0:1;
