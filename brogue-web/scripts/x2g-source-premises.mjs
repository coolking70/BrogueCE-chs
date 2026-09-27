import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import assert from 'node:assert/strict';import {gunzipSync} from 'node:zlib';import {spawnSync,execFileSync} from 'node:child_process';
const root=process.cwd(),out=path.join(root,'ai_docs/reports/x2g-evidence');
const original=execFileSync('git',['show','HEAD:brogue-web/src/test/c_4b_dungeon_feature.test.ts'],{encoding:'utf8'});
fs.writeFileSync(`${out}/original-c_4b_dungeon_feature.test.ts.txt`,original);
let revised=original.replaceAll('57, 58, 59, 60, 110, 63,','32, 39, 41, 54, 134, 136, 57, 58, 59, 60, 110, 63,');
revised=revised.replace('expect(keys.length).toBe(135);',`expect(keys.length).toBe(135);
        // X2g: preserve the historical projection and pin all six new CE rows.
        for (const [id, tile, layer, startProbability, probabilityDecrement] of [
            [32, TerrainType.ROT_GAS, DungeonLayer.GAS, 12, 0],
            [39, TerrainType.LICHEN, DungeonLayer.SURFACE, 70, 60],
            [41, TerrainType.ROT_GAS, DungeonLayer.GAS, 15, 0],
            [54, TerrainType.LICHEN, DungeonLayer.SURFACE, 2, 100],
            [134, TerrainType.DARKNESS_CLOUD, DungeonLayer.GAS, 200, 0],
            [136, TerrainType.LICHEN, DungeonLayer.SURFACE, 70, 60],
        ]) expect(DUNGEON_FEATURE_CATALOG[id as DF]).toMatchObject({id, tile, layer, startProbability, probabilityDecrement});`);
revised=revised.replace('start.add(DF.DF_BLOAT_EXPLOSION);',`start.add(DF.DF_BLOAT_EXPLOSION);
        // X2g CE potion/monster sources; growth itself is discovered via LICHEN.promoteType.
        for (const id of [DF.DF_ROT_GAS_BLOOD, DF.DF_ROT_GAS_PUFF, DF.DF_MUTATION_LICHEN,
            DF.DF_DARKNESS_POTION, DF.DF_LICHEN_PLANTED]) start.add(id);`);
revised=revised.replace("'engine/Map/DungeonFeature.ts',", "'entities/Monster.ts', // X2g: CE Combat.c:1827-1837 zombie blood DF after shield absorption.\n            'engine/Map/DungeonFeature.ts',");
revised=revised.replace('const pattern = /spawnDungeonFeature', `expect(readFileSync(join(srcDir, 'entities/Monster.ts'), 'utf8')).toContain('catalogFeature(DF.DF_ROT_GAS_BLOOD)');
        const pattern = /spawnDungeonFeature`);
const c7=fs.readFileSync(`${out}/c7-before-final-repair.test.ts.txt`,'utf8').replace('TerrainType.ELECTRIC_CRYSTAL_ON, TerrainType.DUNGEON_PORTAL,','TerrainType.ELECTRIC_CRYSTAL_ON, TerrainType.DUNGEON_PORTAL,\n            TerrainType.DARKNESS_CLOUD, // X2g CE negative light gas.');
fs.writeFileSync(`${out}/repaired-c_4b_dungeon_feature.test.ts.txt`,revised);
fs.writeFileSync(`${out}/repaired-c_7_lighting.test.ts.txt`,c7);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'x2g-source-premises-')),project=path.join(tmp,'brogue-web'),results=[];
try{
 fs.mkdirSync(project);fs.symlinkSync(path.join(root,'node_modules'),path.join(project,'node_modules'),'dir');
 fs.symlinkSync(path.resolve(root,'../BrogueCE-master'),path.join(tmp,'BrogueCE-master'),'dir');
 fs.copyFileSync('package.json',path.join(project,'package.json'));
 for(const [label,stage,repaired] of [['s0','s0',false],['review','review',false],['repaired','review',true]]){
  fs.rmSync(path.join(project,'src'),{recursive:true,force:true});fs.cpSync('src',path.join(project,'src'),{recursive:true});
  const sources=JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-${stage}.json.gz`)));
  // Exclude new production files from the HEAD reconstruction, including source-scanned orphans.
  const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
  for(const p of walk(path.join(project,'src'))){const f=path.relative(project,p);if(!f.startsWith('src/test/')&&/\.(ts|json)$/.test(f)&&!(f in sources))fs.rmSync(p);}
  for(const [f,s] of Object.entries(sources)){fs.mkdirSync(path.dirname(path.join(project,f)),{recursive:true});fs.writeFileSync(path.join(project,f),s);}
  fs.writeFileSync(path.join(project,'src/test/c_4b_dungeon_feature.test.ts'),repaired?revised:original);
  fs.writeFileSync(path.join(project,'src/test/c_7_lighting.test.ts'),c7);
  const json=`${out}/source-premises-${label}.json`,fd=fs.openSync(`${out}/source-premises-${label}.txt`,'w');
  const args=['node_modules/vitest/vitest.mjs','run','src/test/c_4b_dungeon_feature.test.ts','-t','E1 |E2 |F1 ','--maxWorkers=1','--reporter=json',`--outputFile=${json}`];
  const r=spawnSync(process.execPath,args,{cwd:project,stdio:['ignore',fd,fd]});fs.closeSync(fd);
  const v=JSON.parse(fs.readFileSync(json));results.push({label,exit:r.status,passed:v.numPassedTests,failed:v.numFailedTests,tests:v.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status!=='skipped').map(a=>({name:a.fullName,status:a.status,messages:a.failureMessages})))});
  assert.equal(v.numPassedTests,label==='review'?0:3);assert.equal(v.numFailedTests,label==='review'?3:0);
  if(repaired){const fd=fs.openSync(`${out}/source-premises-c7.txt`,'w');const q=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','src/test/c_7_lighting.test.ts','-t','全 tile|非零恰','--maxWorkers=1','--reporter=json',`--outputFile=${out}/source-premises-c7.json`],{cwd:project,stdio:['ignore',fd,fd]});fs.closeSync(fd);assert.equal(q.status,0);}
 }
 fs.writeFileSync(`${out}/source-premises-summary.json`,JSON.stringify(results,null,2)+'\n');
} finally{fs.rmSync(tmp,{recursive:true,force:true});}
