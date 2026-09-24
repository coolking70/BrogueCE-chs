import fs from 'node:fs';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';import assert from 'node:assert/strict';import ts from 'typescript';
const dir='ai_docs/reports/u-14a-evidence';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const old=f=>execFileSync('git',['show',`HEAD:brogue-web/${f}`]);
const allowed=[
 'src/components/GameCanvas.vue','src/components/InventoryOverlay.vue','src/components/Sidebar.vue',
 'src/engine/Combat/BoltReflection.ts','src/engine/Combat/Combat.ts','src/engine/Combat/CombatFormulas.ts','src/engine/Combat/Negation.ts',
 'src/engine/Core/EntitySnapshot.ts','src/engine/Core/Game.ts','src/engine/Status/statusConfig.ts','src/engine/UI/DetailGenerator.ts',
 'src/entities/Creature.ts','src/entities/Monster.ts','src/entities/Player.ts','src/locales/zh_CN.json','src/test/w_20_cloning.test.ts',
];
const files=execFileSync('git',['ls-files','src','public'],{encoding:'utf8'}).trim().split('\n');
const protectedHashes={};for(const f of files.filter(f=>!allowed.includes(f))){const a=sha(old(f)),b=sha(fs.readFileSync(f));assert.equal(a,b,f);protectedHashes[f]=b;}
const method=(s,name)=>{const ast=ts.createSourceFile('Game.ts',s,ts.ScriptTarget.Latest,true);let result;const visit=n=>{if(ts.isMethodDeclaration(n)&&n.name.getText(ast)===name)result=n;ts.forEachChild(n,visit);};visit(ast);assert(result,name);return ts.createPrinter({removeComments:true}).printNode(ts.EmitHint.Unspecified,result,ast);};
const game=fs.readFileSync('src/engine/Core/Game.ts','utf8'),prior=old('src/engine/Core/Game.ts').toString();
const unchangedMethods=['updateVision','calculateStealthRange','generateDepth','populateLevel'];
for(const name of unchangedMethods)assert.equal(method(game,name),method(prior,name),name);
const data=JSON.parse(fs.readFileSync('src/data/monsters.json'));
const census=data.filter(m=>m.abilityFlags?.includes('MA_CAUSES_WEAKNESS')||['weakened','nauseous','darkness','magical_fear'].includes(m.onHitStatus)).map(m=>({id:m.id,abilityFlags:m.abilityFlags,onHitStatus:m.onHitStatus,onHitDuration:m.onHitDuration}));
const baseline='src/test/fixtures/generation_baseline.json';
const result={allowed,unchangedMethods,protectedHashes,baselineSha256:sha(fs.readFileSync(baseline)),catalogStatusSources:census,existingTestChanges:['src/test/w_20_cloning.test.ts: add maxStatus to the value-container premise and reverse-mutation inputs; preserve all expectations']};
fs.writeFileSync(`${dir}/boundary.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({protectedFiles:Object.keys(protectedHashes).length,unchangedMethods,census}));
