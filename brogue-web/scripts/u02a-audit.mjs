import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
const dir='ai_docs/reports/u-02a-evidence';
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const head=f=>execFileSync('git',['show',`HEAD:brogue-web/${f}`],{encoding:'utf8'});
const methods=(source,names)=>{
 const tree=ts.createSourceFile('input.ts',source,ts.ScriptTarget.Latest,true);
 const printer=ts.createPrinter({removeComments:true}), result={};
 const visit=n=>{if(ts.isMethodDeclaration(n)&&names.includes(n.name.getText(tree)))result[n.name.getText(tree)]=printer.printNode(ts.EmitHint.Unspecified,n,tree);ts.forEachChild(n,visit);};visit(tree);
 return result;
};
const stableMethods={
 'src/engine/Random.ts':['rot','ranval','raninit','range','randPercent','randClumpedRange','shuffleList','rollD'],
 'src/engine/Core/Game.ts':['generateDepth','populateLevel','spawnPopulateItem','spawnBlueprintItem','applyRandomMutation'],
};
const methodProof={};
for(const [file,names] of Object.entries(stableMethods)){
 const a=methods(head(file),names),b=methods(fs.readFileSync(file,'utf8'),names);
 assert.deepEqual(Object.keys(a).sort(),names.toSorted());assert.deepEqual(b,a);
 methodProof[file]=Object.fromEntries(names.map(n=>[n,sha(b[n])]));
}
const tracked=execFileSync('git',['ls-files','src','public'],{encoding:'utf8'}).trim().split('\n');
const protectedFiles=tracked.filter(f=>f.endsWith('.test.ts')||f.startsWith('src/engine/Generator/')||f.startsWith('src/data/')||/baseline|fixture/.test(f));
const unchanged=[], testPremises=[];
const premiseSeeds={
 'src/test/b_1b_identification_persistence.test.ts':42,
 'src/test/u_10_absorption_snapshot.test.ts':1010,
};
const treePrint=source=>{
 const tree=ts.createSourceFile('test.ts',source,ts.ScriptTarget.Latest,true);
 return ts.createPrinter({removeComments:true}).printFile(tree);
};
const expectations=source=>{
 const tree=ts.createSourceFile('test.ts',source,ts.ScriptTarget.Latest,true),out=[];
 const visit=n=>{if(ts.isExpressionStatement(n)&&n.getText(tree).startsWith('expect('))out.push(n.expression.getText(tree));ts.forEachChild(n,visit);};visit(tree);return out;
};
for(const f of protectedFiles){
 const current=fs.readFileSync(f,'utf8'),original=head(f);
 if(f in premiseSeeds){
  const seedLine=`rng.seedRandomGenerator(${premiseSeeds[f]});`;
  assert.equal(current.split(seedLine).length-1,1);
  assert.deepEqual(expectations(current),expectations(original));
  assert.equal(treePrint(current.replace(seedLine,'')),treePrint(original));
  testPremises.push({file:f,expectExpressions:expectations(current).length,originalSha256:sha(original),currentSha256:sha(current),onlyExecutableChange:seedLine});
 }else {assert.equal(sha(current),sha(original),f);unchanged.push({file:f,sha256:sha(current)});}
}
const ceFiles=['Math.c','RogueMain.c','Rogue.h','Recordings.c'].map(f=>`../BrogueCE-master/src/brogue/${f}`);
fs.writeFileSync(`${dir}/audit.json`,JSON.stringify({methodProof,unchanged,testPremises,ce:ceFiles.map(f=>({file:f,sha256:sha(fs.readFileSync(f))})),assertions:'All existing expectation expressions unchanged. Two explicit zero-origin fixture seeds added; all other existing tests, generation/data/baseline files and listed algorithms unchanged.'},null,2)+'\n');
console.log(JSON.stringify({unchangedProtectedFiles:unchanged.length,testPremises,methodProof}));
