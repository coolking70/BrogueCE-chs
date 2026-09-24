import fs from 'node:fs';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';import ts from 'typescript';
const dir='ai_docs/reports/u-14b-evidence';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const old=f=>execFileSync('git',['show',`HEAD:brogue-web/${f}`]);
const allowed=[
 'src/engine/Combat/Combat.ts','src/engine/Combat/CombatFormulas.ts','src/engine/Combat/MonsterBlink.ts',
 'src/engine/Core/Game.ts','src/engine/Map/Promotion.ts','src/engine/Status/statusConfig.ts','src/engine/UI/DetailGenerator.ts',
 'src/test/u_08_terrain_bolts.test.ts','src/test/w_18_entrancement.test.ts','src/test/ui_1_rendering.test.ts',
 'src/entities/Creature.ts','src/entities/Monster.ts','src/entities/Player.ts','src/locales/zh_CN.json',
];
const files=execFileSync('git',['ls-files','src','public'],{encoding:'utf8'}).trim().split('\n');
const protectedHashes={};for(const f of files.filter(f=>!allowed.includes(f))){const a=sha(old(f)),b=sha(fs.readFileSync(f));assert.equal(a,b,f);protectedHashes[f]=b;}
const method=(s,name)=>{const ast=ts.createSourceFile('Game.ts',s,ts.ScriptTarget.Latest,true);let result;const visit=n=>{if(ts.isMethodDeclaration(n)&&n.name.getText(ast)===name)result=n;ts.forEachChild(n,visit);};visit(ast);assert(result,name);return ts.createPrinter({removeComments:true}).printNode(ts.EmitHint.Unspecified,result,ast);};
const game=fs.readFileSync('src/engine/Core/Game.ts','utf8'),prior=old('src/engine/Core/Game.ts').toString();
const unchangedMethods=['updateVision','calculateStealthRange','generateDepth','populateLevel'];
for(const name of unchangedMethods)assert.equal(method(game,name),method(prior,name),name);
const unchangedPlayerMethods=['tickNutrition','recoverPerTurn','updateNutrition','regenRatePerTurn','computeHungerState'];
for(const name of unchangedPlayerMethods)assert.equal(method(fs.readFileSync('src/entities/Player.ts','utf8'),name),method(old('src/entities/Player.ts').toString(),name),name);
const expectations=s=>{const ast=ts.createSourceFile('test.ts',s,ts.ScriptTarget.Latest,true),out=[];const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(ast).startsWith('expect('))out.push(ts.createPrinter({removeComments:true}).printNode(ts.EmitHint.Unspecified,n,ast));ts.forEachChild(n,visit);};visit(ast);return out;};
const unchangedExpectations={};
for(const file of ['src/test/u_08_terrain_bolts.test.ts','src/test/w_18_entrancement.test.ts']){const current=expectations(fs.readFileSync(file,'utf8'));assert.deepEqual(current,expectations(old(file).toString()));unchangedExpectations[file]=current.length;}
const data=JSON.parse(fs.readFileSync('src/data/monsters.json'));
const census=data.filter(m=>m.abilityFlags?.includes('MA_AVOID_CORRIDORS')).map(m=>({id:m.id,abilityFlags:m.abilityFlags}));
const baseline='src/test/fixtures/generation_baseline.json';
const result={allowed,unchangedMethods,protectedHashes,baselineSha256:sha(fs.readFileSync(baseline)),catalogStatusSources:census,unchangedPlayerMethods,unchangedExpectations,existingTestChanges:['U08/W18: establish actual STUCK carrier in artificial held-target fixtures; all expect AST unchanged','UI1: extend the explicit carrier inventory with CE empty-name enraged; original filtering guard intact']};
fs.writeFileSync(`${dir}/boundary.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({protectedFiles:Object.keys(protectedHashes).length,unchangedMethods,census}));
