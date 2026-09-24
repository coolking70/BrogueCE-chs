import ts from 'typescript';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const dir='ai_docs/reports/u-07-evidence';
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const initial=JSON.parse(fs.readFileSync(`${dir}/initial-hashes.json`));
const allowed=['progress.md','src/entities/Monster.ts','src/engine/Core/Game.ts','src/engine/Combat/BoltReflection.ts','src/engine/Map/DungeonFeature.ts','src/locales/zh_CN.json','src/test/p4_1b_monster_casting.test.ts'].map(f=>'brogue-web/'+f);
const protectedFiles=Object.keys(initial).filter(f=>!allowed.includes(f));
const changed=protectedFiles.filter(f=>hash('../'+f)!==initial[f]);assert.deepEqual(changed,[]);
const printer=ts.createPrinter({removeComments:true});
const parse=(f,text)=>ts.createSourceFile(f,text,ts.ScriptTarget.Latest,true);
const old=f=>execFileSync('git',['show','HEAD:brogue-web/'+f],{encoding:'utf8'});
const members=(f,text)=>{const tree=parse(f,text),out={};for(const n of tree.statements)if(ts.isClassDeclaration(n))for(const m of n.members)out[m.name?.getText(tree)??'constructor']=printer.printNode(ts.EmitHint.Unspecified,m,tree);return out;};
const methodChecks={};for(const f of ['src/engine/Core/Game.ts','src/entities/Monster.ts']){
 const before=members(f,old(f)),after=members(f,fs.readFileSync(f,'utf8'));
 const names=Object.keys(before).filter(n=>!(f.includes('Monster')&&n==='takeTurn'));
 const differences=names.filter(n=>before[n]!==after[n]);assert.deepEqual(differences,[]);
 methodChecks[f]={unchanged:names.length,added:Object.keys(after).filter(n=>!(n in before)),differences};
}
const assertions=(text)=>{const f='test.ts',tree=parse(f,text),out=[];const walk=n=>{if(ts.isCallExpression(n)&&n.getText(tree).startsWith('expect('))out.push(printer.printNode(ts.EmitHint.Unspecified,n,tree));ts.forEachChild(n,walk);};walk(tree);return out;};
const test='src/test/p4_1b_monster_casting.test.ts',before=assertions(old(test)),after=assertions(fs.readFileSync(test,'utf8'));
const pool=[...after];for(const assertion of before){const i=pool.indexOf(assertion);assert(i>=0,assertion);pool.splice(i,1);}
const result={protectedTrackedFiles:protectedFiles.length,unexpectedChanges:changed,methodChecks,p4OriginalAssertionsPreserved:before.length,p4AddedAssertions:pool,initialManifestSha256:hash(`${dir}/initial-hashes.json`)};
fs.writeFileSync(`${dir}/boundary.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
