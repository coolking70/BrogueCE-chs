import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
const dir='ai_docs/reports/u-18a-3-evidence', stage=process.argv[2];
const files=['src/engine/Core/Game.ts','src/engine/Core/LevelSeeds.ts','src/engine/Generator/BlueprintEngine.ts','src/engine/Map/AutoGenerator.ts','src/engine/Generator/GenerationPlacement.ts','src/engine/Generator/Stairs.ts','src/engine/Generator/Architect.ts','src/engine/Map/Grid.ts','src/engine/Map/TerrainCatalog.ts','src/engine/UI/TerrainAppearanceCatalog.ts','src/engine/Combat/Cloning.ts','src/engine/Combat/Conjuration.ts','src/engine/Combat/MonsterBlink.ts','src/engine/Map/SafetyMap.ts','src/engine/Movement/CreaturePlacement.ts','src/engine/Movement/LevelTravel.ts','src/engine/UI/Appearance.ts','src/locales/zh_CN.json'];
fs.mkdirSync(`${dir}/${stage}`,{recursive:true});
for(const f of files) if(fs.existsSync(f)) fs.copyFileSync(f,`${dir}/${stage}/${path.basename(f)}.txt`);
fs.writeFileSync(`${dir}/${stage}/files.json`,JSON.stringify(files.filter(f=>fs.existsSync(f))));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'u18a3-'));
try {
 await build({entryPoints:['scripts/u18a3-generation.ts'],outfile:`${temp}/capture.mjs`,bundle:true,platform:'node',format:'esm'});
 const fd=fs.openSync(`${dir}/${stage}/generation.txt`,'w');
 const r=spawnSync(process.execPath,[`${temp}/capture.mjs`,`${dir}/${stage}/generation.json.gz`],{stdio:['ignore',fd,fd]});fs.closeSync(fd);
 if(r.status!==0) throw Error(`capture ${r.status}`);
 const baseline=JSON.parse(fs.readFileSync(`${dir}/baseline-before.json`));
 const rows=JSON.parse(gunzipSync(fs.readFileSync(`${dir}/${stage}/generation.json.gz`)));
 const changes=rows.flatMap(r=>['fp','n','species','items'].filter(k=>r[k]!==baseline.levels[r.seed][r.depth-1][k]).map(field=>({seed:r.seed,depth:r.depth,field,before:baseline.levels[r.seed][r.depth-1][field],after:r[field]})));
 fs.writeFileSync(`${dir}/${stage}/drift.json`,JSON.stringify({method:'Unmodified baseline four-field comparison on independently bundled capture',changes},null,2));
 fs.writeFileSync(`${dir}/${stage}/status.json`,JSON.stringify({capture:r.status,rawDrift:changes.length?1:0,fieldsChanged:changes.length}));
 console.log(stage,{capture:r.status,fieldsChanged:changes.length});
} finally {fs.rmSync(temp,{recursive:true,force:true});}
