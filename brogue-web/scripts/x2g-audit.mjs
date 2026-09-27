import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const out = 'ai_docs/reports/x2g-evidence';
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
const files = walk('src').filter(f => /\.(ts|vue|json)$/.test(f));
const seeds = files.filter(f => !f.endsWith('.test.ts') && !f.startsWith('src/test/') &&
 /(?:Game|ItemLoader|EntitySnapshot|GenerationCoordinator|Submersion|MonsterVisibility|Appearance|TerrainAppearanceCatalog|TerrainType|TerrainCatalog|DungeonFeatureCatalog|Grid|Combat|BoltTargeting|BoltTrajectory|MonsterBlink|Creature|Monster)\.ts$|src\/(data\/consumables|locales\/zh_CN)\.json$/.test(f));
const symbols = /lichen|LICHEN|creeping_death|DARKNESS_CLOUD|DF_DARKNESS_POTION|ROT_GAS|submerged|Submersion|MONST_SUBMERGES|readFileSync|readFile|createSourceFile/;
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
const mandatory = files.filter(f => /\/test\/(p1_30|u24|u_01|u_03|u_13|u_15e|u_17[a-f]|u_18|f_|g_|invented_content_pool|w_10|w_15|u_r[234]|x2g)/.test(f));
const tests = [...new Set([...closure, ...hits.map(h => h.file), ...mandatory])].filter(f => f.endsWith('.test.ts') && !f.endsWith('/generation_baseline.test.ts')).sort();
fs.writeFileSync(`${out}/search.json`, JSON.stringify({ seeds, symbols: String(symbols), reverseImportClosure: [...closure].sort(), sourceHits: hits, mandatory }, null, 2) + '\n');
fs.writeFileSync(`${out}/tests.txt`, tests.join('\n') + '\n');
console.log(`R∪S: ${tests.length} files; named guards and all source readers included.`);

fs.writeFileSync(`${out}/source-reading-guards.json`,JSON.stringify(files.filter(f=>f.endsWith('.test.ts')&&/readFileSync|readFile|createSourceFile/.test(fs.readFileSync(f,'utf8'))),null,2)+'\n');
