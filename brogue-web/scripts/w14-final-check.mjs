// Run after all source/test/script edits. Explicit scope, no baseline capture, hash before/after.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
const dir = 'ai_docs/reports/w-14-evidence';
const walk = d => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d,e.name)) : [path.join(d,e.name)]) : [];
const sha = data => createHash('sha256').update(data).digest('hex');
const manifest = () => [...walk('src'), ...walk('public'), ...walk('scripts'), 'progress.md', 'ai_docs/tasks/w-14.prompt.md', 'ai_docs/reports/w-0-survey.report.md', '../BrogueCE-master/src/brogue/Items.c', '../BrogueCE-master/src/brogue/PowerTables.c', '../BrogueCE-master/src/variants/GlobalsBrogue.c', '../BrogueCE-master/src/brogue/Combat.c', '../BrogueCE-master/src/brogue/Time.c', '../BrogueCE-master/src/brogue/Monsters.c', '../BrogueCE-master/src/brogue/Grid.c', '../BrogueCE-master/src/brogue/Globals.c', '../BrogueCE-master/src/brogue/Architect.c', '../BrogueCE-master/src/brogue/Dijkstra.c', '../BrogueCE-master/src/brogue/Movement.c', '../BrogueCE-master/src/brogue/Rogue.h', ...fs.readdirSync('.').filter(f => /^(package.*\.json|tsconfig.*\.json|vite\.config\..*|index\.html)$/.test(f))].sort().map(p => `${sha(fs.readFileSync(p))}  ${p}`).join('\n') + '\n';
const head = file => execFileSync('git', ['show', `HEAD:brogue-web/${file}`]);
const methods = source => {
    const tree = ts.createSourceFile('Game.ts', source, ts.ScriptTarget.Latest, true), result = {};
    const visit = node => {
        if (ts.isMethodDeclaration(node)) result[node.name.getText(tree)] = node.getText(tree);
        ts.forEachChild(node, visit);
    };
    visit(tree); return result;
};
const oldMethods = methods(head('src/engine/Core/Game.ts').toString()), newMethods = methods(fs.readFileSync('src/engine/Core/Game.ts', 'utf8'));
const changedMethods = Object.keys(oldMethods).filter(k => oldMethods[k] !== newMethods[k]);
const addedMethods = Object.keys(newMethods).filter(k => !(k in oldMethods));
const unchangedFiles = ['src/data/arcana.json', 'src/data/monsters.json', 'src/data/mutations.json', 'src/engine/Combat/Bolt.ts', 'src/engine/Combat/BoltCatalog.ts', 'src/engine/Movement/CreaturePlacement.ts', 'src/engine/Items/Item.ts', 'src/engine/Items/ItemLoader.ts', 'src/engine/Items/ArcanaInstance.ts', 'src/engine/Items/ArcanaRecharge.ts', 'src/engine/Items/ArcanaEnchantment.ts', 'src/engine/Random.ts', 'src/engine/Environment/Gas.ts', 'src/engine/Map/DungeonFeature.ts', 'src/engine/Map/Grid.ts', 'src/engine/Generator/BlueprintEngine.ts', 'src/engine/Map/AutoGenerator.ts', 'src/engine/Map/WaypointMap.ts', 'src/engine/Combat/BoltTrajectory.ts', 'src/entities/Creature.ts', 'src/entities/Monster.ts', 'src/entities/Player.ts', 'src/test/fixtures/generation_baseline.json'];
// Ensure every unrelated top-level effect case is byte-identical to HEAD.
const cases = (source, name) => {
    const tree = ts.createSourceFile('Game.ts', source, ts.ScriptTarget.Latest, true), result = {};
    const visit = n => {
        if (ts.isMethodDeclaration(n) && n.name.getText(tree) === name) {
            const sw = n.body.statements.find(ts.isSwitchStatement);
            for (const c of sw.caseBlock.clauses) result[c.expression?.getText(tree) ?? 'default'] = c.getText(tree);
        }
        ts.forEachChild(n, visit);
    };
    visit(tree); return result;
};
const effectBoundary = {};
for (const name of ['applyBoltEffect', 'applyMonsterBoltHit']) {
    const before = cases(head('src/engine/Core/Game.ts').toString(), name);
    const after = cases(fs.readFileSync('src/engine/Core/Game.ts', 'utf8'), name);
    effectBoundary[name] = Object.fromEntries(Object.keys(before).filter(k => ![
        'BoltEffect.OBSTRUCTION',
    ].includes(k)).map(k => [k, before[k] === after[k]]));
}
const terrainFunctions = source => {
    const tree = ts.createSourceFile('Promotion.ts', source, ts.ScriptTarget.Latest, true), result = {};
    for (const node of tree.statements) if (ts.isFunctionDeclaration(node) && node.name) result[node.name.text] = node.getText(tree);
    return result;
};
const oldTerrainFunctions = terrainFunctions(head('src/engine/Map/Promotion.ts').toString());
const newTerrainFunctions = terrainFunctions(fs.readFileSync('src/engine/Map/Promotion.ts', 'utf8'));
const boundary = {
    effectBoundary,
    waypointAlgorithmUnchanged: ['setUpWaypointsInner', 'refreshWaypoint', 'rollingRefresh'].every(k =>
        methods(head('src/engine/Map/WaypointMap.ts').toString())[k]
        === methods(fs.readFileSync('src/engine/Map/WaypointMap.ts', 'utf8'))[k]),
    methodScope: changedMethods.every(k => ['applyBoltResult', 'applyBoltEffect'].includes(k)) && addedMethods.length === 0,
    protectedTerrainFunctions: Object.fromEntries(Object.keys(oldTerrainFunctions).filter(k => k !== 'promoteTile').map(k => [k, oldTerrainFunctions[k] === newTerrainFunctions[k]])),
    head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), changedMethods, addedMethods,
    protectedMethods: Object.fromEntries(['zapBoltFromPlayer', 'tunnelAt', 'castMonsterBolt', 'teleportCreature', 'crystalizeFromPlayer', 'finishBlink', 'beckonCreature', 'placeCreature', 'freeCaptive', 'applyDirectBoltDamage', 'generateDepth', 'handlePlayerAction', 'teleportPlayerRandom', 'playerFalls', 'monstersFall', 'playerTurnEnded', 'processStaggerHit', 'removeDeadMonsters', 'tickArcanaResources', 'applyBasicBoltEffect', 'applyStatusToMonster', 'applyTimedStatus', 'resolveBurningDamage', 'applyInstantExplosionAt', 'triggerDeathFeatures', 'objectiveTimeBlock'].map(k => [k, oldMethods[k] !== undefined && oldMethods[k] === newMethods[k]])),
    unchangedFiles: Object.fromEntries(unchangedFiles.map(f => [f, { head: sha(head(f)), current: sha(fs.readFileSync(f)), equal: head(f).equals(fs.readFileSync(f)) }])),
    playerDamageHasPhysicalAttack: /CombatSystem\.attack/.test(newMethods.applyDirectBoltDamage + newMethods.applyBoltEffect),
};
fs.writeFileSync(`${dir}/boundary.json`, JSON.stringify(boundary, null, 2) + '\n');
if (!boundary.waypointAlgorithmUnchanged || !boundary.methodScope || Object.values(effectBoundary).some(cases => Object.values(cases).some(v => !v))
    || Object.values(boundary.protectedTerrainFunctions).some(v => !v)
    || Object.values(boundary.protectedMethods).some(v => !v)
    || Object.values(boundary.unchangedFiles).some(v => !v.equal) || boundary.playerDamageHasPhysicalAttack) throw Error('W-14 boundary mismatch');
