import ts from 'typescript';
import fs from 'node:fs';
const root='/Users/coolking70/.codex/worktrees/7976/brogue/brogue-web';
function units(file) {
 const source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
 const map={};
 function visit(n) {
  if(ts.isMethodDeclaration(n)||ts.isFunctionDeclaration(n)) map[n.name?.getText(source)??'<anonymous>']=n.getText(source);
  ts.forEachChild(n,visit);
 }
 visit(source);return map;
}
const result={};
for(const name of ['Game.ts','TimeCoordinator.ts']) {
 const before=units('/tmp/x3-u8a-evidence/baseline-'+name),after=units(root+'/src/engine/Core/'+name);
 result[name]=Object.keys({...before,...after}).filter(k=>before[k]!==after[k]);
}
fs.writeFileSync('/tmp/x3-u8a-evidence/method-scope.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
