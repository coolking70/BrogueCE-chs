import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
const out='ai_docs/reports/x2b-evidence',dir=fs.mkdtempSync(path.join(os.tmpdir(),'x2b-key-'));
try {for(const stage of ['s0','derived','guard']) {
 const sources=JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-${stage}.json.gz`)));
 const source=`import fs from 'node:fs'; import {createHeadlessGame} from './src/test/harness'; import {TerrainType as T} from './src/engine/Map/Grid'; import {TERRAIN_FLAGS,T_OBSTRUCTS_PASSABILITY} from './src/engine/Map/TerrainCatalog'; import {ItemCategory} from './src/engine/Items/Item'; const g:any=createHeadlessGame(20260915),rows=[]; for(let d=1;d<=3;d++){g.depth=d;g.generateDepth(false,false);rows.push({depth:d,keys:g.items.filter(i=>i.category===ItemCategory.KEY).map(i=>{const c=g.grid.getCell(i.x,i.y);return {item:i,cell:c,terrainNames:c.layers.map(t=>T[t]),physical:!c.layers.some(t=>TERRAIN_FLAGS[t].flags&T_OBSTRUCTS_PASSABILITY)}})});}fs.writeFileSync(process.argv[2],JSON.stringify(rows,null,2)+'\\n');`;
 await build({stdin:{contents:source,resolveDir:process.cwd(),loader:'ts'},outfile:`${dir}/probe.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'stage',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},a=>{const f=path.relative(process.cwd(),a.path);if(f in sources)return {contents:sources[f],loader:f.endsWith('.json')?'json':'ts'};});}}]});
 const r=spawnSync(process.execPath,[`${dir}/probe.mjs`,`${out}/key-${stage}.json`],{stdio:'inherit'});if(r.status)throw Error(stage);
}}
finally{fs.rmSync(dir,{recursive:true,force:true});}
