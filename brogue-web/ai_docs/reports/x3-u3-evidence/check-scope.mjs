import ts from 'typescript';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const results = [];
for (const [file, className, allowed] of [
  ['src/engine/Core/Game.ts', 'Game', ['equipItem', 'unequipItem', 'dropItem', 'throwItemAt']],
  ['src/entities/Player.ts', 'Player', ['equip', 'unequip']],
]) {
  const prior = execFileSync('git', ['show', `HEAD:brogue-web/${file}`], { encoding: 'utf8' });
  const current = readFileSync(file, 'utf8');
  const members = source => {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const cls = sf.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
    return Object.fromEntries(cls.members.map(m => [m.name?.getText(sf), m.getText(sf)]));
  };
  const a = members(prior), b = members(current);
  const changed = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]);
  assert.ok(changed.every(k => allowed.includes(k)), `${file}: ${changed}`);
  assert.deepEqual(changed.sort(), allowed.sort());
  results.push({ file, changedMethods: changed, outsideAllowedMethodsChanged: false });
}
writeFileSync('ai_docs/reports/x3-u3-evidence/method-scope-check.json', JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results));
