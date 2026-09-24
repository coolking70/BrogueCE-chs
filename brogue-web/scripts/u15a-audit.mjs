import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import ts from 'typescript';
const dir = 'ai_docs/reports/u-15a-evidence';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const head = f => execFileSync('git', ['show', `HEAD:brogue-web/${f}`], { encoding: 'utf8' });
const methods = text => {
    const tree = ts.createSourceFile('Game.ts', text, ts.ScriptTarget.Latest, true);
    const game = tree.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'Game');
    return Object.fromEntries(game.members.map(n => [n.name?.getText(tree) ?? 'constructor', n.getText(tree)]));
};
const before = methods(head('src/engine/Core/Game.ts')), after = methods(fs.readFileSync('src/engine/Core/Game.ts', 'utf8'));
const changedMembers = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => before[k] !== after[k]);
assert.deepEqual(changedMembers, ['crystalizeFromPlayer']);
const unchanged = ['src/engine/Map/Grid.ts', 'src/engine/Generator/BlueprintEngine.ts',
    'src/engine/Map/DungeonFeature.ts', 'src/engine/Map/DungeonFeatureCatalog.ts', 'src/engine/Map/Promotion.ts',
    'src/engine/Core/EntitySnapshot.ts', 'src/data/blueprints.json', 'src/data/consumables.json', 'vite.config.ts', 'package.json', 'package-lock.json'];
const trackedTests = execFileSync('git', ['ls-files', 'src', 'scripts'], { encoding: 'utf8' }).trim().split('\n').filter(f => f.endsWith('.test.ts') || f.includes('/fixtures/'));
const hashes = Object.fromEntries([...new Set([...unchanged, ...trackedTests])].map(f => {
    const oldHash = sha(head(f)), currentHash = sha(fs.readFileSync(f));
    assert.equal(currentHash, oldHash, f);
    return [f, currentHash];
}));
const blueprints = JSON.parse(fs.readFileSync('src/data/blueprints.json', 'utf8'));
const sources = blueprints.flatMap(b => {
    const features = b.features.flatMap((f, index) => f.flags?.includes('MF_IMPREGNABLE') ? [{ index, terrain: f.terrain, featureDF: f.featureDF }] : []);
    return b.flags?.includes('BP_IMPREGNABLE') || features.length ? [{ id: b.id, ceBlueprintId: b.ceBlueprintId,
        BP_IMPREGNABLE: b.flags?.includes('BP_IMPREGNABLE'), features }] : [];
});
const scope = JSON.parse(fs.readFileSync(`${dir}/closure.json`, 'utf8'));
const result = { changedMembers, unchangedHashes: hashes, scopeCount: scope.all.length,
    blueprintSourceCounts: { BP: sources.filter(s => s.BP_IMPREGNABLE).length, MF: sources.reduce((n, s) => n + s.features.length, 0) }, blueprintSources: sources };
fs.writeFileSync(`${dir}/boundary-and-sources.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ changedMembers, unchangedFiles: Object.keys(hashes).length, scopeCount: scope.all.length, blueprintSourceCounts: result.blueprintSourceCounts }));
