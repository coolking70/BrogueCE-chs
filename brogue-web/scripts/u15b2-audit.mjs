import fs from 'node:fs';import path from 'node:path';import ts from 'typescript';
const out='ai_docs/reports/u-15b2-evidence';
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${d}/${e.name}`):[`${d}/${e.name}`]);
const files=[...walk('src'),...walk('scripts')].filter(f=>/\.(ts|tsx|js|mjs|vue|json)$/.test(f));
const seeds=['src/data/arcana.json','src/engine/Items/ItemLoader.ts','src/engine/Items/RingBonuses.ts','src/engine/Items/ArcanaRecharge.ts','src/engine/Combat/Combat.ts','src/engine/Core/Game.ts','src/engine/Map/LightCatalog.ts','src/engine/UI/DetailGenerator.ts','src/locales/zh_CN.json'];
const pattern=/spawnRing|spawnMachineRing|genRings|ringTable|ring_of_|RING|ringBonus|effectiveRingEnchant|lightMultiplier|reaping|tickStaffRecharge|rechargeItemsIncrementally|cooldownRemaining|staffRechargeRemaining|readFileSync|readFile/;
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
const mandatory=files.filter(f=>/\/test\/(p1_30|u_?24|u_01|u_03|u_05|u_15b|b_1b|b_4a|w_[567]_|u_r2)/.test(f));
const tests=[...new Set([...closure,...hits.map(h=>h.file),...mandatory])].filter(f=>f.endsWith('.test.ts')&&!f.endsWith('/generation_baseline.test.ts')).sort();
fs.writeFileSync(`${out}/search.json`,JSON.stringify({seeds,pattern:String(pattern),reverseImportClosure:[...closure].sort(),sourceHits:hits,mandatory,imports:Object.fromEntries(imports)},null,2)+'\n');
fs.writeFileSync(`${out}/tests.txt`,tests.join('\n')+'\n');
console.log(`R ∪ S: ${tests.length} explicit test files; all source readers and named guard families included. Drift separate.`);
