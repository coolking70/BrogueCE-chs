import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const out = 'ai_docs/reports/x2b-evidence';
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
const files = walk('src').filter(f => /\.(ts|vue|json)$/.test(f));
const seeds = [
 'src/engine/Core/Game.ts','src/engine/Core/LevelSnapshot.ts','src/engine/Environment/Gas.ts',
 'src/engine/Generator/Architect.ts','src/engine/Generator/BlueprintEngine.ts',
 'src/engine/Map/DungeonFeature.ts','src/engine/Map/Grid.ts','src/engine/Map/LakeSystem.ts',
 'src/engine/Map/Pathfinding.ts','src/engine/Map/Promotion.ts','src/engine/Map/TerrainCatalog.ts',
 'src/engine/Map/TerrainRules.ts','src/engine/Map/TerrainType.ts',
 'src/engine/Movement/PlayerTravel.ts','src/entities/Monster.ts',
];
const symbols = /isPassable|isOpaque|refreshTerrainProperties|T_OBSTRUCTS_|T_PATHING_BLOCKER|genericPathCost|safetyTerrainCosts|terrainPassableOrSecretDoor|playerTravelTerrainAllowed|setTerrain|layers|readFileSync|readFile|createSourceFile/;
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
const mandatory = files.filter(f => /\/test\/(p1_30|p1_42|u24|u_01|u_03|u_17|u_18a|u_19|u_26a|c_|v_|w_14|u_r[234])/.test(f));
const tests = [...new Set([...closure, ...hits.map(h => h.file), ...mandatory])].filter(f => f.endsWith('.test.ts') && !f.endsWith('/generation_baseline.test.ts')).sort();
fs.writeFileSync(`${out}/search.json`, JSON.stringify({ seeds, symbols: String(symbols), reverseImportClosure: [...closure].sort(), sourceHits: hits, mandatory }, null, 2) + '\n');
fs.writeFileSync(`${out}/tests.txt`, tests.join('\n') + '\n');
console.log(`R∪S: ${tests.length} files; named guards and all source readers included.`);

const terrainAccesses=[];
for(const file of files.filter(f=>!f.startsWith('src/test/')&&f.endsWith('.ts'))) {
 const source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const visit=n=>{
  if(ts.isPropertyAccessExpression(n)&&['isPassable','isOpaque','layers'].includes(n.name.text)) {
   const parent=n.parent,assignment=ts.isBinaryExpression(parent)&&parent.left===n&&parent.operatorToken.kind===ts.SyntaxKind.EqualsToken;
   const layerWrite=ts.isElementAccessExpression(parent)&&ts.isBinaryExpression(parent.parent)&&parent.parent.left===parent&&parent.parent.operatorToken.kind===ts.SyntaxKind.EqualsToken;
   terrainAccesses.push({file,line:ast.getLineAndCharacterOfPosition(n.getStart(ast)).line+1,symbol:n.name.text,write:assignment||layerWrite,text:(layerWrite?parent.parent:parent).getText(ast).slice(0,400)});
  }
  ts.forEachChild(n,visit);
 };visit(ast);
}
fs.writeFileSync(`${out}/terrain-accesses.json`,JSON.stringify(terrainAccesses,null,2)+'\n');
fs.writeFileSync(`${out}/source-reading-guards.json`,JSON.stringify(files.filter(f=>f.endsWith('.test.ts')&&/readFileSync|readFile|createSourceFile/.test(fs.readFileSync(f,'utf8'))),null,2)+'\n');