execFileSync(process.execPath, ['scripts/w14-test-scope.mjs']);
const scope = JSON.parse(fs.readFileSync(`${dir}/closure.json`, 'utf8'));
const before = manifest();
fs.writeFileSync(`${dir}/sha256-before.txt`, before);
const commands = [
    ['build', 'npm', ['run', 'build']],
    ['regression', process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...scope.all.filter(p => !p.endsWith('/generation_baseline.test.ts')), '--maxWorkers=4', '--reporter=default', '--reporter=json', `--outputFile.json=${dir}/final-regression.json`]],
    ['drift', 'npm', ['run', 'test:drift', '--', '--reporter=default', '--reporter=json', `--outputFile.json=${dir}/final-drift.json`]],
];
const results = [];
for (const [name, bin, args] of commands) {
    const start = new Date().toISOString(), log = fs.openSync(`${dir}/final-${name}.log`, 'w');
    console.log(`${start} START ${name} (${name === 'regression' ? scope.all.length - 1 + ' explicit files' : bin + ' ' + args.join(' ')})`);
    const result = spawnSync(bin, args, { stdio: ['ignore', log, log], env: process.env });
    fs.closeSync(log);
    results.push({ name, bin, args, start, end: new Date().toISOString(), exitCode: result.status, error: result.error?.message });
    console.log(`${results.at(-1).end} END ${name} exit=${result.status}`);
}
const after = manifest();
fs.writeFileSync(`${dir}/sha256-after.txt`, after);
const summary = { results, filesHashed: before.trim().split('\n').length, shaBefore: sha(before), shaAfter: sha(after), unchanged: before === after };
fs.writeFileSync(`${dir}/final-summary.json`, JSON.stringify(summary, null, 2) + '\n');
const perFile = [], counts = {};
for (const run of ['regression', 'drift']) {
    const data = JSON.parse(fs.readFileSync(`${dir}/final-${run}.json`, 'utf8'));
    for (const t of data.testResults) {
        const statuses = {};
        for (const a of t.assertionResults) { statuses[a.status] = (statuses[a.status] ?? 0) + 1; counts[a.status] = (counts[a.status] ?? 0) + 1; }
        perFile.push({ file: path.relative(process.cwd(), t.name), status: t.status, statuses, run });
    }
}
fs.writeFileSync(`${dir}/final-files.json`, JSON.stringify({ counts, perFile: perFile.sort((a, b) => a.file.localeCompare(b.file)) }, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, counts, results: results.map(({name,exitCode}) => ({name,exitCode})) }, null, 2));
process.exitCode = summary.unchanged && results.every(r => r.exitCode === 0) ? 0 : 1;
