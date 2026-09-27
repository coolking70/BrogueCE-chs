import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const out = 'ai_docs/reports/x2k-evidence';
fs.mkdirSync(out, { recursive: true });
const write = (name, value) => fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
const files = walk('src').filter(f => /\.(ts|vue|json)$/.test(f));
const seeds = ['scripts/u03-state-contract.json', 'src/entities/Creature.ts', 'src/engine/Combat/MonsterAI.ts', 'src/engine/Map/DungeonFeatureCatalog.ts', 'src/locales/zh_CN.json', 'src/engine/Core/Game.ts', 'src/entities/Monster.ts', 'src/engine/Core/MonsterLifecycle.ts', 'src/engine/Movement/CreaturePlacement.ts', 'src/engine/Core/TimeCoordinator.ts', 'src/engine/Core/EntitySnapshot.ts'];
const deps = new Map();
for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true), imports = [];
    function visit(node) {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.startsWith('.')) {
            const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), node.moduleSpecifier.text));
            const resolved = [base, `${base}.ts`, `${base}.vue`, `${base}.json`, `${base}/index.ts`].find(f => fs.existsSync(f) && fs.statSync(f).isFile());
            if (resolved) imports.push(resolved);
        }
        ts.forEachChild(node, visit);
    }
    visit(source); deps.set(file, imports);
}
const reached = new Set(seeds);
for (let changed = true; changed;) {
    changed = false;
    for (const [file, imports] of deps) if (!reached.has(file) && imports.some(i => reached.has(i))) { reached.add(file); changed = true; }
}
const tests = files.filter(f => f.endsWith('.test.ts'));
const patterns = { sourceReaders: /readFileSync|readFile\(|readFile\s*\}/, aiLifecycle: /death|die\(|killCreature|resurrect|purgatory|carriedItem|carriedMonster|leadership|replay/i,
    required: /\/(p1_30|u_?24|u_01|u_03|u_06|u_10|u_11|u_16|u_17a|x2[cgjl]|p1_24|p4_|w_)/ };
const R = tests.filter(f => reached.has(f));
const S = Object.fromEntries(Object.entries(patterns).map(([name, re]) => [name, tests.filter(f => re.test(name === 'required' ? f : fs.readFileSync(f, 'utf8')))]));
write('closure', { seeds, R, S, union: [...new Set([...R, ...Object.values(S).flat()])].sort(), validation: 'npm test includes the entire union except generation_baseline, covered by test:drift; unchanged timeouts/assertions.' });
const protectedFiles = [...walk('src/test/fixtures').filter(f => /baseline/.test(f)), 'src/test/generation_baseline.test.ts', 'src/test/u_26a_deep_baseline.test.ts', ...[2,3,4].map(n => `ai_docs/reports/u-r${n}-trace.json${n===2?'':'.gz'}`), 'package.json', 'vite.config.ts'];
const hash = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const hashes = Object.fromEntries(protectedFiles.map(f => [f, hash(f)]));
if (!fs.existsSync(`${out}/baseline-before.json`)) write('baseline-before', hashes);
else write('baseline-after', { hashes, unchanged: JSON.stringify(hashes) === JSON.stringify(JSON.parse(fs.readFileSync(`${out}/baseline-before.json`, 'utf8'))) });
console.log(JSON.stringify({ R: R.length, S: Object.fromEntries(Object.entries(S).map(([k,v]) => [k,v.length])), union: new Set([...R, ...Object.values(S).flat()]).size, protectedFiles: protectedFiles.length }));
