import ts from 'typescript';import fs from 'node:fs';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const dir='ai_docs/reports/u-08-evidence';
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const old=f=>execFileSync('git',['show','HEAD:brogue-web/'+f],{encoding:'utf8'});
const printer=ts.createPrinter({removeComments:true});
const parse=(f,text)=>ts.createSourceFile(f,text,ts.ScriptTarget.Latest,true);
const members=(f,text)=>{const tree=parse(f,text),out={};for(const n of tree.statements)if(ts.isClassDeclaration(n))for(const m of n.members)out[m.name?.getText(tree)??'constructor']=printer.printNode(ts.EmitHint.Unspecified,m,tree);return out;};
const methodChecks={};for(const f of ['src/engine/Core/Game.ts','src/entities/Monster.ts']){
 const before=members(f,old(f)),after=members(f,fs.readFileSync(f,'utf8'));
 const differences=Object.keys(before).filter(n=>before[n]!==after[n]);
 methodChecks[f]={unchanged:Object.keys(before).length-differences.length,added:Object.keys(after).filter(n=>!(n in before)),differences};
}
const table=(f,text,name)=>{const tree=parse(f,text);let out;const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(tree)===name&&n.initializer&&ts.isObjectLiteralExpression(n.initializer))out=Object.fromEntries(n.initializer.properties.map(p=>[p.name.getText(tree),printer.printNode(ts.EmitHint.Unspecified,p,tree)]));ts.forEachChild(n,visit);};visit(tree);assert(out,name);return out;};
const preservedTables={};for(const [f,name] of [['src/engine/Map/DungeonFeatureCatalog.ts','DUNGEON_FEATURE_CATALOG'],['src/engine/Map/TerrainCatalog.ts','TERRAIN_FLAGS'],['src/engine/Map/Grid.ts','DRAW_PRIORITY'],['src/engine/Map/Grid.ts','TERRAIN_HOME_LAYER'],['src/test/r_1_appearance.test.ts','EXPECTED_VISIBLE'],['src/test/c_7_lighting.test.ts','EXPECTED_GLOW']]){
 const before=table(f,old(f),name),after=table(f,fs.readFileSync(f,'utf8'),name);
 const differences=Object.keys(before).filter(k=>before[k]!==after[k]);assert.deepEqual(differences,[]);
 preservedTables[name]={unchanged:Object.keys(before).length,added:Object.keys(after).filter(k=>!(k in before)),differences};
}
const initial=JSON.parse(fs.readFileSync(dir+'/initial-hashes.json'));
const changed=Object.keys(initial).filter(f=>hash(f)!==initial[f]);
const allowed=['src/engine/Combat/BoltContract.test.ts','src/engine/Map/Promotion.ts','src/test/c_4a_0_layer_model.test.ts','src/test/c_4a_terrain_catalog.test.ts','src/engine/Combat/Bolt.ts','src/engine/Combat/BoltCatalog.test.ts','src/engine/Core/Game.ts','src/engine/Map/DungeonFeature.ts','src/engine/Map/DungeonFeatureCatalog.ts','src/engine/Map/Grid.ts','src/engine/Map/TerrainCatalog.ts','src/engine/UI/Appearance.ts','src/entities/Monster.ts','src/locales/zh_CN.json','src/data/monsterBolts.test.ts','src/test/c_4b_dungeon_feature.test.ts','src/test/c_7_lighting.test.ts','src/test/p4_1b_monster_casting.test.ts','src/test/r_1_appearance.test.ts','src/test/w_2_arcana_submission.test.ts'];
assert.deepEqual(changed.filter(f=>!allowed.includes(f)),[]);
assert.deepEqual(methodChecks['src/engine/Core/Game.ts'].differences,['handlePlayerAction','applyBoltTerrainAt','castMonsterBolt','finishTurnEpilogue','applyEnvironmentalEffects','handleSpecialTileEntry','getTerrainName']);
assert.deepEqual(methodChecks['src/entities/Monster.ts'].differences,['tryMoveTo']);
const result={methodChecks,preservedTables,changed,protectedUnchanged:Object.keys(initial).length-changed.length};
fs.writeFileSync(dir+'/boundary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
