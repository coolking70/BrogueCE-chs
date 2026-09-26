import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const out = 'ai_docs/reports/x2e-evidence';
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
const files = walk('src').filter(f => /\.(ts|vue|json)$/.test(f));
const seeds = [
 'src/engine/Core/Game.ts','src/engine/Items/CharmModel.ts','src/engine/Items/ItemLoader.ts',
 'src/engine/Items/ItemUseCoordinator.ts','src/engine/UI/DetailGenerator.ts','src/data/arcana.json',
 'src/engine/Combat/Conjuration.ts','src/engine/Movement/CreaturePlacement.ts','src/entities/Monster.ts',
 'src/locales/zh_CN.json',
];
const symbols = /charm|Charm|CHARM|crystalize|negationBlast|rechargeStaff|bladeSpawnLocation|teleportCandidates|lifespan_remaining|readFileSync|readFile|createSourceFile/;
const imports = new Map(), hits = [];
for (const file of files) {
    const source = fs.readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true), refs = [];
    const visit = node => { if (ts.isStringLiteral(node) && node.text.startsWith('.')) {
        const p = path.normalize(path.join(path.dirname(file), node.text)), target = [p, `${p}.ts`, `${p}/index.ts`].find(f => files.includes(f));
        if (target) refs.push(target);
    } ts.forEachChild(node, visit); }; visit(ast); imports.set(file, refs);
    source.split('\n').forEach((line, i) => { if (symbols.test(line)) hits.push({ file, line: i + 1, text: line.trim() }); });
}
const closure = new Set(seeds);
let changed = true;
while (changed) { changed = false; for (const [file, refs] of imports) if (!closure.has(file) && refs.some(f => closure.has(f))) { closure.add(file); changed = true; } }
const mandatory = files.filter(f => f === 'src/engine/UI/Discoveries.test.ts' || /\/test\/(p1_30|u24|u_01|u_03|u_05|u_15a|u_15c|u_15d|u_16|u22|w_6|w_7|w_13|w_11|w_16|b_4a|w_5|invented_content_pool|u_r[234]|x2e)/.test(f));
const tests = [...new Set([...closure, ...hits.map(h => h.file), ...mandatory])].filter(f => f.endsWith('.test.ts') && !f.endsWith('/generation_baseline.test.ts')).sort();
fs.writeFileSync(`${out}/search.json`, JSON.stringify({ seeds, symbols: String(symbols), reverseImportClosure: [...closure].sort(), sourceHits: hits, mandatory }, null, 2) + '\n');
fs.writeFileSync(`${out}/tests.txt`, tests.join('\n') + '\n');
console.log(`R∪S: ${tests.length} files; named guards and all source readers included.`);

fs.writeFileSync(`${out}/source-reading-guards.json`,JSON.stringify(files.filter(f=>f.endsWith('.test.ts')&&/readFileSync|readFile|createSourceFile/.test(fs.readFileSync(f,'utf8'))),null,2)+'\n');
