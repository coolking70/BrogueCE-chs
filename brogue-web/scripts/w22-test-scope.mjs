// W-22 is deferred: R(actual modified production files) is empty.
// Still calculate inspected M/G/B reverse closures and run S(M,C,B)+corpse/absorb/save/readers.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const dir = 'ai_docs/reports/w-22-evidence';
fs.mkdirSync(dir, { recursive: true });
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const files = walk('src').filter(f => /\.(ts|vue|json)$/.test(f));
const deps = new Map(), unresolved = [], nonliteral = [];
for (const f of files) {
    const raw = fs.readFileSync(f, 'utf8');
    const source = f.endsWith('.vue') ? [...raw.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n') : raw;
    const tree = ts.createSourceFile(f, source, ts.ScriptTarget.Latest, true), imports = [];
    const edge = value => {
        if (!value?.startsWith('.')) return;
        const p = path.normalize(path.join(path.dirname(f), value));
        const resolved = [p, p + '.ts', p + '.vue', p + '.json', p + '/index.ts'].find(x => fs.existsSync(x) && fs.statSync(x).isFile());
        if (resolved) imports.push(resolved); else unresolved.push({ f, value });
    };
    const visit = n => {
        if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) edge(n.moduleSpecifier.text);
        if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) edge(n.argument.literal.text);
        if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && n.moduleReference.expression && ts.isStringLiteral(n.moduleReference.expression)) edge(n.moduleReference.expression.text);
        if (ts.isCallExpression(n) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
            const value = n.arguments[0];
            if (value && ts.isStringLiteral(value)) edge(value.text); else nonliteral.push({ f, text: n.getText(tree) });
        }
        ts.forEachChild(n, visit);
    };
    visit(tree); deps.set(f, imports);
}
const tests = files.filter(f => f.endsWith('.test.ts'));
const reverse = seed => {
    const seen = new Set([seed]); let changed = true;
    while (changed) {
        changed = false;
        for (const [f, ds] of deps) if (!seen.has(f) && ds.some(d => seen.has(d))) { seen.add(f); changed = true; }
    }
    return tests.filter(f => seen.has(f)).sort();
};
const actualSeeds = execFileSync('git', ['diff', 'HEAD', '--name-only', '--', 'src'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
if (actualSeeds.length) throw Error('Deferred W-22 must not modify production or tests');
const inspectedSeeds = ['src/entities/Monster.ts', 'src/engine/Core/Game.ts', 'src/engine/Combat/Bolt.ts'];
const inspectedReverse = Object.fromEntries(inspectedSeeds.map(s => [s, reverse(s)]));
const patterns = {
    M: /entities\/Monster|summonMinions|trySplitMonster|isAlly|leader/,
    C: /CombatSystem|takeDamage|tickCreatureStatuses|statusDurations|tickStatuses/,
    B: /Combat\/Bolt|BoltEffect|getBoltForItem|zapBoltFromPlayer|computeBoltResult|castMonsterBolt/,
    corpseAbsorb: /corpse|absorb/i,
    saves: /saveSnapshot|loadSnapshot|toSnapshot|serializeMonster|deserializeMonster|newPowerCount|totalPowerCount|wasNegated|copyForClone/,
    readers: /readFileSync|readFile\(|import\(|require\(|fixtures/,
};
const S = Object.fromEntries(Object.entries(patterns).map(([k, re]) => [k, tests.filter(f => re.test(fs.readFileSync(f, 'utf8'))).sort()]));
const R = actualSeeds.flatMap(reverse);
// Explicitly include the inspected closure as conservative regression, not as an actual change surface.
const all = [...new Set([...R, ...Object.values(inspectedReverse).flat(), ...Object.values(S).flat()])].sort();
const result = { actualSeeds, R, inspectedSeeds, inspectedReverse, scannedTests: tests.length,
    patterns: Object.fromEntries(Object.entries(patterns).map(([k, re]) => [k, re.toString()])), S, all, unresolved, nonliteral };
fs.writeFileSync(`${dir}/closure.json`, JSON.stringify(result, null, 2) + '\n');
const hits = [];
for (const f of files) fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (/corpse|absorb|newPowerCount|totalPowerCount|wasNegated|ANCIENT_SPIRIT_VINES|monsterBlinkToPreferenceMap/i.test(line)) hits.push(`${f}:${i + 1}:${line}`);
});
fs.writeFileSync(`${dir}/semantic-hits.txt`, hits.join('\n') + '\n');
console.log(JSON.stringify({ scannedTests: tests.length, R: R.length, inspectedReverse: Object.fromEntries(Object.entries(inspectedReverse).map(([k, a]) => [k, a.length])), S: Object.fromEntries(Object.entries(S).map(([k, a]) => [k, a.length])), selected: all.length, unresolved, nonliteral }, null, 2));
