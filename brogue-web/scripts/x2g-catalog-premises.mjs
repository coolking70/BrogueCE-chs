import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {spawnSync,execFileSync} from 'node:child_process';
const root=process.cwd(),out=path.join(root,'ai_docs/reports/x2g-evidence');
const files=['c_4a_terrain_catalog.test.ts','r_1_appearance.test.ts','c_4a_0_layer_model.test.ts'];
const original=Object.fromEntries(files.map(f=>[f,execFileSync('git',['show',`HEAD:brogue-web/src/test/${f}`],{encoding:'utf8'})]));
const revised={...original};
revised[files[0]]=revised[files[0]].replace("!['TRAMPLED_FOLIAGE'", "!['LICHEN', 'DARKNESS_CLOUD', 'ROT_GAS', 'TRAMPLED_FOLIAGE'")
 .replace('expect(names.length).toBe(190);', `// X2g adds three CE carriers; preserve the old projection and all-key field checks.
        expect(names.length).toBe(193);
        expect(names).toEqual(expect.arrayContaining(['LICHEN', 'DARKNESS_CLOUD', 'ROT_GAS']));`);
revised[files[1]]=revised[files[1]].replace("import ceTerrainGoldens from './fixtures/u21c-ce-terrain.json';", `import priorTerrainGoldens from './fixtures/u21c-ce-terrain.json';
import x2gTerrainGoldens from './fixtures/x2g-ce-terrain.json';
// CE-source additions; retain the historical 190-row fixture byte-for-byte.
const ceTerrainGoldens = { ...priorTerrainGoldens, ...x2gTerrainGoldens };`)
 .replace('![TerrainType.TRAMPLED_FOLIAGE', '![TerrainType.LICHEN, TerrainType.DARKNESS_CLOUD, TerrainType.ROT_GAS, TerrainType.TRAMPLED_FOLIAGE')
 .replace('expect(ALL_TERRAINS.length).toBe(190);', 'expect(ALL_TERRAINS.length).toBe(193);')
 .replace('当前 69 个','当前 193 个');
revised[files[2]]=revised[files[2]].replace('expect(TERRAIN_HOME_LAYER).toEqual({', `expect(TERRAIN_HOME_LAYER).toEqual({
            [C.LICHEN]: L.SURFACE, // X2g CE Globals.c:451/783
            [C.DARKNESS_CLOUD]: L.GAS, // CE :509/781
            [C.ROT_GAS]: L.GAS, // CE :504/649
`).replace('expect(DRAW_PRIORITY).toEqual({', `expect(DRAW_PRIORITY).toEqual({
            [C.LICHEN]: 60,
            [C.DARKNESS_CLOUD]: 35,
            [C.ROT_GAS]: 35,
`);
for(const f of files){fs.writeFileSync(`${out}/original-${f}.txt`,original[f]);fs.writeFileSync(`${out}/repaired-${f}.txt`,revised[f]);}
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'x2g-catalog-premises-')),project=path.join(tmp,'brogue-web'),results=[];
try{
 fs.mkdirSync(project);fs.symlinkSync(path.join(root,'node_modules'),path.join(project,'node_modules'),'dir');
 fs.symlinkSync(path.resolve(root,'../BrogueCE-master'),path.join(tmp,'BrogueCE-master'),'dir');
 fs.copyFileSync('package.json',path.join(project,'package.json'));
 for(const [label,stage,repaired] of [['s0','s0',false],['review','review',false],['repaired','review',true]]){
  fs.rmSync(path.join(project,'src'),{recursive:true,force:true});fs.cpSync('src',path.join(project,'src'),{recursive:true});
  const sources=JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-${stage}.json.gz`)));
  const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):[path.join(d,e.name)]);
  for(const p of walk(path.join(project,'src'))){const f=path.relative(project,p);if(!f.startsWith('src/test/')&&/\.(ts|json)$/.test(f)&&!(f in sources))fs.rmSync(p);}
  for(const [f,s] of Object.entries(sources)){fs.mkdirSync(path.dirname(path.join(project,f)),{recursive:true});fs.writeFileSync(path.join(project,f),s);}
  for(const f of files)fs.writeFileSync(path.join(project,'src/test',f),(repaired?revised:original)[f]);
  fs.copyFileSync(`${out}/ce-terrain-additions.json`,path.join(project,'src/test/fixtures/x2g-ce-terrain.json'));
  const json=`${out}/catalog-premises-${label}.json`,fd=fs.openSync(`${out}/catalog-premises-${label}.txt`,'w');
  const args=['node_modules/vitest/vitest.mjs','run',...files.map(f=>`src/test/${f}`),'-t','全 TerrainType 键覆盖|R-1 terrainAppearance|归属表与 drawPriority','--maxWorkers=1','--reporter=json',`--outputFile=${json}`];
  const r=spawnSync(process.execPath,args,{cwd:project,stdio:['ignore',fd,fd]});fs.closeSync(fd);
  const v=JSON.parse(fs.readFileSync(json));results.push({label,exit:r.status,passed:v.numPassedTests,failed:v.numFailedTests,tests:v.testResults.flatMap(f=>f.assertionResults.filter(a=>a.status!=='skipped').map(a=>({name:a.fullName,status:a.status,messages:a.failureMessages})))});
  assert.equal(v.numPassedTests,label==='review'?0:5);assert.equal(v.numFailedTests,label==='review'?5:0);
 }
 fs.writeFileSync(`${out}/catalog-premises-summary.json`,JSON.stringify(results,null,2)+'\n');
} finally{fs.rmSync(tmp,{recursive:true,force:true});}
