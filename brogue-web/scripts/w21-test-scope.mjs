// Run from brogue-web: R(actual production files) + W-0 S(M,C,Q) + clone/identity/save consumers, plus source/fixture readers.
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
const dir = 'ai_docs/reports/w-21-evidence';
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
const seeds = ['src/engine/Core/Game.ts','src/entities/Monster.ts','src/entities/Creature.ts','src/engine/UI/DetailGenerator.ts','src/data/arcana.json','src/components/GameCanvas.vue','src/locales/zh_CN.json','src/locales/zh_CN.legacy.json'];
const tests = files.filter(f => f.endsWith('.test.ts'));
const reverse = seed => {
    const seen = new Set([seed]); let changed = true;
    while (changed) {
        changed = false;
        for (const [f, ds] of deps) if (!seen.has(f) && ds.some(d => seen.has(d))) { seen.add(f); changed = true; }
    }
    return tests.filter(f => seen.has(f)).sort();
};
const bySeed = Object.fromEntries(seeds.map(s => [s, { direct: tests.filter(t => deps.get(t).includes(s)).sort(), reverse: reverse(s) }]));
const R = [...new Set(Object.values(bySeed).flatMap(s => s.reverse))].sort();
const patterns = {
    Q: /useArcanaItem|spawnStaff|spawnWand|tickArcanaResources|rechargeRandomArcana|enchantEquippedItem|magicCharDiscoverySuffix|arcanaFlavor/,
    C: /CombatSystem|takeDamage|tickCreatureStatuses|statusDurations|tickStatuses/,
    M: /entities\/Monster|summonMinions|trySplitMonster|isAlly|leader/,
    empowerment: /empower|EMPOWER|mutation|heal\(|newPowerCount|totalPowerCount|generateMonsterDetail|cloneMonster|copyForClone|cloneState|cloneLocation|isClone|PLENTY|polymorph|mutation|carriedMonster|carriedItem|typeId|deathEffectTriggered|seized|seizing|dormant|captive|saveSnapshot|loadSnapshot|toSnapshot/,
    readers: /readFileSync|readFile\(|import\(|require\(|fixtures|toSnapshot|saveSnapshot|loadSnapshot/,
};
const S = Object.fromEntries(Object.entries(patterns).map(([k, re]) => [k, tests.filter(f => re.test(fs.readFileSync(f, 'utf8'))).sort()]));
const all = [...new Set([...R, ...Object.values(S).flat()])].sort();
const result = { seeds, scannedTests: tests.length, bySeed, patterns: Object.fromEntries(Object.entries(patterns).map(([k, re]) => [k, re.source])), R, S, all, extras: all.filter(f => !R.includes(f)), unresolved, nonliteral };
fs.writeFileSync(`${dir}/closure.json`, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ scannedTests: tests.length, R: R.length, S: Object.fromEntries(Object.entries(S).map(([k, v]) => [k, v.length])), total: all.length, extras: result.extras, unresolved, nonliteral }, null, 2));
