import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';import ts from 'typescript';import {execFileSync,spawnSync}from'node:child_process';
const dir='ai_docs/reports/u-02b-evidence';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const head=f=>execFileSync('git',['show',`HEAD:brogue-web/${f}`],{encoding:'utf8'});
const guardEdits=['src/test/b_1b_identification_persistence.test.ts','src/test/u_10_absorption_snapshot.test.ts','src/test/p1_31_35_placement_snapshot.test.ts', ...['p4_3_special_monster_flags','u_06_monster_damage','u_08_terrain_bolts','w_5_arcana_instance','w_7_arcana_enchantment','w_8_staff_damage','w_24_wand_catalog','w_25_staff_catalog','v_2b_9c_effects','f_2a_fire_mechanics','v_2b_7_features','blueprint_center'].map(n=>'src/test/'+n+'.test.ts')];
const allowed=[...guardEdits,'src/test/u_02a_rng_snapshot.test.ts','src/test/fixtures/generation_baseline.json'];
const protectedFiles=execFileSync('git',['ls-files','src'],{encoding:'utf8'}).trim().split('\n').filter(f=>f.endsWith('.test.ts')||f.startsWith('src/engine/Generator/')||f.startsWith('src/data/')||f.startsWith('src/test/fixtures/'));
const checks=protectedFiles.filter(f=>!allowed.includes(f)).map(f=>({file:f,sha256:hash(fs.readFileSync(f)),headSha256:hash(head(f))}));assert.ok(checks.every(c=>c.sha256===c.headSha256));
const printer=ts.createPrinter({removeComments:true});
const tree=s=>ts.createSourceFile('file.ts',s,ts.ScriptTarget.Latest,true);
const print=n=>printer.printNode(ts.EmitHint.Unspecified,n,n.getSourceFile());
const expects=s=>{const a=[];function visit(n){if(ts.isCallExpression(n)&&n.expression.getText().startsWith('expect('))a.push(print(n));ts.forEachChild(n,visit);}visit(tree(s));return a;};
const guards=guardEdits.map(f=>{const a=expects(head(f)),b=expects(fs.readFileSync(f,'utf8'));assert.deepEqual(b,a);return{file:f,unchangedExpectExpressions:a.length};});
const u02a='src/test/u_02a_rng_snapshot.test.ts';const expected=expects(head(u02a)).map(s=>s.replace('expect(draws(r, 100)).toEqual(', 'expect(draws(r, 100)).not.toEqual(').replace('expect(high).toEqual(low)', 'expect(high).not.toEqual(low)'));
assert.deepEqual(expects(fs.readFileSync(u02a,'utf8')),expected);
// Final runtime matches the fully attributed stage, modulo comments/whitespace.
const stageMatch=[];
for(const [file,stage]of [['src/engine/Core/Game.ts','cache'],['src/engine/Random.ts','d'],['src/engine/Map/WaypointMap.ts','d'],['src/engine/Core/LevelSeeds.ts','d']]){
 const old=fs.readFileSync(`${dir}/stage-${stage}/${path.basename(file)}`,'utf8');
 const same=printer.printFile(tree(old))===printer.printFile(tree(fs.readFileSync(file,'utf8')));assert.ok(same,file);stageMatch.push({file,sameAST:same});
}
const deltas=[];for(const [prev,next]of [['before','a'],['a','b'],['b','c'],['c','d'],['d','cache']]){
 const rows=[];for(const name of ['Random.ts','Game.ts','LevelSeeds.ts','WaypointMap.ts']){
  const a=`${dir}/stage-${prev}/${name}`,b=`${dir}/stage-${next}/${name}`;if(!fs.existsSync(b))continue;
  const d=spawnSync('diff',['-u',fs.existsSync(a)?a:'/dev/null',b],{encoding:'utf8'});if(d.stdout)rows.push(d.stdout);
 }
 const f=`${dir}/stage-${next}/source.diff`;fs.writeFileSync(f,rows.join('\n'));deltas.push(f);
}
fs.writeFileSync(`${dir}/audit.json`,JSON.stringify({protected:checks,guards,u02a:{changedExpectExpressions:2,expandedCases:4,remainingExpectExpressions:expected.length-2},stageMatch,deltas},null,2)+'\n');
console.log(JSON.stringify({protectedUnchanged:checks.length,guards,stageMatch}));
