// U10 boundary evidence: preserve existing guards, generation inputs and AI state machine.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const dir='ai_docs/reports/u-10-evidence';
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const old=f=>execFileSync('git',['show','HEAD:brogue-web/'+f],{encoding:'utf8'});
const printer=ts.createPrinter({removeComments:true});
const members=(f,text)=>{const tree=ts.createSourceFile(f,text,ts.ScriptTarget.Latest,true),out={};for(const n of tree.statements){if(ts.isClassDeclaration(n))for(const m of n.members)out[m.name?.getText(tree)??'constructor']=printer.printNode(ts.EmitHint.Unspecified,m,tree);if(ts.isFunctionDeclaration(n)&&n.name)out[n.name.text]=printer.printNode(ts.EmitHint.Unspecified,n,tree);}return out;};
const expected={
 'src/engine/Core/Game.ts':['generateDepth','handleExamineNearest','handleInspectAt','monstersFall','resolveBurningDamage','applyEnvironmentalEffects'],
 'src/entities/Monster.ts':['copyForClone','copyPlayerForClone'],
 'src/engine/UI/DetailGenerator.ts':['generateMonsterDetail'],
};
const methodChecks={};for(const[f,allowed]of Object.entries(expected)){
 const before=members(f,old(f)),after=members(f,fs.readFileSync(f,'utf8'));
 const differences=Object.keys(before).filter(k=>before[k]!==after[k]);assert.deepEqual(differences.sort(),allowed.sort());
 methodChecks[f]={unchanged:Object.keys(before).length-differences.length,differences,added:Object.keys(after).filter(k=>!(k in before))};
}
const allowed=['src/entities/Monster.ts','src/engine/Core/EntitySnapshot.ts','src/engine/Core/Game.ts','src/engine/UI/DetailGenerator.ts','src/components/DetailPanel.vue'];
const initial=JSON.parse(fs.readFileSync(`${dir}/initial-hashes.json`));
const changed=Object.keys(initial).filter(f=>hash(f)!==initial[f]);assert.deepEqual(changed.sort(),allowed.sort());
assert(!changed.some(f=>f.endsWith('.test.ts')));
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const re=/targetCorpseLoc|targetCorpseName|corpseAbsorptionCounter|absorptionFlags|absorbBehavior|absorptionBolt|MB_ABSORBING|newPowerCount|totalPowerCount/;
const hits=[];for(const f of walk('../BrogueCE-master/src').filter(f=>/\.[ch]$/.test(f)))fs.readFileSync(f,'utf8').split('\n').forEach((line,i)=>{if(re.test(line))hits.push({file:f,line:i+1,text:line});});
const ceFiles=[...new Set([...hits.map(h=>h.file),'../BrogueCE-master/src/brogue/RogueMain.c'])];
fs.writeFileSync(`${dir}/ce-fields.json`,JSON.stringify({files:Object.fromEntries(ceFiles.map(f=>[f,hash(f)])),hits},null,2)+'\n');
const result={methodChecks,changed,protectedUnchanged:Object.keys(initial).length-changed.length,existingTestEdits:[],ceFieldReferences:hits.length,generationBaselineSha256:hash('src/test/fixtures/generation_baseline.json'),lockSha256:hash('package-lock.json')};
fs.writeFileSync(`${dir}/boundary.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
