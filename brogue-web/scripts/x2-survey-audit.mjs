import fs from 'node:fs';
import path from 'node:path';
import ts from '../node_modules/typescript/lib/typescript.js';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'ai_docs/reports/x-2-evidence');
const write=(name,value)=>fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2)+'\n');
const reports=fs.readdirSync(path.join(root,'ai_docs/reports')).filter(f=>/^x2[a-o]\.report\.md$/.test(f));
const boundaries=reports.flatMap(f=>fs.readFileSync(path.join(root,'ai_docs/reports',f),'utf8').split('\n').flatMap((s,i)=>/边界|未核实|仍|不做|不含|未覆盖|保留|剩余|未移植|未接|未实现|TODO|验收方合并/.test(s)?[{file:f,line:i+1,text:s}]:[]));
write('report-boundaries.json',boundaries);
const selected=JSON.parse(fs.readFileSync(path.join(out,'selected-tests.json')));
for(const group of ['x2','legacy']){
const result=[];
for(const file of selected.filter(f=>group==='x2'?/\/x2/.test(f):!/\/x2/.test(f))){
 const source=fs.readFileSync(path.join(root,file),'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const assertions=[],tests=[];
 const visit=node=>{if(ts.isCallExpression(node)){
  const t=node.getText(ast),line=ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1;
  if(/^expect\(/.test(t)&&!ts.isPropertyAccessExpression(node.parent))assertions.push({line,text:t});
  if(/^(it|test)(\.|\()/.test(t)&&node.arguments[0]&&(ts.isStringLiteralLike(node.arguments[0])||ts.isTemplateExpression(node.arguments[0])))tests.push({line,name:node.arguments[0].getText(ast)});
 }ts.forEachChild(node,visit);};visit(ast);result.push({file,tests,assertions});
}
write(`guard-review-${group}.json`,result);
}
console.log(JSON.stringify({reports:reports.length,boundaryLines:boundaries.length,selected:selected.length}));
