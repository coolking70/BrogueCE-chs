import fs from 'node:fs';
import ts from 'typescript';
process.chdir(new URL('..', import.meta.url).pathname);
const out = 'ai_docs/reports/x3a-evidence';
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
const rows = [];
for (const file of walk('src').filter(f => /\.(ts|vue)$/.test(f) && !f.includes('/test/') && !f.endsWith('.test.ts'))) {
 const raw = fs.readFileSync(file, 'utf8');
 // Blank template/styles while retaining script line numbers.
 const code = file.endsWith('.vue') ? (() => {
  const chars = raw.replace(/[^\n]/g, ' ').split('');
  for (const match of raw.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
   const start = match.index + match[0].indexOf('>') + 1;
   for (let i = 0; i < match[1].length; i++) chars[start + i] = match[1][i];
  }
  return chars.join('');
 })() : raw;
 const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
 const roster = /\b(monsters|dormantMonsters|allMonsters|creatures|visibleMonsters|everSeenMonsters)\b/;
 const scope = node => {
  for (let p = node.parent; p; p = p.parent) {
   if ((ts.isMethodDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) && p.name) return p.name.getText(source);
   if (ts.isVariableDeclaration(p) && p.initializer && (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))) return p.name.getText(source);
  }
  return '(module)';
 };
 function visit(node) {
  let expression;
  if (ts.isForOfStatement(node)) expression = node.expression;
  else if (ts.isSpreadElement(node)) expression = node.expression;
  else if (ts.isCallExpression(node)) {
   if (ts.isPropertyAccessExpression(node.expression) && /^(filter|some|find|map|forEach|reduce|every|entries|values)$/.test(node.expression.name.text)) expression = node.expression.expression;
   else if (node.arguments.some(a => roster.test(a.getText(source)))) expression = node.arguments.find(a => roster.test(a.getText(source)));
  }
  if (expression && roster.test(expression.getText(source))) {
   rows.push({ file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, scope: scope(node), kind: ts.SyntaxKind[node.kind], expression: expression.getText(source) });
  }
  ts.forEachChild(node, visit);
 }
 visit(source);
}
fs.writeFileSync(`${out}/consumer-inventory.json`, JSON.stringify(rows, null, 2) + '\n');
const ce = [];
for (const file of walk('../BrogueCE-master/src').filter(f => f.endsWith('.c'))) {
 const lines = fs.readFileSync(file, 'utf8').split('\n'); let scope = '';
 lines.forEach((line, i) => {
  const name = line.match(/^[A-Za-z_][\w *]*\s+([A-Za-z_]\w*)\([^;]*\)?\s*\{?$/); if (name) scope = name[1];
  if (/iterateCreatures\(|creatureListNode \*(?:next|monstNode) = .*head/.test(line)) ce.push({ file, line: i + 1, scope, code: line.trim() });
 });
}
fs.writeFileSync(`${out}/ce-consumer-inventory.json`, JSON.stringify(ce, null, 2) + '\n');
console.log(JSON.stringify({ sourceConsumers: rows.length, ceConsumers: ce.length, files: new Set(rows.map(r => r.file)).size }));
