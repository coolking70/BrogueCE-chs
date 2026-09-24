import ts from 'typescript';
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const dir='ai_docs/reports/u-09-evidence';
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const old=f=>execFileSync('git',['show','HEAD:brogue-web/'+f],{encoding:'utf8'});
const printer=ts.createPrinter({removeComments:true});
const parse=(f,text)=>ts.createSourceFile(f,text,ts.ScriptTarget.Latest,true);
const members=(f,text)=>{const tree=parse(f,text),out={};for(const n of tree.statements){if(ts.isClassDeclaration(n))for(const m of n.members)out[m.name?.getText(tree)??'constructor']=printer.printNode(ts.EmitHint.Unspecified,m,tree);if(ts.isFunctionDeclaration(n)&&n.name)out[n.name.text]=printer.printNode(ts.EmitHint.Unspecified,n,tree);}return out;};
const expected={
 'src/engine/Core/Game.ts':['boltLivingTarget','applyBoltEffect','castMonsterBolt','applyMonsterBoltHit'],
 'src/entities/Monster.ts':['specificallyValidBoltTarget','syncFlagDerivedStatuses','isStatusPermanent','canBePoisoned'],
 'src/engine/Combat/Combat.ts':['attack'],
};
const methodChecks={};for(const [f,allowed] of Object.entries(expected)){
 const before=members(f,old(f)),after=members(f,fs.readFileSync(f,'utf8'));
 const differences=Object.keys(before).filter(k=>before[k]!==after[k]);assert.deepEqual([...differences].sort(),[...allowed].sort());
 methodChecks[f]={unchanged:Object.keys(before).length-differences.length,differences,added:Object.keys(after).filter(k=>!(k in before))};
}
const f='src/engine/Combat/Bolt.ts';
const table=text=>{const tree=parse(f,text);let value;const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(tree)==='MONSTER_BOLT_TABLE')value=Object.fromEntries(n.initializer.properties.map(p=>[p.name.getText(tree),printer.printNode(ts.EmitHint.Unspecified,p,tree)]));ts.forEachChild(n,visit);};visit(tree);return value;};
const before=table(old(f)),after=table(fs.readFileSync(f,'utf8'));assert.equal(Object.keys(before).length,15);
for(const [key,value] of Object.entries(before))assert.equal(after[key],value);
assert.deepEqual(Object.keys(after).filter(k=>!(k in before)),['TELEPORT','SLOW','POLYMORPH','DOMINATION','INVISIBILITY','LIGHTNING','POISON','ENTRANCEMENT','CONJURATION','TUNNELING','OBSTRUCTION']);
const initial=JSON.parse(fs.readFileSync(dir+'/initial-hashes.json'));
const changed=Object.keys(initial).filter(f=>hash(f)!==initial[f]);
assert.deepEqual(changed.filter(f=>!['src/engine/Combat/Bolt.ts','src/engine/Combat/BoltCatalog.test.ts','src/engine/Combat/Combat.ts','src/engine/Core/Game.ts','src/entities/Monster.ts'].includes(f)),[]);
const testAssertions=text=>{const tree=parse('test.ts',text),out=[];const visit=n=>{if(ts.isCallExpression(n)&&n.getText(tree).startsWith('expect('))out.push(printer.printNode(ts.EmitHint.Unspecified,n,tree));ts.forEachChild(n,visit);};visit(tree);return out;};
const test='src/engine/Combat/BoltCatalog.test.ts';const oldAssertions=testAssertions(old(test)),newAssertions=testAssertions(fs.readFileSync(test,'utf8'));
const removed=oldAssertions.filter(a=>!newAssertions.includes(a)),added=newAssertions.filter(a=>!oldAssertions.includes(a));assert.equal(removed.length,2); // exact keys + exact projections; POLYMORPH moved out of the unchanged per-name undefined assertion
const result={methodChecks,nativeBoltEntriesUnchanged:15,newBoltEntries:11,changed,protectedUnchanged:Object.keys(initial).length-changed.length,assertionChanges:{removed,added},generationBaselineSha256:hash('src/test/fixtures/generation_baseline.json'),lockSha256:hash('package-lock.json')};
fs.writeFileSync(dir+'/boundary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
