// Explicit R(files) reverse-import closure plus S(pattern) inventory (X-0 §4.1).
// Run from brogue-web. No code/test/baseline rewriting.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';

const out = 'ai_docs/reports/u-18a-2-evidence';
fs.mkdirSync(out, { recursive: true });
function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = `${dir}/${e.name}`;
        return e.isDirectory() ? walk(p) : [p];
    });
}
const files = [...walk('src'), ...walk('scripts')].filter(p => /\.(ts|tsx|js|mjs|cjs|vue)$/.test(p) && !p.includes('/u18a2-'));
const seeds = ['engine/Map/Pathfinding', 'engine/Items/ItemSpawnHeatMap', 'engine/Map/TerrainRules', 'engine/Map/DungeonFeature', 'engine/Map/Grid', 'engine/Map/TerrainCatalog', 'engine/Map/Scent', 'engine/Map/SafetyMap', 'engine/Map/WaypointMap', 'entities/Monster', 'engine/Core/Game'].map(p => `src/${p}.ts`);
const imports = new Map();
const sourceHits = [];
const legacyAccesses = [];
const pattern = /isPassable|isOpaque|\bpassable\b|\bopaque\b|T_PATHING_BLOCKER|T_DIVIDES_LEVEL|canMoveTo|batchScan|entryQualifiesForPlacement|findQualifyingPathLocNear|floorTiles|secretPass|readFileSync|readFile/;
for (const p of files) {
    const text = fs.readFileSync(p, 'utf8');
    const ast = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true);
    const refs = [];
    function visit(node) {
        if (ts.isPropertyAccessExpression(node) && /^(isPassable|isOpaque)$/.test(node.name.text) && !p.includes('/test/') && !p.endsWith('.test.ts')) {
            const parent = node.parent;
            const write = ts.isBinaryExpression(parent) && parent.left === node
                && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
            legacyAccesses.push({ file: p, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
                field: node.name.text, kind: write ? 'write' : 'read', expression: node.getText(ast) });
        }
        if (ts.isStringLiteral(node) && node.text.startsWith('.')) {
            const base = path.normalize(path.join(path.dirname(p), node.text));
            const target = [base, `${base}.ts`, `${base}/index.ts`].find(q => files.includes(q));
            if (target) refs.push(target);
        }
        ts.forEachChild(node, visit);
    }
    visit(ast);
    imports.set(p, [...new Set(refs)]);
    text.split('\n').forEach((line, i) => {
        if (pattern.test(line)) sourceHits.push({ file: p, line: i + 1, text: line.trim() });
    });
}
const closure = new Set(seeds);
let changed = true;
while (changed) {
    changed = false;
    for (const [p, refs] of imports) if (!closure.has(p) && refs.some(r => closure.has(r))) {
        closure.add(p); changed = true;
    }
}
const selected = new Set([...closure, ...sourceHits.map(h => h.file), ...files.filter(p=>/src\/test\/(p1_30|u_?24|u_01|u_03)/.test(p))]);
const tests = [...selected].filter(p => p.endsWith('.test.ts') && !p.endsWith('/generation_baseline.test.ts')).sort();
const json = (name, value) => fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
json('search', { seeds, reverseImportClosure: [...closure].sort(), imports: Object.fromEntries(imports), sourceHits,
    note: 'String-literal edges deliberately include source scanners. Text hits include comments and are not asserted to be runtime reads.' });
json('legacy-accesses', legacyAccesses);
json('documentation-hits', walk('ai_docs').filter(p => p.endsWith('.md') && !p.includes('/u-18a')).flatMap(p => {
    const lines = fs.readFileSync(p, 'utf8').split('\n').flatMap((line, i) => pattern.test(line) ? [i + 1] : []);
    return lines.length ? [{ file: p, lines }] : [];
}));
fs.writeFileSync(`${out}/tests.txt`, tests.join('\n') + '\n');
const input = [...walk('src'), ...walk('public'), ...walk('scripts'), ...fs.readdirSync('.').filter(p => /^(package.*json|.*config.*|index.html)$/.test(p))]
    .filter(p => fs.statSync(p).isFile());
json('final-input-sha256', Object.fromEntries(input.sort().map(p => [p, crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])));
console.log(`R ∪ S: ${tests.length} explicit test files; drift runs separately.`);
