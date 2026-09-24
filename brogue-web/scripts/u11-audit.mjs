// U11 freezes the authorized production surface and preserves old assertions.
import ts from 'typescript';
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const dir='ai_docs/reports/u-11-evidence';
const old=f=>execFileSync('git',['show','HEAD:brogue-web/'+f],{encoding:'utf8'});
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const allowed=['src/components/GameCanvas.vue','src/engine/Combat/MonsterBlink.ts','src/engine/Core/EntitySnapshot.ts','src/engine/Core/Game.ts','src/entities/Monster.ts','src/locales/zh_CN.json','src/test/u_10_absorption_snapshot.test.ts','src/test/w_21_empowerment.test.ts'];
const tracked=execFileSync('git',['ls-files','src','public','package.json','package-lock.json','vite.config.ts'],{encoding:'utf8'}).trim().split('\n');
const changes=tracked.filter(f=>fs.readFileSync(f,'utf8')!==old(f));assert.deepEqual(changes.sort(),allowed.sort());
const printer=ts.createPrinter({removeComments:true});
const members=(f,text)=>{const tree=ts.createSourceFile(f,text,ts.ScriptTarget.Latest,true),out={};for(const n of tree.statements){if(ts.isClassDeclaration(n))for(const m of n.members)out[m.name?.getText(tree)??'constructor']=printer.printNode(ts.EmitHint.Unspecified,m,tree);if(ts.isFunctionDeclaration(n)&&n.name)out[n.name.text]=printer.printNode(ts.EmitHint.Unspecified,n,tree);}return out;};
const expected={
 'src/entities/Monster.ts':['takeTurn'],
 'src/engine/Core/Game.ts':['removeDeadMonsters','advancementLoop'],
 'src/engine/Combat/MonsterBlink.ts':['blinkAllyAfterMagic'],
};
const methods={};for(const[f,permitted]of Object.entries(expected)){
 const before=members(f,old(f)),after=members(f,fs.readFileSync(f,'utf8'));
 const differences=Object.keys(before).filter(k=>before[k]!==after[k]);assert.deepEqual(differences.sort(),permitted.sort());
 methods[f]={differences,added:Object.keys(after).filter(k=>!(k in before)),unchanged:Object.keys(before).length-differences.length};
}
const expects=(f,s)=>{const tree=ts.createSourceFile(f,s,ts.ScriptTarget.Latest,true),found=[];const visit=n=>{if(ts.isCallExpression(n)&&n.expression.getText(tree).startsWith('expect('))found.push(printer.printNode(ts.EmitHint.Unspecified,n,tree));ts.forEachChild(n,visit);};visit(tree);return found;};
const testProof={};for(const f of allowed.filter(f=>f.endsWith('.test.ts'))){const before=expects(f,old(f)),after=expects(f,fs.readFileSync(f,'utf8'));assert.deepEqual(after,before);testProof[f]={assertionsUnchanged:before.length};}
const g=fs.readFileSync('../BrogueCE-master/src/brogue/Globals.c','utf8');
const names=[...g.split('creatureType monsterCatalog[NUMBER_MONSTER_KINDS] = {')[1].split('const monsterWords')[0].matchAll(/\{0, "([^"]+)"/g)].map(m=>m[1]);
const verbs=[...g.split('const monsterWords monsterText[NUMBER_MONSTER_KINDS] = {')[1].split('const monsterBehavior')[0].matchAll(/^    \{"(?:[^"\\]|\\.)*",\s*"([^"]+)"/gm)].map(m=>m[1]);
assert.equal(names.length,68);assert.equal(verbs.length,68);
const text=Object.fromEntries(names.map((name,i)=>[name==='you'?'player_clone':name.replaceAll(' ','_'),verbs[i]]));
assert.deepEqual(JSON.parse(fs.readFileSync('src/data/monsterAbsorptionVerbs.json')),text);
const masks=fs.readFileSync('../BrogueCE-master/src/brogue/Rogue.h','utf8');
const bits=k=>masks.match(new RegExp(`${k}\\s*=\\s*\\(([^)]+)\\)`))[1].match(/\b(?:MONST|MA)_\w+/g);
assert.deepEqual(bits('LEARNABLE_ABILITIES'),['MA_TRANSFERENCE','MA_CAUSES_WEAKNESS']);
assert.deepEqual(bits('LEARNABLE_BEHAVIORS'),['MONST_INVISIBLE','MONST_FLIES','MONST_IMMUNE_TO_FIRE','MONST_REFLECT_50']);
const result={changes,methods,testProof,ceAbsorptionVerbs:68,protectedUnchanged:tracked.length-changes.length,
 generationBaselineSha256:hash(fs.readFileSync('src/test/fixtures/generation_baseline.json')),lockSha256:hash(fs.readFileSync('package-lock.json'))};
fs.writeFileSync(`${dir}/boundary.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
