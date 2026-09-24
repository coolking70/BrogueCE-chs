import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import ts from 'typescript';
const dir = 'ai_docs/reports/u-06-evidence';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const head = f => execFileSync('git', ['show', `HEAD:brogue-web/${f}`], { encoding: 'utf8' });
const parse = text => ts.createSourceFile('Game.ts', text, ts.ScriptTarget.Latest, true);
const methods = tree => {
    const game = tree.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'Game');
    return Object.fromEntries(game.members.map(n => [n.name?.getText(tree) ?? 'constructor', n.getText(tree)]));
};
const oldTree = parse(head('src/engine/Core/Game.ts')), newTree = parse(fs.readFileSync('src/engine/Core/Game.ts', 'utf8'));
const before = methods(oldTree), after = methods(newTree);
const changedMembers = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => before[k] !== after[k]);
assert.deepEqual(changedMembers, ['castMonsterBolt', 'applyMonsterBoltHit']);
const attackBranch = tree => {
    let branch;
    const visit = n => {
        if (ts.isSwitchStatement(n) && n.expression.getText(tree) === 'meta.effect') {
            const cases = n.caseBlock.clauses;
            let i = cases.findIndex(c => ts.isCaseClause(c) && c.expression.getText(tree) === 'BoltEffect.POISON_DART');
            if (i >= 0) { while (!cases[i].statements.length) i++; branch = cases[i].statements[0]; }
        }
        ts.forEachChild(n, visit);
    };
    visit(tree); assert(branch);
    return ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, branch, tree);
};
assert.equal(attackBranch(oldTree), attackBranch(newTree), 'BE_ATTACK executable body must stay identical');
const all = execFileSync('git', ['ls-files', 'src', 'scripts', 'public'], { encoding: 'utf8' }).trim().split('\n');
const mutable = ['src/engine/Core/Game.ts', 'src/engine/Combat/BoltTrajectory.ts', 'src/test/w_3_bolt_trajectory.test.ts', 'src/test/w_4_bolt_reflection.test.ts', 'src/test/w_8_staff_damage.test.ts'];
const protectedFiles = [...all.filter(f => !mutable.includes(f)), 'package.json', 'package-lock.json', 'vite.config.ts'];
const unchangedHashes = Object.fromEntries(protectedFiles.map(f => {
    const oldHash = sha(head(f)), currentHash = sha(fs.readFileSync(f)); assert.equal(currentHash, oldHash, f); return [f, currentHash];
}));
const scope = JSON.parse(fs.readFileSync(`${dir}/closure.json`, 'utf8'));
assert.deepEqual(scope.unresolved, []); assert.deepEqual(scope.nonliteral, []);
const result = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), changedMembers,
    BE_ATTACK_body_equal: true, BE_ATTACK_body_sha256: sha(attackBranch(newTree)), unchangedHashes, scopeCount: scope.all.length };
fs.writeFileSync(`${dir}/boundary.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ changedMembers, BE_ATTACK_body_equal: true, protectedFiles: protectedFiles.length, scopeCount: scope.all.length }));
