import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
const out='ai_docs/reports/u-19b-evidence';
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${d}/${e.name}`):[`${d}/${e.name}`]);
const files=[...walk('src'),...walk('scripts')].filter(f=>/\.(ts|tsx|js|mjs|vue|json)$/.test(f));
const seeds=['src/engine/Generator/BlueprintEngine.ts','src/engine/Generator/MachineView.ts','src/engine/Generator/Architect.ts','src/engine/Map/AutoGenerator.ts','src/engine/Core/Game.ts','src/data/blueprints.json','src/engine/Lighting/FOV.ts','src/engine/Map/DungeonFeature.ts','src/engine/Map/TerrainCatalog.ts'];
const pattern=/HAS_ITEM|HAS_MONSTER|HAS_PLAYER|HAS_STAIRS|hasPendingOccupant|fillVestibuleInterior|fillAreaInterior|mapMachineInterior|cellIsFeatureCandidate|randomMatchingLocation|runAutogenerators|AMULET|populateLevel|pendingItems|pendingMonsters|buildAMachine|blueprintQualifies|readFileSync|readFile/;
const imports=new Map(),hits=[];
for(const file of files){
 const text=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true),refs=[];
 const visit=node=>{if(ts.isStringLiteral(node)&&node.text.startsWith('.')){
  const base=path.normalize(path.join(path.dirname(file),node.text));
  const target=[base,`${base}.ts`,`${base}/index.ts`].find(p=>files.includes(p));if(target)refs.push(target);
 }ts.forEachChild(node,visit);};visit(ast);imports.set(file,[...new Set(refs)]);
 text.split('\n').forEach((line,i)=>{if(pattern.test(line))hits.push({file,line:i+1,text:line.trim()});});
}
const closure=new Set(seeds);let changed=true;
while(changed){changed=false;for(const [file,refs] of imports)if(!closure.has(file)&&refs.some(p=>closure.has(p))){closure.add(file);changed=true;}}
const mandatory=files.filter(f=>/\/test\/(p1_30|u_?24|u_01|u_03|v_|b2_transcription|blueprint_center|c_8|u_05a|u_17[a-f]|u25_machine_observation)/.test(f));
const tests=[...new Set([...closure,...hits.map(h=>h.file),...mandatory])].filter(f=>f.endsWith('.test.ts')&&!f.endsWith('/generation_baseline.test.ts')).sort();
fs.writeFileSync(`${out}/search.json`,JSON.stringify({seeds,pattern:String(pattern),reverseImportClosure:[...closure].sort(),sourceHits:hits,mandatory,imports:Object.fromEntries(imports)},null,2)+'\n');
fs.writeFileSync(`${out}/tests.txt`,tests.join('\n')+'\n');
console.log(`R ∪ S: ${tests.length} explicit test files; all source readers and named guard families included. Drift separate.`);
