// Run from brogue-web: node scripts/w6-test-scope.mjs
import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
const walk = d => fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
const files=walk('src').filter(f=>/\.(ts|vue|json)$/.test(f)), deps=new Map();
for(const f of files){const s=ts.createSourceFile(f,fs.readFileSync(f,'utf8'),ts.ScriptTarget.Latest,true), imports=[];
const visit=n=>{if((ts.isImportDeclaration(n)||ts.isExportDeclaration(n))&&n.moduleSpecifier&&ts.isStringLiteral(n.moduleSpecifier)&&n.moduleSpecifier.text.startsWith('.')){const p=path.normalize(path.join(path.dirname(f),n.moduleSpecifier.text));const r=[p,p+'.ts',p+'.vue',p+'.json',p+'/index.ts'].find(x=>fs.existsSync(x)&&fs.statSync(x).isFile());if(r)imports.push(r);}ts.forEachChild(n,visit);};visit(s);deps.set(f,imports);}
const seeds=['src/engine/Items/Item.ts','src/engine/Core/Game.ts','src/engine/Items/ArcanaRecharge.ts','src/engine/UI/DetailGenerator.ts','src/data/arcana.json','src/data/consumables.json','src/locales/zh_CN.json'];
const seen=new Set(seeds);let changed=true;while(changed){changed=false;for(const[f,ds]of deps)if(!seen.has(f)&&ds.some(d=>seen.has(d))){seen.add(f);changed=true;}}
const tests=files.filter(f=>f.endsWith('.test.ts'));
const patterns={Q:/useArcanaItem|spawnStaff|spawnWand|tickArcanaResources|rechargeRandomArcana|rechargeStaffsAndCharms|enchantEquippedItem|magicCharDiscoverySuffix|arcanaFlavor/,C:/CombatSystem|takeDamage|tickCreatureStatuses|statusDurations|tickStatuses/,recharging:/recharging|ringWisdom|wisdom|recharge|cooldownRemaining/,G:/ItemLoader|arcana\.json|terrainFingerprint|generateDepth|chooseKind/,storage:/readFileSync|loadSnapshot|saveSnapshot|toSnapshot|serializeItem|deserializeItem|maxCharges|charges|enchantment/,observation:/createHeadlessGame|startNewGame|Architect|generate\(|populate|spawn|seed|distribution/};
const R=tests.filter(f=>seen.has(f)).sort(); const S=Object.fromEntries(Object.entries(patterns).map(([k,re])=>[k,tests.filter(f=>re.test(fs.readFileSync(f,'utf8'))).sort()]));
const all=[...new Set([...R,...Object.values(S).flat()])].sort();
fs.writeFileSync('ai_docs/reports/w-6-evidence/closure.json',JSON.stringify({seeds,patterns:Object.fromEntries(Object.entries(patterns).map(([k,v])=>[k,v.source])),R,S,all},null,2)+'\n');
fs.writeFileSync('/tmp/w6-tests.txt',all.filter(f=>!f.endsWith('/generation_baseline.test.ts')).join('\n')+'\n');
console.log(JSON.stringify({R:R.length,S:Object.fromEntries(Object.entries(S).map(([k,v])=>[k,v.length])),total:all.length,extras:all.filter(f=>!R.includes(f))},null,2));
