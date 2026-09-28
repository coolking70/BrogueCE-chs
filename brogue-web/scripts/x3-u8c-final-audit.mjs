import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import ts from 'typescript';
const out = 'ai_docs/reports/x3-u8c-evidence';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 30e6 });
const head = file => git('show', `HEAD:brogue-web/${file}`);
const read = file => fs.readFileSync(file, 'utf8');
const parse = source => ts.createSourceFile('input.ts', source, ts.ScriptTarget.Latest, true);
const members = source => {
    const file = parse(source), result = {};
    const declaration = file.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'Game');
    for (const member of declaration.members) if (member.name) result[member.name.getText(file)] = member.getText(file);
    return result;
};
const gamePath = 'src/engine/Core/Game.ts', before = members(head(gamePath)), after = members(read(gamePath));
const changedGameMembers = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => before[k] !== after[k]);
const allowed = ['inventoryAction', 'refreshVisibleEntities', 'hintRunicEquipment', 'reportAttack', 'applyCommand',
    'performPlayerAction', 'applyMonsterBoltHit', 'itemCallMode', 'inscribeItem', 'relabelItem',
    'resolvePlayerMeleeAttackOn', 'finishTurnEpilogue'];
assert(changedGameMembers.every(name => allowed.includes(name)));
assert.equal(after.performPlayerAction.replace(" || data === 'relabel'", ''), before.performPlayerAction);
assert.equal(read('src/engine/Core/TimeCoordinator.ts'), head('src/engine/Core/TimeCoordinator.ts'));
const rngCalls = source => {
    const file = parse(source), calls = [];
    const visit = node => {
        if (ts.isCallExpression(node) && /^rng\./.test(node.expression.getText(file))) calls.push(node.getText(file));
        ts.forEachChild(node, visit);
    };
    visit(file); return calls;
};
for (const file of [gamePath, 'src/entities/Monster.ts', 'src/engine/Combat/Combat.ts']) assert.deepEqual(rngCalls(read(file)), rngCalls(head(file)));
const golden = ['u-r2-trace.json', 'u-r3-trace.json.gz', 'u-r4-trace.json.gz'].map(f => `ai_docs/reports/${f}`);
for (const file of golden) assert(fs.readFileSync(file).equals(execFileSync('git', ['show', `HEAD:brogue-web/${file}`], { maxBuffer: 30e6 })));
const files = [...new Set([...git('diff', '--name-only', '--relative').trim().split('\n'),
    ...git('ls-files', '--others', '--exclude-standard').trim().split('\n')])].filter(Boolean);
const textFiles = files.filter(f => /\.(ts|vue|json|mjs|md|txt)$/.test(f));
const crlf = textFiles.filter(f => read(f).includes('\r\n')); assert.deepEqual(crlf, []);
assert.equal(git('diff', '--cached', '--name-only').trim(), '');
git('diff', '--check');
const pngs = fs.readdirSync(out).filter(f => f.endsWith('.png')).map(f => path.join(out, f));
for (const file of pngs) git('check-ignore', file);
const result = { changedGameMembers, protectedMovementParalysisHallucination: true, timeCoordinatorUnchanged: true,
    RNGCallSitesUnchanged: true, goldenUnchanged: golden, textFilesChecked: textFiles.length, crlf,
    pngsIgnored: pngs.length, stagedFiles: 0, diffCheck: 'passed', base: git('rev-parse', 'HEAD').trim() };
fs.writeFileSync(`${out}/boundary-audit.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
