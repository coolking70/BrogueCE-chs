import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const out = 'ai_docs/reports/u-26a-evidence';
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
const files = walk('src').filter(f => /\.(ts|vue|json)$/.test(f));
const seeds = ['src/engine/Core/Game.ts', 'src/engine/Core/GenerationCoordinator.ts', 'src/engine/Items/ItemLoader.ts', 'src/engine/Items/Item.ts',
    'src/engine/Items/Inventory.ts', 'src/engine/Map/LoopMap.ts', 'src/engine/Generator/Architect.ts', 'src/components/InventoryOverlay.vue', 'src/locales/zh_CN.json'];
const symbols = /amuletLevel|AMULET_LEVEL|deepestLevel|DEEPEST_LEVEL|lumenstone|GEM|superVictory|itemValue|endgameScore|highScore|populateItems|populateLevel|spawnPopulateItem|originDepth|packCount|readFileSync|readFile/;
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
const mandatory = files.filter(f => /\/test\/(p1_30|u24|u_00|u_01|u_03|u_04|u_18a_3|u_26|u_27|w_5|u_r[234]|v_)/.test(f));
const tests = [...new Set([...closure, ...hits.map(h => h.file), ...mandatory])].filter(f => f.endsWith('.test.ts') && !f.endsWith('/generation_baseline.test.ts')).sort();
fs.writeFileSync(`${out}/search.json`, JSON.stringify({ seeds, symbols: String(symbols), reverseImportClosure: [...closure].sort(), sourceHits: hits, mandatory }, null, 2) + '\n');
fs.writeFileSync(`${out}/tests.txt`, tests.join('\n') + '\n');
console.log(`R∪S: ${tests.length} files; named guards and all source readers included.`);
