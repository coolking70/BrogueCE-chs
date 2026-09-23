// AST inventory of HP writes, damage/death calls, and dynamic HP syntax; no regex-only count.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const dir='ai_docs/reports/w-15-evidence';fs.mkdirSync(dir,{recursive:true});
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const files=walk('src').filter(f=>/\.(ts|vue)$/.test(f)&&!f.includes('/test/')&&!f.endsWith('.test.ts'));
const hp=n=>ts.isPropertyAccessExpression(n)?n.name.text==='hp':ts.isElementAccessExpression(n)&&n.argumentExpression?.text==='hp';
function scan(file,source){
 const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),rows=[];
 function visit(n,owner='top-level'){
  if(ts.isMethodDeclaration(n)||ts.isFunctionDeclaration(n)||ts.isConstructorDeclaration(n))owner=n.name?.getText(tree)??'constructor';
  let kind;
  if(ts.isBinaryExpression(n)&&n.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&n.operatorToken.kind<=ts.SyntaxKind.LastAssignment&&hp(n.left))kind='hp-write';
  if((ts.isPrefixUnaryExpression(n)||ts.isPostfixUnaryExpression(n))&&hp(n.operand))kind='hp-unary';
  if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&['takeDamage','die','triggerGameOver'].includes(n.expression.name.text))kind=n.expression.name.text;
  if(ts.isCallExpression(n)&&n.expression.getText(tree)==='Object.assign'&&n.arguments.slice(1).some(a=>ts.isObjectLiteralExpression(a)&&a.properties.some(p=>p.name?.getText(tree)==='hp')))kind='assign-hp';
  if(kind)rows.push({file,line:tree.getLineAndCharacterOfPosition(n.getStart(tree)).line+1,owner,kind,text:n.getText(tree)});
  ts.forEachChild(n,child=>visit(child,owner));
 }
 visit(tree);return rows;
}
const versions={};
for(const version of ['HEAD','current'])versions[version]=files.flatMap(f=>{
 let source;try{source=version==='HEAD'?execFileSync('git',['show',`HEAD:brogue-web/${f}`],{encoding:'utf8',stdio:['ignore','pipe','ignore']}):fs.readFileSync(f,'utf8');}catch{return [];}
 if(f.endsWith('.vue'))source=[...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
 return scan(f,source);
});
fs.writeFileSync(`${dir}/damage-sites.json`,JSON.stringify({scannedFiles:files.length,versions},null,2)+'\n');
for(const [version,rows]of Object.entries(versions))console.log(version,JSON.stringify(rows.reduce((r,x)=>(r[x.kind]=(r[x.kind]??0)+1,r),{})));
// Compile the unchanged CE functions as an independent formula oracle.
const extract=(s,name)=>{const a=s.lastIndexOf('\n',s.indexOf(name))+1;return s.slice(a,s.indexOf('\n}',a)+2);};
const math=fs.readFileSync('../BrogueCE-master/src/brogue/Math.c','utf8'),power=fs.readFileSync('../BrogueCE-master/src/brogue/PowerTables.c','utf8');
const c='#include <stdio.h>\ntypedef long long fixpt;\n#define FP_FACTOR 65536LL\n#define FP_DIV(x,y) ((x)*FP_FACTOR/(y))\n'+extract(math,'fixpt fp_round(')+'\n'+extract(math,'fixpt fp_pow(')+'\n'+extract(power,'int staffProtection(')+'\nint main(){for(int e=0;e<=20;e++)printf("%d %d\\n",e,staffProtection(e*FP_FACTOR));}\n';
fs.writeFileSync(`${dir}/ce-formula.c`,c);execFileSync('clang',[`${dir}/ce-formula.c`,'-o','/private/tmp/w15-ce-formula']);
fs.writeFileSync(`${dir}/ce-formula-values.txt`,execFileSync('/private/tmp/w15-ce-formula'));
