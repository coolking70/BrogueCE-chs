// Read-only X-0 inventory. Writes only ai_docs/reports/x-0-evidence/.
// Usage: node scripts/x0-inventory.mjs before|after [absolute/typescript.js]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(root);
const dest = path.join(root, 'ai_docs/reports/x-0-evidence');
fs.mkdirSync(dest, { recursive: true });
const phase = process.argv[2] ?? 'before';
if (!['before', 'after'].includes(phase)) throw new Error('Expected before|after');
const write = (name, data) => fs.writeFileSync(path.join(dest, name), JSON.stringify(data, null, 2) + '\n');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' }).split('\0').filter(Boolean);
const hashes = Object.fromEntries(tracked.map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(repo, f))).digest('hex')]));
write(`tracked-${phase}.json`, hashes);
write(`git-${phase}.json`, {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  status: execFileSync('git', ['status', '--short', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' }),
  diffStat: execFileSync('git', ['diff', '--stat'], { cwd: repo, encoding: 'utf8' }),
});
if (phase === 'after') {
  const before = JSON.parse(fs.readFileSync(path.join(dest, 'tracked-before.json'), 'utf8'));
  write('tracked-comparison.json', { compared: Object.keys(before).length, changed: Object.keys(before).filter(f => before[f] !== hashes[f]) });
  process.exit(0);
}
const require = createRequire(import.meta.url);
const ts = require(process.argv[3] ?? 'typescript');
const source = f => ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true);
const gameFile = path.join(root, 'src/engine/Core/Game.ts');
const game = source(gameFile);
const line = (sf, n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
const klass = game.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'Game');
const members = klass.members.map(n => ({ name: n.name?.getText(game), kind: ts.SyntaxKind[n.kind], start: line(game, n), end: game.getLineAndCharacterOfPosition(n.end).line + 1, private: !!n.modifiers?.some(m => m.kind === ts.SyntaxKind.PrivateKeyword) }));
const privateNames = new Set(members.filter(m => m.private).map(m => m.name));
const files = tracked.filter(f => f.startsWith('brogue-web/src/') && /\.(ts|vue)$/.test(f));
const testFiles = files.filter(f => f.endsWith('.test.ts'));
const anyAccess = [];
const privateNameReferences = [];
for (const f of testFiles) {
  const sf = source(path.join(repo, f));
  const walk = n => {
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      const name = ts.isPropertyAccessExpression(n) ? n.name.text : n.argumentExpression.getText(sf).replace(/^['"]|['"]$/g, '');
      if (privateNames.has(name)) privateNameReferences.push({ file: f.replace('brogue-web/', ''), line: line(sf, n), receiver: n.expression.getText(sf), member: name, call: ts.isCallExpression(n.parent) && n.parent.expression === n });
      let expr = n.expression;
      while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
      if (ts.isAsExpression(expr) && expr.type.kind === ts.SyntaxKind.AnyKeyword) {
        const receiver = expr.expression.getText(sf);
        const member = ts.isPropertyAccessExpression(n) ? n.name.text : n.argumentExpression.getText(sf).replace(/^['"]|['"]$/g, '');
        const call = ts.isCallExpression(n.parent) && n.parent.expression === n;
        anyAccess.push({ file: f.replace('brogue-web/', ''), line: line(sf, n), receiver, member, call, matchesGamePrivate: privateNames.has(member), exactG: receiver === 'g' });
      }
    }
    ts.forEachChild(n, walk);
  };
  walk(sf);
}
write('game-members.json', { lines: fs.readFileSync(gameFile, 'utf8').split('\n').length - 1, members });
write('test-any-accesses.json', anyAccess);
write('test-private-name-references.json', privateNameReferences);
write('inventory-summary.json', {
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  gameLines: fs.readFileSync(gameFile, 'utf8').split('\n').length - 1,
  imports: game.statements.filter(ts.isImportDeclaration).length,
  members: members.length, methods: members.filter(m => m.kind === 'MethodDeclaration').length,
  privateMethods: members.filter(m => m.private && m.kind === 'MethodDeclaration').length,
  testFiles: testFiles.length,
  exactGAnyAccesses: anyAccess.filter(x => x.exactG).length,
  exactGAnyCalls: anyAccess.filter(x => x.exactG && x.call).length,
  exactGPrivateNameCalls: anyAccess.filter(x => x.exactG && x.call && x.matchesGamePrivate).length,
  allReceiverPrivateNameCalls: anyAccess.filter(x => x.call && x.matchesGamePrivate).length,
  privateNameCallFiles: new Set(anyAccess.filter(x => x.call && x.matchesGamePrivate).map(x => x.file)).size,
  allPrivateNameReferences: privateNameReferences.length,
  allPrivateNameCalls: privateNameReferences.filter(x => x.call).length,
  allPrivateNameReferenceFiles: new Set(privateNameReferences.map(x => x.file)).size,
  privateNameCallsByMember: Object.fromEntries([...privateNames].map(name => [name, anyAccess.filter(x => x.call && x.matchesGamePrivate && x.member === name).length]).filter(([, n]) => n).sort((a, b) => b[1] - a[1])),
  caveat: 'AST syntax counts, not type-resolved Game instances. The direct any-cast counts exclude aliases previously assigned to any; the broader private-name scan includes alias receivers but can include unrelated same-name members. Comments/string literals excluded.'
});
console.log(JSON.stringify(JSON.parse(fs.readFileSync(path.join(dest, 'inventory-summary.json'), 'utf8')), null, 2));
